import { Inject, Injectable } from '@nestjs/common';
import { FINANCE_LIMITS, taxSplit } from '@tugeel/shared/finance';
import { Decimal, toWholeMnt } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  AuditService,
  type AuthContext,
  OrgService,
  ScopeService,
  UserNamesService,
} from '../../identity';
import { BinsService, type Movement, StockPostingService } from '../../inventory';
import { CustomersService } from '../../partners';
import {
  allocations,
  creditNoteLines,
  creditNotes,
  invoiceLines,
  invoices,
  journalEntries,
} from '../schema';
import { ArLedgerService } from './ar-ledger.service';
import { FinanceSettingsService } from './finance-settings.service';
import { GlAccountsService } from './gl-accounts.service';
import { assertNotFuture, type JournalLineInput, JournalService } from './journal.service';

export interface CreditNoteLineInput {
  invoiceLineId: number;
  /** In the invoice line's unit. */
  qty: Decimal;
}

export interface CreditNoteInput {
  invoiceId: number;
  reason: string;
  noteDate: string | null;
  /** Where the goods go back; null = nothing comes back (a price correction). */
  warehouseId: number | null;
  /** The bin; null = the warehouse's RETURNS bin. */
  binId: number | null;
  lines: readonly CreditNoteLineInput[];
}

export interface CreditNoteSummary {
  id: number;
  number: string;
  invoiceId: number;
  invoiceNumber: string;
  customerId: number;
  customerCode: string;
  customerName: string;
  noteDate: string;
  reason: string;
  warehouseId: number | null;
  warehouseName: string | null;
  binId: number | null;
  binCode: string | null;
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
  cityTaxTotal: Decimal;
  /** What the note settled of the invoice; the rest is an advance of the customer. */
  allocatedAmount: Decimal;
  journalEntryId: number | null;
  journalNumber: string | null;
  lineCount: number;
  createdAt: Date;
  createdByName: string | null;
}

export interface CreditNoteLineView {
  id: number;
  lineNo: number;
  invoiceLineId: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  uomName: string;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
  vatAmount: Decimal;
  cityTaxAmount: Decimal;
}

export interface CreditNoteDetail extends CreditNoteSummary {
  lines: CreditNoteLineView[];
}

export interface CreditNoteQuery {
  invoiceId?: number;
  customerId?: number;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

type NoteRow = typeof creditNotes.$inferSelect;
const QTY_SCALE = 3;

/**
 * Credit notes (ADR-0060 #6): goods of an invoice taken back into a warehouse (`CN` / `RETURN_IN`
 * on the ledger, the RETURNS bin unless another is named) at the invoiced prices, the receivable
 * reduced and the invoice settled up to its open amount. The entry: Dr sales returns net of the
 * taxes, Dr the taxes payable, Cr receivables.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly org: OrgService,
    private readonly names: UserNamesService,
    private readonly bins: BinsService,
    private readonly posting: StockPostingService,
    private readonly customers: CustomersService,
    private readonly settings: FinanceSettingsService,
    private readonly journal: JournalService,
    private readonly accounts: GlAccountsService,
    private readonly ledger: ArLedgerService,
  ) {}

  async create(ctx: AuthContext, input: CreditNoteInput): Promise<CreditNoteDetail> {
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > FINANCE_LIMITS.maxReason) {
      throw invalid('reason', 'length', `1 to ${FINANCE_LIMITS.maxReason} characters`);
    }
    if (input.lines.length === 0) throw invalid('lines', 'min', 'at least one line');
    if (input.lines.length > FINANCE_LIMITS.maxCreditNoteLines) {
      throw invalid('lines', 'max', `at most ${FINANCE_LIMITS.maxCreditNoteLines} lines`);
    }
    const seen = new Set<number>();
    input.lines.forEach((line, index) => {
      if (seen.has(line.invoiceLineId)) {
        throw invalid(`lines[${index}].invoiceLineId`, 'unique', 'listed once');
      }
      seen.add(line.invoiceLineId);
      if (!line.qty.gt(0) || line.qty.decimalPlaces() > QTY_SCALE) {
        throw invalid(`lines[${index}].qty`, 'positive', 'a positive quantity with 3 decimals');
      }
    });
    const noteDate = input.noteDate ?? businessDate();
    assertNotFuture(noteDate, 'noteDate');
    if (input.warehouseId !== null) this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    if (input.warehouseId === null && input.binId !== null) {
      throw invalid('binId', 'warehouse', 'a bin needs its warehouse');
    }
    const id = await inTransaction(this.db, async (tx) => {
      const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId));
      if (!invoice) throw notFound('invoice', input.invoiceId);
      this.assertIssued(invoice);
      const rows = await tx
        .select()
        .from(invoiceLines)
        .where(
          and(
            eq(invoiceLines.invoiceId, invoice.id),
            inArray(
              invoiceLines.id,
              input.lines.map((line) => line.invoiceLineId),
            ),
          ),
        );
      const byId = new Map(rows.map((row) => [row.id, row]));
      const lines = input.lines.map((line, index) => {
        const row = byId.get(line.invoiceLineId);
        if (!row) {
          throw invalid(`lines[${index}].invoiceLineId`, 'ofInvoice', 'a line of the invoice');
        }
        const qtyBase = line.qty.times(row.factorSnapshot);
        const remaining = row.qtyBase.minus(row.returnedBase);
        if (qtyBase.gt(remaining)) {
          throw invalid(
            `lines[${index}].qty`,
            'max',
            `at most ${remaining.div(row.factorSnapshot).toFixed()} ${row.uomName} left to return`,
          );
        }
        const subtotal = toWholeMnt(row.unitPrice.times(line.qty));
        const discountAmount = line.qty.eq(row.qty)
          ? row.discountAmount
          : toWholeMnt(row.discountAmount.times(line.qty).div(row.qty));
        const total = subtotal.minus(discountAmount);
        const split = taxSplit(total, row.vatRatePct, row.cityTaxRatePct);
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
          subtotal,
          discountAmount,
          total,
          vatAmount: split.vat,
          cityTaxAmount: split.cityTax,
        };
      });
      const sum = (pick: (line: (typeof lines)[number]) => Decimal) =>
        lines.reduce((acc, line) => acc.plus(pick(line)), new Decimal(0));
      const totals = {
        subtotal: sum((line) => line.subtotal),
        discountTotal: sum((line) => line.discountAmount),
        total: sum((line) => line.total),
        vatTotal: sum((line) => line.vatAmount),
        cityTaxTotal: sum((line) => line.cityTaxAmount),
      };
      if (!totals.total.gt(0)) throw invalid('lines', 'amount', 'the note amounts to nothing');
      const bin =
        input.warehouseId === null
          ? null
          : input.binId === null
            ? await this.bins.systemBin(input.warehouseId, 'RETURNS', tx)
            : await this.bins.get(input.binId, tx);
      if (bin && bin.warehouseId !== input.warehouseId) {
        throw invalid('binId', 'ofWarehouse', 'a bin of the warehouse');
      }
      const number = await this.settings.allocateNumber(tx, 'CREDIT_NOTE', noteDate);
      const [note] = await tx
        .insert(creditNotes)
        .values({
          number,
          invoiceId: invoice.id,
          customerId: invoice.customerId,
          noteDate,
          reason,
          warehouseId: input.warehouseId,
          binId: bin?.id ?? null,
          ...totals,
          createdBy: ctx.userId,
        })
        .returning({ id: creditNotes.id });
      if (!note) throw new Error('credit_notes insert returned no row');
      const inserted = await tx
        .insert(creditNoteLines)
        .values(lines.map((line) => ({ ...line, creditNoteId: note.id })))
        .returning({ id: creditNoteLines.id, lineNo: creditNoteLines.lineNo });
      const lineIds = new Map(inserted.map((row) => [row.lineNo, row.id]));
      // Lock order (docs/modules/finance.md §4): the stock first, then the customer, then the invoice.
      if (input.warehouseId !== null && bin) {
        const warehouseId = input.warehouseId;
        const movements: Movement[] = lines.map((line) => ({
          docType: 'CN',
          docId: note.id,
          docLineId: lineIds.get(line.lineNo) ?? 0,
          movementType: 'RETURN_IN',
          leg: 1,
          warehouseId,
          binId: bin.id,
          productId: line.productId,
          qtyBase: line.qtyBase,
          enteredQty: line.qty,
          productUnitId: line.productUnitId,
          factorSnapshot: line.factorSnapshot,
        }));
        await this.posting.post(tx, ctx, {
          docs: [{ docType: 'CN', docId: note.id, external: true }],
          movements,
        });
      }
      await this.customers.lockForUpdate(tx, invoice.customerId);
      const [locked] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoice.id))
        .for('update');
      if (!locked) throw notFound('invoice', invoice.id);
      this.assertIssued(locked);
      for (const line of lines) {
        await tx
          .update(invoiceLines)
          .set({
            returnedBase: sql`${invoiceLines.returnedBase} + ${line.qtyBase.toFixed(3)}::numeric`,
          })
          .where(eq(invoiceLines.id, line.invoiceLineId));
      }
      const allocated = Decimal.min(totals.total, locked.openAmount);
      if (allocated.gt(0)) {
        await tx.insert(allocations).values({
          sourceType: 'CREDIT_NOTE',
          sourceId: note.id,
          invoiceId: invoice.id,
          amount: allocated,
        });
        await tx
          .update(invoices)
          .set({ openAmount: sql`${invoices.openAmount} - ${allocated.toFixed(2)}::numeric` })
          .where(eq(invoices.id, invoice.id));
      }
      const zero = new Decimal(0);
      const entryLines: JournalLineInput[] = [];
      const net = totals.total.minus(totals.vatTotal).minus(totals.cityTaxTotal);
      if (net.gt(0)) {
        entryLines.push({
          accountId: (await this.accounts.byRole('SALES_RETURN', tx)).id,
          debit: net,
          credit: zero,
        });
      }
      if (totals.vatTotal.gt(0)) {
        entryLines.push({
          accountId: (await this.accounts.byRole('VAT_PAYABLE', tx)).id,
          debit: totals.vatTotal,
          credit: zero,
        });
      }
      if (totals.cityTaxTotal.gt(0)) {
        entryLines.push({
          accountId: (await this.accounts.byRole('CITY_TAX_PAYABLE', tx)).id,
          debit: totals.cityTaxTotal,
          credit: zero,
        });
      }
      entryLines.push({
        accountId: (await this.accounts.byRole('AR', tx)).id,
        debit: zero,
        credit: totals.total,
        customerId: invoice.customerId,
      });
      const [customer] = await this.customers.getMany([invoice.customerId], tx);
      const entry = await this.journal.post(tx, ctx, {
        entryDate: noteDate,
        description: customer ? `${number} — ${customer.name}` : number,
        source: 'AUTO_CREDIT_NOTE',
        sourceType: 'CREDIT_NOTE',
        sourceId: note.id,
        lines: entryLines,
      });
      await tx
        .update(creditNotes)
        .set({ journalEntryId: entry.id })
        .where(eq(creditNotes.id, note.id));
      await this.ledger.record(tx, {
        customerId: invoice.customerId,
        entryDate: noteDate,
        kind: 'CREDIT_NOTE',
        docType: 'CREDIT_NOTE',
        docId: note.id,
        docNumber: number,
        debit: zero,
        credit: totals.total,
      });
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'credit_notes',
        entityId: note.id,
        after: {
          number,
          invoiceNumber: invoice.number,
          total: totals.total.toFixed(2),
          allocated: allocated.toFixed(2),
          warehouseId: input.warehouseId,
          lines: lines.map((line) => ({
            invoiceLineId: line.invoiceLineId,
            qty: line.qty.toFixed(),
          })),
        },
      });
      return note.id;
    });
    return this.get(id);
  }

  async list(
    query: CreditNoteQuery,
  ): Promise<{ data: CreditNoteSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.invoiceId) filters.push(eq(creditNotes.invoiceId, query.invoiceId));
    if (query.customerId) filters.push(eq(creditNotes.customerId, query.customerId));
    if (query.from) filters.push(sql`${creditNotes.noteDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${creditNotes.noteDate} <= ${query.to}`);
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(sql`${creditNotes.id} < ${after.id}`);
    const rows = await this.db
      .select(this.summaryColumns())
      .from(creditNotes)
      .leftJoin(journalEntries, eq(journalEntries.id, creditNotes.journalEntryId))
      .leftJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(creditNotes.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.note.id }));
    return { data: await this.summaries(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<CreditNoteDetail> {
    const [row] = await this.db
      .select(this.summaryColumns())
      .from(creditNotes)
      .leftJoin(journalEntries, eq(journalEntries.id, creditNotes.journalEntryId))
      .leftJoin(invoices, eq(invoices.id, creditNotes.invoiceId))
      .where(eq(creditNotes.id, id));
    if (!row) throw notFound('credit_note', id);
    const [summary] = await this.summaries([row]);
    if (!summary) throw notFound('credit_note', id);
    const lines = await this.db
      .select({
        line: creditNoteLines,
        sku: invoiceLines.productSku,
        name: invoiceLines.productName,
      })
      .from(creditNoteLines)
      .innerJoin(invoiceLines, eq(invoiceLines.id, creditNoteLines.invoiceLineId))
      .where(eq(creditNoteLines.creditNoteId, id))
      .orderBy(asc(creditNoteLines.lineNo));
    return {
      ...summary,
      lines: lines.map(({ line, sku, name }) => ({
        id: line.id,
        lineNo: line.lineNo,
        invoiceLineId: line.invoiceLineId,
        productId: line.productId,
        productSku: sku,
        productName: name,
        productUnitId: line.productUnitId,
        uomName: line.uomName,
        qty: line.qty,
        factorSnapshot: line.factorSnapshot,
        qtyBase: line.qtyBase,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        discountAmount: line.discountAmount,
        total: line.total,
        vatAmount: line.vatAmount,
        cityTaxAmount: line.cityTaxAmount,
      })),
    };
  }

  private assertIssued(invoice: { number: string; status: string }): void {
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
  }

  private summaryColumns() {
    return {
      note: creditNotes,
      invoiceNumber: invoices.number,
      journalNumber: journalEntries.number,
      lineCount: sql<string>`(SELECT count(*) FROM credit_note_lines l WHERE l.credit_note_id = credit_notes.id)`,
      allocatedAmount: sql<string>`(SELECT coalesce(sum(a.amount), 0) FROM allocations a
        WHERE a.source_type = 'CREDIT_NOTE' AND a.source_id = credit_notes.id AND a.voided_at IS NULL)`,
    };
  }

  private async summaries(
    rows: {
      note: NoteRow;
      invoiceNumber: string | null;
      journalNumber: string | null;
      lineCount: string;
      allocatedAmount: string;
    }[],
  ): Promise<CreditNoteSummary[]> {
    if (rows.length === 0) return [];
    const customers = new Map(
      (await this.customers.getMany(rows.map((row) => row.note.customerId))).map((customer) => [
        customer.id,
        customer,
      ]),
    );
    const warehouses = new Map((await this.org.listWarehouses()).map((w) => [w.id, w.name]));
    const binIds = rows.flatMap((row) => (row.note.binId === null ? [] : [row.note.binId]));
    const bins = new Map((await this.bins.getMany(binIds)).map((bin) => [bin.id, bin.code]));
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.note.createdBy === null ? [] : [row.note.createdBy])),
    );
    return rows.map(({ note, invoiceNumber, journalNumber, lineCount, allocatedAmount }) => ({
      id: note.id,
      number: note.number,
      invoiceId: note.invoiceId,
      invoiceNumber: invoiceNumber ?? '',
      customerId: note.customerId,
      customerCode: customers.get(note.customerId)?.code ?? '',
      customerName: customers.get(note.customerId)?.name ?? '',
      noteDate: note.noteDate,
      reason: note.reason,
      warehouseId: note.warehouseId,
      warehouseName: note.warehouseId === null ? null : (warehouses.get(note.warehouseId) ?? null),
      binId: note.binId,
      binCode: note.binId === null ? null : (bins.get(note.binId) ?? null),
      subtotal: note.subtotal,
      discountTotal: note.discountTotal,
      total: note.total,
      vatTotal: note.vatTotal,
      cityTaxTotal: note.cityTaxTotal,
      allocatedAmount: new Decimal(allocatedAmount),
      journalEntryId: note.journalEntryId,
      journalNumber,
      lineCount: Number.parseInt(lineCount, 10),
      createdAt: note.createdAt,
      createdByName: note.createdBy === null ? null : (names.get(note.createdBy) ?? null),
    }));
  }
}
