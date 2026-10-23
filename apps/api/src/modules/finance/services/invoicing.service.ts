import { Inject, Injectable } from '@nestjs/common';
import {
  FINANCE_LIMITS,
  invoicePartsFor,
  settlementDueDate,
  taxSplit,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import type { PriceBasis } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { TaxService } from '../../catalog';
import { type Actor, AuditService, type AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import type { SaleSink, SaleSnapshot } from '../../sales';
import type { FinIntakeResult } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { creditNotes, invoiceLines, invoices } from '../schema';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { FinanceSettingsService } from './finance-settings.service';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';
import { type InvoiceDetail, InvoiceQueryService } from './invoice-query.service';

type NewLine = Omit<typeof invoiceLines.$inferInsert, 'invoiceId'>;

/** An invoice's money totals: what its entry books. */
export interface InvoiceTotals {
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
  cityTaxTotal: Decimal;
}

/**
 * Invoices (ADR-0060 #3): one per sold order, issued by the sale sink in the transaction that
 * moves the card to «Борлуулалт», for the delivered quantities at the frozen prices; the taxes
 * split per line (ADR-0010 #4) with the company's rates of the day. The entry: Dr receivables
 * (and the discount), Cr sales net of the taxes, Cr the taxes payable. Immutable; voided while
 * nothing is allocated to it, by a reversing entry.
 */
@Injectable()
export class InvoicingService implements SaleSink {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly tax: TaxService,
    private readonly customers: CustomersService,
    private readonly settings: FinanceSettingsService,
    private readonly query: InvoiceQueryService,
    private readonly posting: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  async onSold(
    tx: Tx,
    actor: Actor,
    snapshot: SaleSnapshot,
  ): Promise<{ invoiceId: number; number: string; total: Decimal } | null> {
    const today = businessDate();
    const company = await this.tax.companyRates(today, tx);
    const lines: NewLine[] = [];
    for (const line of snapshot.lines) {
      if (line.qtyDelivered.lte(0)) continue;
      const rates = this.tax.ratesFor(
        { id: line.productId, vatType: line.vatType, cityTax: line.cityTax },
        company,
      );
      for (const part of invoicePartsFor(line.qtyDelivered, line.parts, line.baseUnit)) {
        const split = taxSplit(part.total, rates.vatRatePct, rates.cityTaxRatePct);
        lines.push({
          lineNo: lines.length + 1,
          orderLineId: line.orderLineId,
          productId: line.productId,
          productSku: line.sku,
          productName: line.name,
          productUnitId: part.productUnitId,
          uomName: part.uomName,
          basis: part.basis as PriceBasis,
          qty: part.qty,
          factorSnapshot: part.factorSnapshot,
          qtyBase: part.qtyBase,
          warehouseId: line.warehouseId,
          listPrice: part.listPrice,
          unitPrice: part.unitPrice,
          subtotal: part.subtotal,
          discountAmount: part.discountAmount,
          total: part.total,
          vatType: line.vatType,
          vatRatePct: rates.vatRatePct,
          cityTaxRatePct: rates.cityTaxRatePct,
          vatAmount: split.vat,
          cityTaxAmount: split.cityTax,
        });
      }
    }
    if (lines.length === 0) return null;
    const totals = totalsOf(lines);
    // Lock order (docs/modules/finance.md §4): the sale posted the stock; the customer comes next.
    const customer = await this.customers.lockForUpdate(tx, snapshot.customerId);
    // Due on the customer's settlement day, whatever the payment method (ADR-0101).
    const dueDate = settlementDueDate(customer.settlementGroup, today);
    const number = await this.settings.allocateNumber(tx, 'INVOICE', today);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        customerId: customer.id,
        orderId: snapshot.orderId,
        orderNumber: snapshot.orderNumber,
        branchId: snapshot.branchId,
        invoiceDate: today,
        dueDate,
        paymentMethod: snapshot.paymentMethod,
        ...totals,
        openAmount: totals.total,
        note: snapshot.note,
        createdBy: actor.kind === 'STAFF' ? actor.userId : null,
      })
      .returning({ id: invoices.id });
    if (!invoice) throw new Error('invoices insert returned no row');
    await tx.insert(invoiceLines).values(lines.map((line) => ({ ...line, invoiceId: invoice.id })));
    if (totals.subtotal.gt(0)) {
      const entryId = await this.postInvoiceInTx(tx, actor, {
        id: invoice.id,
        number,
        customerId: customer.id,
        invoiceDate: today,
        dueDate,
        orderNumber: snapshot.orderNumber,
        branchId: snapshot.branchId,
        ...totals,
      });
      await tx.update(invoices).set({ journalEntryId: entryId }).where(eq(invoices.id, invoice.id));
    }
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'invoices',
      entityId: invoice.id,
      after: {
        number,
        orderNumber: snapshot.orderNumber,
        customerId: customer.id,
        total: totals.total.toFixed(2),
        dueDate,
      },
    });
    return { invoiceId: invoice.id, number, total: totals.total };
  }

  /**
   * Voids an issued invoice nothing is allocated to or credited against (`finance.invoices.manage`):
   * the entry is reversed, the receivable is credited back, the goods stay where the sale put them.
   */
  async void(ctx: AuthContext, id: number, reason: string): Promise<InvoiceDetail> {
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > FINANCE_LIMITS.maxReason) {
      throw invalid('reason', 'length', `1 to ${FINANCE_LIMITS.maxReason} characters`);
    }
    await inTransaction(this.db, async (tx) => {
      const [head] = await tx
        .select({ customerId: invoices.customerId })
        .from(invoices)
        .where(eq(invoices.id, id));
      if (!head) throw notFound('invoice', id);
      await this.customers.lockForUpdate(tx, head.customerId);
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
      if (!invoice) throw notFound('invoice', id);
      if (invoice.status !== 'ISSUED') {
        throw new AppError(
          'INVOICE_STATE_INVALID',
          `invoice ${invoice.number} is ${invoice.status}`,
          {
            number: invoice.number,
            status: invoice.status,
          },
        );
      }
      // Anything settled against it (a voucher, a credit note, an allocation) shows on its mirror.
      const [credited] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(creditNotes)
        .where(eq(creditNotes.invoiceId, id));
      if (invoice.openAmount.lt(invoice.total) || credited?.count !== '0') {
        throw new AppError(
          'INVOICE_STATE_INVALID',
          `invoice ${invoice.number} has payments or credit notes against it`,
          { number: invoice.number, status: 'ALLOCATED' },
        );
      }
      const reversal =
        invoice.journalEntryId === null
          ? null
          : await this.reverseInvoiceInTx(tx, ctx, id, businessDate(), trimmed);
      await tx
        .update(invoices)
        .set({
          status: 'VOID',
          openAmount: new Decimal(0),
          voidedAt: sql`now()`,
          voidedBy: ctx.userId,
          voidReason: trimmed,
          voidJournalEntryId: reversal?.entryId ?? null,
        })
        .where(eq(invoices.id, id));
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'invoices',
        entityId: id,
        before: { status: 'ISSUED', openAmount: invoice.openAmount.toFixed(2) },
        after: { status: 'VOID', reason: trimmed, reversal: reversal?.journalNo ?? null },
      });
    });
    return this.query.get(id);
  }

  /**
   * Posts an invoice to the Finance Core as an AR_INVOICE of source BTO (ADR-0073 #3, ADR-0090):
   * the receivable opens an item due on the invoice's due date; the core keeps Bto's number. Also
   * used by the development re-post. Returns the journal entry's id.
   */
  async postInvoiceInTx(
    tx: Tx,
    actor: Actor,
    invoice: InvoiceTotals & {
      id: number;
      number: string;
      customerId: number;
      invoiceDate: string;
      dueDate: string;
      orderNumber: string | null;
      branchId: number | null;
    },
  ): Promise<number | null> {
    const party = await this.parties.customerPartyIn(tx, invoice.customerId);
    const lines = invoiceEntryLines(invoice);
    const result = await this.posting.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: {
          system: BTO_SOURCE,
          docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
          docId: String(invoice.id),
          docNo: invoice.number,
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.SALES_INVOICE.code,
          documentDate: invoice.invoiceDate,
          currency: 'MNT',
          party,
          dueDate: invoice.dueDate,
          description: documentLabel(invoice.number, party.name),
          controlTotal: controlTotal(lines),
          lines: intakeLines(lines),
          ...(invoice.orderNumber ? { attributes: { orderNumber: invoice.orderNumber } } : {}),
        },
      },
      invoice.branchId,
    );
    return entryIdOf(result);
  }

  /** Reverses an invoice's posting, dated `day` (the void, ADR-0072 #11). */
  async reverseInvoiceInTx(
    tx: Tx,
    actor: Actor,
    invoiceId: number,
    day: string,
    reason: string,
  ): Promise<{ entryId: number | null; journalNo: string | null }> {
    const result = await this.posting.submitInTx(tx, this.books.source(actor), {
      source: {
        system: BTO_SOURCE,
        docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
        docId: String(invoiceId),
      },
      body: { action: 'REVERSE', accountingDate: day, reason },
    });
    return { entryId: entryIdOf(result), journalNo: result.document?.journalNo ?? null };
  }
}

/**
 * An invoice's lines (ADR-0060 #7): Dr receivables (an item due on the due date) and the discount,
 * Cr sales net of the taxes, Cr the taxes payable with their base; zero lines skipped.
 */
export function invoiceEntryLines(totals: InvoiceTotals & { dueDate?: string }): RoleLine[] {
  const zero = new Decimal(0);
  const lines: RoleLine[] = [];
  const net = totals.subtotal.minus(totals.vatTotal).minus(totals.cityTaxTotal);
  if (totals.total.gt(0)) {
    lines.push({
      role: 'AR',
      debit: totals.total,
      credit: zero,
      ...(totals.dueDate ? { extra: { openItem: { dueDate: totals.dueDate } } } : {}),
    });
  }
  if (totals.discountTotal.gt(0)) {
    lines.push({ role: 'SALES_DISCOUNT', debit: totals.discountTotal, credit: zero });
  }
  lines.push({ role: 'SALES', debit: zero, credit: net });
  if (totals.vatTotal.gt(0)) {
    lines.push({ role: 'VAT_PAYABLE', debit: zero, credit: totals.vatTotal, taxBase: net });
  }
  if (totals.cityTaxTotal.gt(0)) {
    lines.push({
      role: 'CITY_TAX_PAYABLE',
      debit: zero,
      credit: totals.cityTaxTotal,
      taxBase: net,
    });
  }
  return lines;
}

/** A document's description: its number and whom it concerns (data, not translation). */
export function documentLabel(number: string, who: string | null | undefined): string {
  const name = who?.trim();
  return (name ? `${number} — ${name}` : number).slice(0, FINANCE_LIMITS.maxDescription);
}

/** The journal entry's id of an intake result (null for a posting without an entry). */
export function entryIdOf(result: FinIntakeResult): number | null {
  const id = result.document?.journalEntryId;
  return id === null || id === undefined ? null : Number.parseInt(id, 10);
}

function totalsOf(lines: readonly NewLine[]): InvoiceTotals {
  const sum = (pick: (line: NewLine) => Decimal) =>
    lines.reduce((acc, line) => acc.plus(pick(line)), new Decimal(0));
  return {
    subtotal: sum((line) => line.subtotal),
    discountTotal: sum((line) => line.discountAmount),
    total: sum((line) => line.total),
    vatTotal: sum((line) => line.vatAmount),
    cityTaxTotal: sum((line) => line.cityTaxAmount),
  };
}
