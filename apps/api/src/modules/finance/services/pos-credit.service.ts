import { Injectable } from '@nestjs/common';
import { settlementDueDate } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import type { VatType } from '../../catalog';
import { type Actor, AuditService } from '../../identity';
import { CustomersService } from '../../partners';
import { BTO_SOURCE, FIN_DOC_TYPES, FinPartiesBridge } from '../../fin-bridge';
import { creditNoteLines, creditNotes, invoiceLines, invoices } from '../schema';
import { FinBooks } from './fin-books';
import { FinPosting } from './fin-posting';
import { FinanceSettingsService } from './finance-settings.service';
import { controlTotal, intakeLines, type RoleLine } from './intake-lines';
import { documentLabel, entryIdOf } from './invoicing.service';

/** A till's line as the centre accepted it: the VAT inside, no city tax at the supermarket. */
export interface PosCreditLine {
  lineNo: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  uomName: string;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  listPrice: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
  vatType: VatType;
  vatRatePct: Decimal;
  vatAmount: Decimal;
}

/** A till's sale with credit (ADR-0109): what the customer owes and what the till took in money. */
export interface PosCreditSale {
  /** The till's number (`К3-261016-0045`), kept on the invoice as its order number. */
  number: string;
  customerId: number;
  branchId: number | null;
  warehouseId: number;
  lines: PosCreditLine[];
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
  /** The part on credit: the receivable's open item. */
  credit: Decimal;
  /** The part paid at the till, booked here instead of the shift's close. */
  cash: Decimal;
  card: Decimal;
}

/** A till's return of a credit sale: off the customer's debt first, the rest paid back in cash. */
export interface PosCreditReturn {
  number: string;
  invoiceId: number;
  /** The returned quantities by the sold line's number (the invoice keeps the till's numbers). */
  lines: { soldLineNo: number; qty: Decimal; total: Decimal; vatAmount: Decimal }[];
  credit: Decimal;
  cash: Decimal;
}

/**
 * The supermarket's sales on credit in the books (ADR-0109, amending ADR-0064 #1): a till's sale
 * with a CREDIT tender becomes an invoice of its customer — the receivable due on the customer's
 * settlement day for the credit part, the cash and card the till took for the rest, the supermarket's
 * revenue and the VAT — posted in the transaction that accepts the sale, so the shift's close
 * leaves it out. A return of it is a credit note: off the receivable first, the rest paid back
 * from the till's cash. No goods move here; the till's documents moved them.
 */
@Injectable()
export class PosCreditService {
  constructor(
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
    private readonly settings: FinanceSettingsService,
    private readonly posting: FinPosting,
    private readonly books: FinBooks,
    private readonly parties: FinPartiesBridge,
  ) {}

  async invoiceSaleInTx(
    tx: Tx,
    actor: Actor,
    sale: PosCreditSale,
  ): Promise<{ invoiceId: number; number: string }> {
    if (!sale.credit.gt(0)) throw new Error('a credit sale owes something');
    if (!sale.credit.plus(sale.cash).plus(sale.card).eq(sale.total)) {
      throw new AppError('POS_TOTALS_MISMATCH', 'the tenders do not make the total', {
        field: 'tenders',
        expected: sale.total.toFixed(2),
        got: sale.credit.plus(sale.cash).plus(sale.card).toFixed(2),
      });
    }
    const today = businessDate();
    const customer = await this.customers.lockForUpdate(tx, sale.customerId);
    const dueDate = settlementDueDate(customer.settlementGroup, today);
    const number = await this.settings.allocateNumber(tx, 'INVOICE', today);
    const [invoice] = await tx
      .insert(invoices)
      .values({
        number,
        customerId: customer.id,
        orderId: null,
        orderNumber: sale.number,
        branchId: sale.branchId,
        invoiceDate: today,
        dueDate,
        paymentMethod: 'CREDIT',
        subtotal: sale.subtotal,
        discountTotal: sale.discountTotal,
        total: sale.total,
        vatTotal: sale.vatTotal,
        cityTaxTotal: new Decimal(0),
        openAmount: sale.total,
        note: null,
        createdBy: null,
      })
      .returning({ id: invoices.id });
    if (!invoice) throw new Error('invoices insert returned no row');
    await tx.insert(invoiceLines).values(
      sale.lines.map((line) => ({
        invoiceId: invoice.id,
        lineNo: line.lineNo,
        orderLineId: null,
        productId: line.productId,
        productSku: line.productSku,
        productName: line.productName,
        productUnitId: line.productUnitId,
        uomName: line.uomName,
        basis: 'RETAIL' as const,
        qty: line.qty,
        factorSnapshot: line.factorSnapshot,
        qtyBase: line.qtyBase,
        warehouseId: sale.warehouseId,
        listPrice: line.listPrice,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        discountAmount: line.discountAmount,
        total: line.total,
        vatType: line.vatType,
        vatRatePct: line.vatRatePct,
        cityTaxRatePct: new Decimal(0),
        vatAmount: line.vatAmount,
        cityTaxAmount: new Decimal(0),
      })),
    );
    const party = await this.parties.customerPartyIn(tx, customer.id);
    const lines = posSaleEntryLines({ ...sale, dueDate });
    const result = await this.posting.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: {
          system: BTO_SOURCE,
          docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
          docId: String(invoice.id),
          docNo: number,
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.SALES_INVOICE.code,
          documentDate: today,
          currency: 'MNT',
          party,
          dueDate,
          description: documentLabel(number, party.name),
          controlTotal: controlTotal(lines),
          lines: intakeLines(lines),
          attributes: { orderNumber: sale.number, posSale: sale.number },
        },
      },
      sale.branchId,
    );
    await tx
      .update(invoices)
      .set({ journalEntryId: entryIdOf(result) })
      .where(eq(invoices.id, invoice.id));
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'invoices',
      entityId: invoice.id,
      after: {
        number,
        orderNumber: sale.number,
        customerId: customer.id,
        total: sale.total.toFixed(2),
        credit: sale.credit.toFixed(2),
        dueDate,
        source: 'POS',
      },
    });
    return { invoiceId: invoice.id, number };
  }

  async creditReturnInTx(
    tx: Tx,
    actor: Actor,
    input: PosCreditReturn,
  ): Promise<{ creditNoteId: number; number: string }> {
    if (!input.credit.gt(0)) throw new Error('a credit return takes something off the debt');
    const [head] = await tx
      .select({ customerId: invoices.customerId })
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId));
    if (!head) throw notFound('invoice', input.invoiceId);
    await this.customers.lockForUpdate(tx, head.customerId);
    const [invoice] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, input.invoiceId))
      .for('update');
    if (!invoice) throw notFound('invoice', input.invoiceId);
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
    const sold = await tx
      .select()
      .from(invoiceLines)
      .where(
        and(
          eq(invoiceLines.invoiceId, invoice.id),
          inArray(
            invoiceLines.lineNo,
            input.lines.map((line) => line.soldLineNo),
          ),
        ),
      );
    const byLineNo = new Map(sold.map((line) => [line.lineNo, line]));
    const lines = input.lines.map((line, index) => {
      const row = byLineNo.get(line.soldLineNo);
      if (!row) throw notFound('invoice_line', line.soldLineNo);
      const qtyBase = line.qty.times(row.factorSnapshot);
      return {
        lineNo: index + 1,
        invoiceLineId: row.id,
        productId: row.productId,
        productUnitId: row.productUnitId,
        uomName: row.uomName,
        qty: line.qty,
        factorSnapshot: row.factorSnapshot,
        qtyBase,
        unitPrice: row.unitPrice,
        subtotal: line.total,
        discountAmount: new Decimal(0),
        total: line.total,
        vatAmount: line.vatAmount,
        cityTaxAmount: new Decimal(0),
      };
    });
    const sum = (pick: (line: (typeof lines)[number]) => Decimal) =>
      lines.reduce((acc, line) => acc.plus(pick(line)), new Decimal(0));
    const total = sum((line) => line.total);
    const vatTotal = sum((line) => line.vatAmount);
    if (!input.credit.plus(input.cash).eq(total)) {
      throw new AppError('POS_TOTALS_MISMATCH', 'the refund does not make the total', {
        field: 'tenders',
        expected: total.toFixed(2),
        got: input.credit.plus(input.cash).toFixed(2),
      });
    }
    const today = businessDate();
    const number = await this.settings.allocateNumber(tx, 'CREDIT_NOTE', today);
    const [note] = await tx
      .insert(creditNotes)
      .values({
        number,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        noteDate: today,
        reason: input.number,
        warehouseId: null,
        binId: null,
        subtotal: total,
        discountTotal: new Decimal(0),
        total,
        vatTotal,
        cityTaxTotal: new Decimal(0),
        createdBy: null,
      })
      .returning({ id: creditNotes.id });
    if (!note) throw new Error('credit_notes insert returned no row');
    await tx
      .insert(creditNoteLines)
      .values(lines.map((line) => ({ ...line, creditNoteId: note.id })));
    for (const line of lines) {
      await tx
        .update(invoiceLines)
        .set({
          returnedBase: sql`${invoiceLines.returnedBase} + ${line.qtyBase.toFixed(3)}::numeric`,
        })
        .where(eq(invoiceLines.id, line.invoiceLineId));
    }
    const settles = Decimal.min(input.credit, invoice.openAmount);
    const party = await this.parties.customerPartyIn(tx, invoice.customerId);
    const entry = posReturnEntryLines({
      invoiceId: invoice.id,
      total,
      vatTotal,
      credit: input.credit,
      cash: input.cash,
      settles,
    });
    const result = await this.posting.submitInTx(
      tx,
      this.books.source(actor),
      {
        source: {
          system: BTO_SOURCE,
          docType: FIN_DOC_TYPES.SALES_RETURN.docType,
          docId: String(note.id),
          docNo: number,
        },
        body: {
          action: 'POST',
          documentType: FIN_DOC_TYPES.SALES_RETURN.code,
          documentDate: today,
          currency: 'MNT',
          party,
          description: documentLabel(number, party.name),
          controlTotal: controlTotal(entry),
          lines: intakeLines(entry),
          attributes: { invoiceNumber: invoice.number, posSale: input.number },
        },
      },
      invoice.branchId,
    );
    await tx
      .update(creditNotes)
      .set({ journalEntryId: entryIdOf(result) })
      .where(eq(creditNotes.id, note.id));
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'credit_notes',
      entityId: note.id,
      after: {
        number,
        invoiceNumber: invoice.number,
        total: total.toFixed(2),
        credit: input.credit.toFixed(2),
        cash: input.cash.toFixed(2),
        allocated: settles.toFixed(2),
        source: 'POS',
      },
    });
    return { creditNoteId: note.id, number };
  }
}

/**
 * A till's credit sale (ADR-0109): Dr receivables for the credit part (an item due on the
 * settlement day), Dr the till's cash and the card clearing for what was paid there, Cr the
 * supermarket's sales net of VAT, Cr VAT payable with its base; zero lines skipped.
 */
export function posSaleEntryLines(sale: {
  total: Decimal;
  vatTotal: Decimal;
  credit: Decimal;
  cash: Decimal;
  card: Decimal;
  dueDate: string;
}): RoleLine[] {
  const zero = new Decimal(0);
  const net = sale.total.minus(sale.vatTotal);
  const lines: RoleLine[] = [
    {
      role: 'AR',
      debit: sale.credit,
      credit: zero,
      extra: { openItem: { dueDate: sale.dueDate } },
    },
  ];
  if (sale.cash.gt(0)) lines.push({ role: 'POS_CASH', debit: sale.cash, credit: zero });
  if (sale.card.gt(0)) lines.push({ role: 'CARD_CLEARING', debit: sale.card, credit: zero });
  if (net.gt(0)) lines.push({ role: 'POS_SALES', debit: zero, credit: net });
  if (sale.vatTotal.gt(0)) {
    lines.push({ role: 'VAT_PAYABLE', debit: zero, credit: sale.vatTotal, taxBase: net });
  }
  return lines;
}

/**
 * Its return: Dr sales returns net of VAT, Dr VAT payable, Cr receivables for the credit part
 * (settling the invoice up to what is open), Cr the till's cash for what was paid back in cash.
 */
export function posReturnEntryLines(note: {
  invoiceId: number;
  total: Decimal;
  vatTotal: Decimal;
  credit: Decimal;
  cash: Decimal;
  settles: Decimal;
}): RoleLine[] {
  const zero = new Decimal(0);
  const net = note.total.minus(note.vatTotal);
  const lines: RoleLine[] = [];
  if (net.gt(0)) lines.push({ role: 'SALES_RETURN', debit: net, credit: zero });
  if (note.vatTotal.gt(0)) {
    lines.push({ role: 'VAT_PAYABLE', debit: note.vatTotal, credit: zero, taxBase: net });
  }
  lines.push({
    role: 'AR',
    debit: zero,
    credit: note.credit,
    ...(note.settles.gt(0)
      ? {
          extra: {
            settles: [
              {
                target: {
                  system: BTO_SOURCE,
                  docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
                  docId: String(note.invoiceId),
                },
                amount: note.settles.toFixed(2),
              },
            ],
          },
        }
      : {}),
  });
  if (note.cash.gt(0)) lines.push({ role: 'POS_CASH', debit: zero, credit: note.cash });
  return lines;
}
