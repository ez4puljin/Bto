import { Inject, Injectable } from '@nestjs/common';
import {
  type AllocationSource,
  type InvoiceStatus,
  type Settlement,
  settlementOf,
} from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import type { PriceBasis } from '@tugeel/shared/pricing';
import type { PaymentMethod } from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import type { VatType } from '../../catalog';
import { type AuthContext, OrgService, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import { FinReader } from '../../../finance-core';
import { BTO_SOURCE, FIN_DOC_TYPES } from '../../fin-bridge';
import { creditNotes, invoiceLines, invoices } from '../schema';
import { FinBooks } from './fin-books';
import { JournalService } from './journal.service';

export interface InvoiceSummary {
  id: number;
  number: string;
  status: InvoiceStatus;
  settlement: Settlement;
  customerId: number;
  customerCode: string;
  customerName: string;
  orderId: number | null;
  orderNumber: string | null;
  branchId: number | null;
  branchName: string | null;
  invoiceDate: string;
  dueDate: string;
  /** Issued, not settled and past due today. */
  overdue: boolean;
  paymentMethod: PaymentMethod;
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
  cityTaxTotal: Decimal;
  openAmount: Decimal;
  lineCount: number;
  createdAt: Date;
  createdByName: string | null;
}

export interface InvoiceLineView {
  id: number;
  lineNo: number;
  orderLineId: number | null;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  uomName: string;
  basis: PriceBasis;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  warehouseId: number | null;
  warehouseName: string | null;
  listPrice: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
  vatType: VatType;
  vatRatePct: Decimal;
  cityTaxRatePct: Decimal;
  vatAmount: Decimal;
  cityTaxAmount: Decimal;
  returnedBase: Decimal;
}

export interface InvoiceAllocationView {
  id: number;
  sourceType: AllocationSource;
  sourceId: number;
  sourceNumber: string;
  sourceDate: string;
  amount: Decimal;
  createdAt: Date;
  voidedAt: Date | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  note: string | null;
  journalEntryId: number | null;
  journalNumber: string | null;
  voidedAt: Date | null;
  voidedByName: string | null;
  voidReason: string | null;
  voidJournalEntryId: number | null;
  lines: InvoiceLineView[];
  allocations: InvoiceAllocationView[];
  creditNotes: { id: number; number: string; noteDate: string; total: Decimal }[];
}

export interface InvoiceQuery {
  /** Part of the number, the order number or a customer's name or code. */
  q?: string;
  customerId?: number;
  orderId?: number;
  branchId?: number;
  settlement?: Settlement;
  status?: InvoiceStatus;
  overdue?: boolean;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

type InvoiceRow = typeof invoices.$inferSelect;

/** Reads of invoices (ADR-0060 #11): the list, one invoice with its lines and settlements. */
@Injectable()
export class InvoiceQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly customers: CustomersService,
    private readonly org: OrgService,
    private readonly names: UserNamesService,
    private readonly journal: JournalService,
    private readonly reader: FinReader,
    private readonly books: FinBooks,
  ) {}

  async list(
    ctx: AuthContext,
    query: InvoiceQuery,
  ): Promise<{ data: InvoiceSummary[]; nextCursor: string | null; total: number | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const today = businessDate();
    const filters: SQL[] = [];
    if (query.customerId) filters.push(eq(invoices.customerId, query.customerId));
    if (query.orderId) filters.push(eq(invoices.orderId, query.orderId));
    if (query.branchId) filters.push(eq(invoices.branchId, query.branchId));
    if (query.status) filters.push(eq(invoices.status, query.status));
    if (query.settlement) filters.push(this.settlementSql(query.settlement));
    if (query.overdue) filters.push(this.overdueSql(today));
    if (query.from) filters.push(sql`${invoices.invoiceDate} >= ${query.from}`);
    if (query.to) filters.push(sql`${invoices.invoiceDate} <= ${query.to}`);
    const q = query.q?.trim();
    if (q) {
      const customerIds = (await this.customers.list(ctx, { q, limit: 200 })).data.map(
        (customer) => customer.id,
      );
      const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      filters.push(
        or(
          sql`${invoices.number} ILIKE ${pattern}`,
          sql`${invoices.orderNumber} ILIKE ${pattern}`,
          ...(customerIds.length ? [inArray(invoices.customerId, customerIds)] : []),
        ) as SQL,
      );
    }
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(invoices.id, after.id)] : [];
    const rows = await this.db
      .select({
        invoice: invoices,
        lineCount: sql<string>`(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = invoices.id)`,
      })
      .from(invoices)
      .where(and(...filters, ...paged))
      .orderBy(desc(invoices.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.invoice.id }));
    let total: number | null = null;
    if (!query.cursor) {
      const [counted] = await this.db
        .select({ count: sql<string>`count(*)` })
        .from(invoices)
        .where(and(...filters));
      total = Number.parseInt(counted?.count ?? '0', 10);
    }
    return { data: await this.summaries(page.data, today), nextCursor: page.nextCursor, total };
  }

  async get(id: number): Promise<InvoiceDetail> {
    const [row] = await this.db
      .select({
        invoice: invoices,
        lineCount: sql<string>`(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = invoices.id)`,
      })
      .from(invoices)
      .where(eq(invoices.id, id));
    if (!row) throw notFound('invoice', id);
    const [summary] = await this.summaries([row], businessDate());
    if (!summary) throw notFound('invoice', id);
    const warehouses = new Map((await this.org.listWarehouses()).map((w) => [w.id, w.name]));
    const lines = await this.db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, id))
      .orderBy(asc(invoiceLines.lineNo));
    const allocations = await this.allocationsOf(id);
    const notes = await this.db
      .select({
        id: creditNotes.id,
        number: creditNotes.number,
        noteDate: creditNotes.noteDate,
        total: creditNotes.total,
      })
      .from(creditNotes)
      .where(eq(creditNotes.invoiceId, id))
      .orderBy(asc(creditNotes.id));
    const voidedByName =
      row.invoice.voidedBy === null
        ? null
        : ((await this.names.namesOf([row.invoice.voidedBy])).get(row.invoice.voidedBy) ?? null);
    return {
      ...summary,
      note: row.invoice.note,
      journalEntryId: row.invoice.journalEntryId,
      journalNumber:
        row.invoice.journalEntryId === null
          ? null
          : ((await this.journal.numbersOf([row.invoice.journalEntryId])).get(
              row.invoice.journalEntryId,
            ) ?? null),
      voidedAt: row.invoice.voidedAt,
      voidedByName,
      voidReason: row.invoice.voidReason,
      voidJournalEntryId: row.invoice.voidJournalEntryId,
      lines: lines.map((line) => ({
        ...line,
        warehouseName:
          line.warehouseId === null ? null : (warehouses.get(line.warehouseId) ?? null),
      })),
      allocations,
      creditNotes: notes,
    };
  }

  /**
   * What settled an invoice (F2, ADR-0090): the allocations on its item in the Finance Core, each
   * with the document that made it — a voucher, a credit note or the accountant's allocation — and
   * when it was undone (a voided voucher, a reversed allocation).
   */
  private async allocationsOf(invoiceId: number): Promise<InvoiceAllocationView[]> {
    const company = await this.books.company();
    const ctx = this.books.source();
    const document = (
      await this.reader.documentsOfSource(ctx, {
        company,
        system: BTO_SOURCE,
        docType: FIN_DOC_TYPES.SALES_INVOICE.docType,
        docIds: [String(invoiceId)],
      })
    ).get(String(invoiceId));
    if (!document) return [];
    const rows = await this.reader.allocationsOf(ctx, { company, documentIds: [document.id] });
    return rows.flatMap((row) => {
      const by = row.byDocument;
      const sourceType: AllocationSource | null =
        by.typeCode === FIN_DOC_TYPES.SALES_RETURN.code
          ? 'CREDIT_NOTE'
          : by.typeCode === FIN_DOC_TYPES.ALLOCATION.code
            ? 'ALLOCATION'
            : by.class === 'RECEIPT' || by.class === 'PAYMENT'
              ? 'PAYMENT'
              : null;
      if (sourceType === null) return [];
      const sourceId =
        sourceType === 'CREDIT_NOTE' && row.counterpart.documentId === by.id
          ? Number.parseInt(row.counterpart.sourceDocId, 10)
          : by.id;
      return [
        {
          id: row.id,
          sourceType,
          sourceId,
          sourceNumber: by.number,
          sourceDate: by.documentDate,
          amount: row.amount,
          createdAt: row.createdAt,
          voidedAt: row.undoneAt,
        },
      ];
    });
  }

  /**
   * One invoice of the customer app's store (ADR-0079 #7): 404 for an invoice of any other
   * customer, exactly as for one that does not exist.
   */
  async ofCustomer(customerId: number, id: number): Promise<InvoiceDetail> {
    const [own] = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.id, id), eq(invoices.customerId, customerId)));
    if (!own) throw notFound('invoice', id);
    return this.get(id);
  }

  /** The invoice of a sold order, if one was issued (the customer app's order page). */
  async ofOrder(
    orderId: number,
  ): Promise<{ id: number; number: string; status: InvoiceStatus } | null> {
    const [row] = await this.db
      .select({ id: invoices.id, number: invoices.number, status: invoices.status })
      .from(invoices)
      .where(eq(invoices.orderId, orderId));
    return row ?? null;
  }

  /**
   * The open invoices the nightly reminders look at (ADR-0079 #8): due on `fromDue` … `toDue`
   * (both `YYYY-MM-DD`, included), with what the notification says.
   */
  async openDueBetween(
    fromDue: string,
    toDue: string,
  ): Promise<
    { id: number; number: string; customerId: number; dueDate: string; openAmount: Decimal }[]
  > {
    return this.db
      .select({
        id: invoices.id,
        number: invoices.number,
        customerId: invoices.customerId,
        dueDate: invoices.dueDate,
        openAmount: invoices.openAmount,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, 'ISSUED'),
          gt(invoices.openAmount, new Decimal(0)),
          sql`${invoices.dueDate} BETWEEN ${fromDue}::date AND ${toDue}::date`,
        ),
      )
      .orderBy(asc(invoices.dueDate), asc(invoices.id));
  }

  /** The open invoices of a customer, oldest due first (what a payment is allocated to). */
  async openOf(customerId: number): Promise<InvoiceSummary[]> {
    const rows = await this.db
      .select({
        invoice: invoices,
        lineCount: sql<string>`(SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = invoices.id)`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.status, 'ISSUED'),
          gt(invoices.openAmount, new Decimal(0)),
        ),
      )
      .orderBy(asc(invoices.dueDate), asc(invoices.id));
    return this.summaries(rows, businessDate());
  }

  private settlementSql(settlement: Settlement): SQL {
    const issued = eq(invoices.status, 'ISSUED');
    switch (settlement) {
      case 'OPEN':
        return and(issued, sql`${invoices.openAmount} = ${invoices.total}`) as SQL;
      case 'PARTIAL':
        return and(
          issued,
          gt(invoices.openAmount, new Decimal(0)),
          sql`${invoices.openAmount} < ${invoices.total}`,
        ) as SQL;
      case 'PAID':
        return and(issued, sql`${invoices.openAmount} <= 0`) as SQL;
    }
  }

  private overdueSql(today: string): SQL {
    return and(
      eq(invoices.status, 'ISSUED'),
      gt(invoices.openAmount, new Decimal(0)),
      lt(invoices.dueDate, today),
    ) as SQL;
  }

  private async summaries(
    rows: { invoice: InvoiceRow; lineCount: string }[],
    today: string,
  ): Promise<InvoiceSummary[]> {
    if (rows.length === 0) return [];
    const customers = new Map(
      (await this.customers.getMany(rows.map((row) => row.invoice.customerId))).map((customer) => [
        customer.id,
        customer,
      ]),
    );
    const branches = new Map((await this.org.listBranches()).map((branch) => [branch.id, branch]));
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.invoice.createdBy === null ? [] : [row.invoice.createdBy])),
    );
    return rows.map(({ invoice, lineCount }) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      settlement: settlementOf(invoice.total, invoice.openAmount),
      customerId: invoice.customerId,
      customerCode: customers.get(invoice.customerId)?.code ?? '',
      customerName: customers.get(invoice.customerId)?.name ?? '',
      orderId: invoice.orderId,
      orderNumber: invoice.orderNumber,
      branchId: invoice.branchId,
      branchName: invoice.branchId === null ? null : (branches.get(invoice.branchId)?.name ?? null),
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      overdue: invoice.status === 'ISSUED' && invoice.openAmount.gt(0) && invoice.dueDate < today,
      paymentMethod: invoice.paymentMethod,
      subtotal: invoice.subtotal,
      discountTotal: invoice.discountTotal,
      total: invoice.total,
      vatTotal: invoice.vatTotal,
      cityTaxTotal: invoice.cityTaxTotal,
      openAmount: invoice.openAmount,
      lineCount: Number.parseInt(lineCount, 10),
      createdAt: invoice.createdAt,
      createdByName: invoice.createdBy === null ? null : (names.get(invoice.createdBy) ?? null),
    }));
  }
}
