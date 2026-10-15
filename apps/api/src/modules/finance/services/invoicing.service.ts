import { Inject, Injectable } from '@nestjs/common';
import { FINANCE_LIMITS, invoicePartsFor, taxSplit } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import type { PriceBasis } from '@tugeel/shared/pricing';
import { addDays, businessDate } from '@tugeel/shared/time';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { TaxService } from '../../catalog';
import { type Actor, AuditService, type AuthContext } from '../../identity';
import { CustomersService } from '../../partners';
import type { SaleSink, SaleSnapshot } from '../../sales';
import { allocations, creditNotes, invoiceLines, invoices } from '../schema';
import { ArLedgerService } from './ar-ledger.service';
import { FinanceSettingsService } from './finance-settings.service';
import { GlAccountsService } from './gl-accounts.service';
import { type InvoiceDetail, InvoiceQueryService } from './invoice-query.service';
import { type JournalLineInput, JournalService } from './journal.service';

type NewLine = Omit<typeof invoiceLines.$inferInsert, 'invoiceId'>;

interface Totals {
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
    private readonly journal: JournalService,
    private readonly accounts: GlAccountsService,
    private readonly ledger: ArLedgerService,
    private readonly query: InvoiceQueryService,
  ) {}

  async onSold(
    tx: Tx,
    actor: Actor,
    snapshot: SaleSnapshot,
  ): Promise<{ invoiceId: number; number: string } | null> {
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
    const terms = await this.customers.creditTerms(customer.id, today, tx);
    const dueDate = addDays(today, terms.paymentTerm.days ?? 0);
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
      const entry = await this.journal.post(tx, actor, {
        entryDate: today,
        description: await this.label(number, customer.id, tx),
        source: 'AUTO_INVOICE',
        sourceType: 'INVOICE',
        sourceId: invoice.id,
        lines: await this.entryLines(customer.id, totals, tx),
      });
      await tx
        .update(invoices)
        .set({ journalEntryId: entry.id })
        .where(eq(invoices.id, invoice.id));
    }
    await this.ledger.record(tx, {
      customerId: customer.id,
      entryDate: today,
      kind: 'INVOICE',
      docType: 'INVOICE',
      docId: invoice.id,
      docNumber: number,
      debit: totals.total,
      credit: new Decimal(0),
    });
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
    return { invoiceId: invoice.id, number };
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
      const [allocated] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(allocations)
        .where(and(eq(allocations.invoiceId, id), isNull(allocations.voidedAt)));
      const [credited] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(creditNotes)
        .where(eq(creditNotes.invoiceId, id));
      if (allocated?.count !== '0' || credited?.count !== '0') {
        throw new AppError(
          'INVOICE_STATE_INVALID',
          `invoice ${invoice.number} has payments or credit notes against it`,
          { number: invoice.number, status: 'ALLOCATED' },
        );
      }
      const today = businessDate();
      const reversal =
        invoice.journalEntryId === null
          ? null
          : await this.journal.reverse(tx, ctx, invoice.journalEntryId, {
              entryDate: today,
              description: await this.label(invoice.number, invoice.customerId, tx),
              source: 'AUTO_VOID',
            });
      await tx
        .update(invoices)
        .set({
          status: 'VOID',
          openAmount: new Decimal(0),
          voidedAt: sql`now()`,
          voidedBy: ctx.userId,
          voidReason: trimmed,
          voidJournalEntryId: reversal?.id ?? null,
        })
        .where(eq(invoices.id, id));
      await this.ledger.record(tx, {
        customerId: invoice.customerId,
        entryDate: today,
        kind: 'VOID',
        docType: 'INVOICE',
        docId: id,
        docNumber: invoice.number,
        debit: new Decimal(0),
        credit: invoice.total,
      });
      await this.audit.record(tx, ctx, {
        action: 'VOID',
        entity: 'invoices',
        entityId: id,
        before: { status: 'ISSUED', openAmount: invoice.openAmount.toFixed(2) },
        after: { status: 'VOID', reason: trimmed, reversal: reversal?.number ?? null },
      });
    });
    return this.query.get(id);
  }

  /** The automatic entry's description: the document's number and the customer's name. */
  private async label(number: string, customerId: number, tx: Tx): Promise<string> {
    const [customer] = await this.customers.getMany([customerId], tx);
    return customer ? `${number} — ${customer.name}` : number;
  }

  private async entryLines(
    customerId: number,
    totals: Totals,
    tx: Tx,
  ): Promise<JournalLineInput[]> {
    const zero = new Decimal(0);
    const lines: JournalLineInput[] = [];
    if (totals.total.gt(0)) {
      lines.push({
        accountId: (await this.accounts.byRole('AR', tx)).id,
        debit: totals.total,
        credit: zero,
        customerId,
      });
    }
    if (totals.discountTotal.gt(0)) {
      lines.push({
        accountId: (await this.accounts.byRole('SALES_DISCOUNT', tx)).id,
        debit: totals.discountTotal,
        credit: zero,
      });
    }
    lines.push({
      accountId: (await this.accounts.byRole('SALES', tx)).id,
      debit: zero,
      credit: totals.subtotal.minus(totals.vatTotal).minus(totals.cityTaxTotal),
    });
    if (totals.vatTotal.gt(0)) {
      lines.push({
        accountId: (await this.accounts.byRole('VAT_PAYABLE', tx)).id,
        debit: zero,
        credit: totals.vatTotal,
      });
    }
    if (totals.cityTaxTotal.gt(0)) {
      lines.push({
        accountId: (await this.accounts.byRole('CITY_TAX_PAYABLE', tx)).id,
        debit: zero,
        credit: totals.cityTaxTotal,
      });
    }
    return lines;
  }
}

function totalsOf(lines: readonly NewLine[]): Totals {
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
