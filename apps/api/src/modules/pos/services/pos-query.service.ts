import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type {
  EbarimtStatus,
  PosEventKind,
  ReceiptType,
  SaleKind,
  ShiftStatus,
  TenderKind,
} from '@tugeel/shared/pos';
import type { PriceBasis } from '@tugeel/shared/pricing';
import { and, asc, desc, eq, inArray, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn, onBusinessDays } from '../../../common/db/days';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import type { VatType } from '../../catalog';
import { AuditService, type AuthContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import {
  posEdgeNodes,
  posSaleLines,
  posSaleVouchers,
  posSales,
  posShifts,
  posShortfalls,
  posSyncRejections,
  posTenders,
  posTills,
} from '../schema';
import { PosShiftsService, type ShiftTotals } from './pos-shifts.service';

export interface ShiftSummary extends ShiftTotals {
  id: number;
  number: string;
  status: ShiftStatus;
  edgeNodeId: number;
  edgeNodeCode: string;
  tillId: number;
  tillCode: string;
  tillName: string;
  cashierUserId: number;
  cashierName: string | null;
  openedAt: Date;
  openingFloat: Decimal;
  closedAt: Date | null;
  countedCash: Decimal | null;
  floatKept: Decimal | null;
  expectedCash: Decimal | null;
  variance: Decimal | null;
  note: string | null;
  journalEntryId: number | null;
  journalNumber: string | null;
  handoverPaymentId: number | null;
  handoverNumber: string | null;
  handedOverAt: Date | null;
  handedOverByName: string | null;
}

export interface ShiftQuery {
  edgeNodeId?: number;
  tillId?: number;
  cashierUserId?: number;
  status?: ShiftStatus;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface SaleSummary {
  id: number;
  number: string;
  kind: SaleKind;
  edgeNodeId: number;
  tillId: number;
  tillCode: string;
  shiftId: number;
  shiftNumber: string;
  cashierUserId: number;
  cashierName: string | null;
  approvedByName: string | null;
  soldAt: Date;
  soldDay: string;
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
  cashAmount: Decimal;
  cardAmount: Decimal;
  /** ADR-0109: the part on credit, its customer, the invoice or credit note, the excess. */
  creditAmount: Decimal;
  creditCustomerId: number | null;
  creditCustomerCode: string | null;
  creditCustomerName: string | null;
  creditDocNumber: string | null;
  invoiceId: number | null;
  creditNoteId: number | null;
  creditExcess: Decimal | null;
  creditReviewedAt: Date | null;
  receiptType: ReceiptType;
  customerTin: string | null;
  customerName: string | null;
  ebarimtStatus: EbarimtStatus;
  ddtd: string | null;
  refundsSaleId: number | null;
  refundsSaleNumber: string | null;
  lineCount: number;
  shortfallCount: number;
  createdAt: Date;
}

export interface SaleLineView {
  id: number;
  lineNo: number;
  productId: number;
  productSku: string;
  productName: string;
  productUnitId: number;
  uomName: string;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  basis: PriceBasis;
  listPrice: Decimal;
  unitPrice: Decimal;
  discountAmount: Decimal;
  subtotal: Decimal;
  total: Decimal;
  vatType: VatType;
  vatRatePct: Decimal;
  vatAmount: Decimal;
  refundsLineId: number | null;
  damaged: boolean;
  returnedBase: Decimal;
}

export interface TenderView {
  id: number;
  tenderNo: number;
  kind: TenderKind;
  amount: Decimal;
  tendered: Decimal | null;
  terminalId: string | null;
  rrn: string | null;
  maskedPan: string | null;
}

export interface ShortfallView {
  id: number;
  saleId: number;
  saleNumber: string;
  saleLineId: number;
  productId: number;
  productSku: string;
  productName: string;
  warehouseId: number;
  qtyBase: Decimal;
  adjustmentId: number;
  adjustmentNumber: string;
  resolvedAt: Date | null;
  resolvedByName: string | null;
  note: string | null;
  createdAt: Date;
}

export interface SaleDetail extends SaleSummary {
  consumerNo: string | null;
  posapiDate: string | null;
  billIdSuffix: string | null;
  inactiveId: string | null;
  snapshotVersion: string | null;
  note: string | null;
  creditReviewedByName: string | null;
  creditReviewNote: string | null;
  lines: SaleLineView[];
  tenders: TenderView[];
  shortfalls: ShortfallView[];
  /** Returns that took goods back from this sale. */
  returns: { id: number; number: string; soldAt: Date; total: Decimal }[];
}

export interface SaleQuery {
  q?: string;
  edgeNodeId?: number;
  tillId?: number;
  shiftId?: number;
  cashierUserId?: number;
  kind?: SaleKind;
  ebarimtStatus?: EbarimtStatus;
  /** ADR-0109: a customer's credit sales and returns; those past a limit not checked yet. */
  customerId?: number;
  creditToCheck?: boolean;
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

export interface ShortfallQuery {
  productId?: number;
  resolved?: boolean;
  cursor?: string;
  limit?: number;
}

export interface RejectionView {
  id: number;
  edgeNodeId: number;
  edgeNodeCode: string;
  clientId: string;
  kind: PosEventKind;
  code: string;
  params: Record<string, unknown> | null;
  payload: Record<string, unknown>;
  createdAt: Date;
  replayedAt: Date | null;
  replayedByName: string | null;
}

export interface PosAttention {
  openShifts: number;
  shiftsToHandOver: number;
  openShortfalls: number;
  rejections: number;
  /** Sales whose e-Barimt failed or went unanswered on the edge (ADR-0065). */
  receiptsToCheck: number;
  /** Credit sales accepted past their customer's limit or hold, not checked yet (ADR-0109). */
  creditToCheck: number;
  /** Codes a till took that were used twice, stopped or out of date, not checked (ADR-0110). */
  vouchersToCheck: number;
}

type ShiftRow = typeof posShifts.$inferSelect;
type SaleRow = typeof posSales.$inferSelect;

/** Reads for the «Супермаркет» pages (ADR-0063 #8): shifts, sales, shortfalls, rejections. */
@Injectable()
export class PosQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly names: UserNamesService,
    private readonly shifts: PosShiftsService,
    private readonly audit: AuditService,
    private readonly customers: CustomersService,
  ) {}

  async listShifts(
    query: ShiftQuery,
  ): Promise<{ data: ShiftSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.edgeNodeId) filters.push(eq(posShifts.edgeNodeId, query.edgeNodeId));
    if (query.tillId) filters.push(eq(posShifts.tillId, query.tillId));
    if (query.cashierUserId) filters.push(eq(posShifts.cashierUserId, query.cashierUserId));
    if (query.status) filters.push(eq(posShifts.status, query.status));
    if (query.from || query.to) {
      filters.push(onBusinessDays(posShifts.openedAt, { from: query.from, to: query.to }));
    }
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(posShifts.id, after.id)] : [];
    const rows = await this.db
      .select()
      .from(posShifts)
      .where(and(...filters, ...paged))
      .orderBy(desc(posShifts.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.shiftSummaries(page.data), nextCursor: page.nextCursor };
  }

  async getShift(id: number): Promise<ShiftSummary> {
    const [row] = await this.db.select().from(posShifts).where(eq(posShifts.id, id));
    if (!row) throw notFound('pos_shift', id);
    const [summary] = await this.shiftSummaries([row]);
    if (!summary) throw notFound('pos_shift', id);
    return summary;
  }

  async listSales(query: SaleQuery): Promise<{
    data: SaleSummary[];
    nextCursor: string | null;
    total: number | null;
  }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.edgeNodeId) filters.push(eq(posSales.edgeNodeId, query.edgeNodeId));
    if (query.tillId) filters.push(eq(posSales.tillId, query.tillId));
    if (query.shiftId) filters.push(eq(posSales.shiftId, query.shiftId));
    if (query.cashierUserId) filters.push(eq(posSales.cashierUserId, query.cashierUserId));
    if (query.kind) filters.push(eq(posSales.kind, query.kind));
    if (query.ebarimtStatus) filters.push(eq(posSales.ebarimtStatus, query.ebarimtStatus));
    if (query.customerId) filters.push(eq(posSales.customerId, query.customerId));
    if (query.creditToCheck) {
      filters.push(
        sql`${posSales.creditExcess} IS NOT NULL AND ${posSales.creditReviewedAt} IS NULL`,
      );
    }
    if (query.from) filters.push(sql`${posSales.soldDay} >= ${query.from}`);
    if (query.to) filters.push(sql`${posSales.soldDay} <= ${query.to}`);
    const q = query.q?.trim();
    if (q) {
      const pattern = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
      filters.push(
        or(
          sql`${posSales.number} ILIKE ${pattern}`,
          sql`${posSales.ddtd} ILIKE ${pattern}`,
          sql`${posSales.customerTin} ILIKE ${pattern}`,
          sql`${posSales.customerName} ILIKE ${pattern}`,
        ) as SQL,
      );
    }
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(posSales.id, after.id)] : [];
    const rows = await this.db
      .select()
      .from(posSales)
      .where(and(...filters, ...paged))
      .orderBy(desc(posSales.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    let total: number | null = null;
    if (!query.cursor) {
      const [counted] = await this.db
        .select({ count: sql<string>`count(*)` })
        .from(posSales)
        .where(and(...filters));
      total = Number.parseInt(counted?.count ?? '0', 10);
    }
    return { data: await this.saleSummaries(page.data), nextCursor: page.nextCursor, total };
  }

  async getSale(id: number): Promise<SaleDetail> {
    const [row] = await this.db.select().from(posSales).where(eq(posSales.id, id));
    if (!row) throw notFound('pos_sale', id);
    const [summary] = await this.saleSummaries([row]);
    if (!summary) throw notFound('pos_sale', id);
    const lines = await this.db
      .select()
      .from(posSaleLines)
      .where(eq(posSaleLines.saleId, id))
      .orderBy(asc(posSaleLines.lineNo));
    const tenders = await this.db
      .select()
      .from(posTenders)
      .where(eq(posTenders.saleId, id))
      .orderBy(asc(posTenders.tenderNo));
    const shortfalls = await this.shortfallViews(eq(posShortfalls.saleId, id));
    const returns = await this.db
      .select({
        id: posSales.id,
        number: posSales.number,
        soldAt: posSales.soldAt,
        total: posSales.total,
      })
      .from(posSales)
      .where(eq(posSales.refundsSaleId, id))
      .orderBy(asc(posSales.id));
    return {
      ...summary,
      consumerNo: row.consumerNo,
      posapiDate: row.posapiDate,
      billIdSuffix: row.billIdSuffix,
      inactiveId: row.inactiveId,
      snapshotVersion: row.snapshotVersion,
      note: row.note,
      creditReviewedByName:
        row.creditReviewedBy === null
          ? null
          : ((await this.names.namesOf([row.creditReviewedBy])).get(row.creditReviewedBy) ?? null),
      creditReviewNote: row.creditReviewNote,
      lines: lines.map((line) => ({
        id: line.id,
        lineNo: line.lineNo,
        productId: line.productId,
        productSku: line.productSku,
        productName: line.productName,
        productUnitId: line.productUnitId,
        uomName: line.uomName,
        qty: line.qty,
        factorSnapshot: line.factorSnapshot,
        qtyBase: line.qtyBase,
        basis: line.basis,
        listPrice: line.listPrice,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        subtotal: line.subtotal,
        total: line.total,
        vatType: line.vatType,
        vatRatePct: line.vatRatePct,
        vatAmount: line.vatAmount,
        refundsLineId: line.refundsLineId,
        damaged: line.damaged,
        returnedBase: line.returnedBase,
      })),
      tenders: tenders.map((tender) => ({
        id: tender.id,
        tenderNo: tender.tenderNo,
        kind: tender.kind,
        amount: tender.amount,
        tendered: tender.tendered,
        terminalId: tender.terminalId,
        rrn: tender.rrn,
        maskedPan: tender.maskedPan,
      })),
      shortfalls,
      returns,
    };
  }

  /**
   * The office checked a credit sale accepted past its customer's limit or hold (ADR-0109 #7):
   * «Шалгасан» with a note; once.
   */
  async reviewCredit(ctx: AuthContext, id: number, note: string | null): Promise<SaleDetail> {
    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > 300) throw invalid('note', 'length', 'at most 300 characters');
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({
          id: posSales.id,
          creditExcess: posSales.creditExcess,
          reviewedAt: posSales.creditReviewedAt,
        })
        .from(posSales)
        .where(eq(posSales.id, id))
        .for('update');
      if (!row) throw notFound('pos_sale', id);
      if (row.creditExcess === null) throw invalid('id', 'credit', 'nothing to check');
      if (row.reviewedAt) return;
      await tx
        .update(posSales)
        .set({
          creditReviewedAt: sql`now()`,
          creditReviewedBy: ctx.userId,
          creditReviewNote: trimmed,
          updatedAt: sql`now()`,
        })
        .where(eq(posSales.id, id));
      await this.audit.record(tx, ctx, {
        action: 'CREDIT_REVIEW',
        entity: 'pos_sales',
        entityId: id,
        after: { note: trimmed, creditExcess: row.creditExcess.toFixed(2) },
      });
    });
    return this.getSale(id);
  }

  async listShortfalls(
    query: ShortfallQuery,
  ): Promise<{ data: ShortfallView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.productId) filters.push(eq(posShortfalls.productId, query.productId));
    if (query.resolved === true) filters.push(sql`${posShortfalls.resolvedAt} IS NOT NULL`);
    if (query.resolved === false) filters.push(isNull(posShortfalls.resolvedAt));
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(posShortfalls.id, after.id)] : [];
    const rows = await this.shortfallViews(and(...filters, ...paged), limit + 1);
    return toPage(rows, limit, (row) => ({ id: row.id }));
  }

  /** The storekeeper checked a shortfall (counted, moved or explained it). */
  async resolveShortfall(
    ctx: AuthContext,
    id: number,
    note: string | null,
  ): Promise<ShortfallView> {
    const trimmed = note?.trim() || null;
    if (trimmed && trimmed.length > 300) throw invalid('note', 'length', 'at most 300 characters');
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select({ id: posShortfalls.id, resolvedAt: posShortfalls.resolvedAt })
        .from(posShortfalls)
        .where(eq(posShortfalls.id, id))
        .for('update');
      if (!row) throw notFound('pos_shortfall', id);
      if (row.resolvedAt) return;
      await tx
        .update(posShortfalls)
        .set({ resolvedAt: sql`now()`, resolvedBy: ctx.userId, note: trimmed })
        .where(eq(posShortfalls.id, id));
      await this.audit.record(tx, ctx, {
        action: 'RESOLVE',
        entity: 'pos_shortfalls',
        entityId: id,
        after: { note: trimmed },
      });
    });
    const [view] = await this.shortfallViews(eq(posShortfalls.id, id));
    if (!view) throw notFound('pos_shortfall', id);
    return view;
  }

  async listRejections(query: {
    edgeNodeId?: number;
    replayed?: boolean;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: RejectionView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.edgeNodeId) filters.push(eq(posSyncRejections.edgeNodeId, query.edgeNodeId));
    if (query.replayed === true) filters.push(sql`${posSyncRejections.replayedAt} IS NOT NULL`);
    if (query.replayed === false) filters.push(isNull(posSyncRejections.replayedAt));
    const after = decodeCursor(query.cursor);
    const paged = typeof after?.id === 'number' ? [lt(posSyncRejections.id, after.id)] : [];
    const rows = await this.db
      .select({ rejection: posSyncRejections, edgeNodeCode: posEdgeNodes.code })
      .from(posSyncRejections)
      .innerJoin(posEdgeNodes, eq(posEdgeNodes.id, posSyncRejections.edgeNodeId))
      .where(and(...filters, ...paged))
      .orderBy(desc(posSyncRejections.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.rejection.id }));
    const names = await this.names.namesOf(
      page.data.flatMap((row) =>
        row.rejection.replayedBy === null ? [] : [row.rejection.replayedBy],
      ),
    );
    return {
      data: page.data.map(({ rejection, edgeNodeCode }) => ({
        id: rejection.id,
        edgeNodeId: rejection.edgeNodeId,
        edgeNodeCode,
        clientId: rejection.clientId,
        kind: rejection.kind,
        code: rejection.code,
        params: (rejection.params as Record<string, unknown> | null) ?? null,
        payload: rejection.payload as Record<string, unknown>,
        createdAt: rejection.createdAt,
        replayedAt: rejection.replayedAt,
        replayedByName:
          rejection.replayedBy === null ? null : (names.get(rejection.replayedBy) ?? null),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** The home tile and the pages' pills. */
  async attention(): Promise<PosAttention> {
    const [shifts] = await this.db
      .select({
        open: sql<string>`count(*) FILTER (WHERE ${posShifts.status} = 'OPEN')`,
        closed: sql<string>`count(*) FILTER (WHERE ${posShifts.status} = 'CLOSED')`,
      })
      .from(posShifts);
    const [shortfalls] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posShortfalls)
      .where(isNull(posShortfalls.resolvedAt));
    const [rejections] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posSyncRejections)
      .where(isNull(posSyncRejections.replayedAt));
    const [receipts] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posSales)
      .where(inArray(posSales.ebarimtStatus, ['ERROR', 'INDETERMINATE']));
    const [credit] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posSales)
      .where(sql`${posSales.creditExcess} IS NOT NULL AND ${posSales.creditReviewedAt} IS NULL`);
    const [vouchers] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(posSaleVouchers)
      .where(
        sql`${posSaleVouchers.issue} IS NOT NULL AND ${posSaleVouchers.reviewedAt} IS NULL`,
      );
    const int = (value: string | undefined) => Number.parseInt(value ?? '0', 10);
    return {
      creditToCheck: int(credit?.count),
      vouchersToCheck: int(vouchers?.count),
      openShifts: int(shifts?.open),
      shiftsToHandOver: int(shifts?.closed),
      openShortfalls: int(shortfalls?.count),
      rejections: int(rejections?.count),
      receiptsToCheck: int(receipts?.count),
    };
  }

  private async shiftSummaries(rows: ShiftRow[]): Promise<ShiftSummary[]> {
    if (rows.length === 0) return [];
    const tills = new Map(
      (
        await this.db
          .select({
            id: posTills.id,
            code: posTills.code,
            name: posTills.name,
            edgeNodeCode: posEdgeNodes.code,
          })
          .from(posTills)
          .innerJoin(posEdgeNodes, eq(posEdgeNodes.id, posTills.edgeNodeId))
          .where(idIn(posTills.id, [...new Set(rows.map((row) => row.tillId))]))
      ).map((till) => [till.id, till]),
    );
    const names = await this.names.namesOf(
      rows.flatMap((row) => [
        row.cashierUserId,
        ...(row.handedOverBy === null ? [] : [row.handedOverBy]),
      ]),
    );
    const result: ShiftSummary[] = [];
    for (const row of rows) {
      const till = tills.get(row.tillId);
      const totals: ShiftTotals =
        row.status === 'OPEN'
          ? await this.shifts.totals(row.id)
          : {
              salesCount: row.salesCount,
              returnsCount: row.returnsCount,
              cashSales: row.cashSales,
              cashRefunds: row.cashRefunds,
              cardSales: row.cardSales,
              cardRefunds: row.cardRefunds,
              salesTotal: row.salesTotal,
              returnsTotal: row.returnsTotal,
              salesVat: row.salesVat,
              returnsVat: row.returnsVat,
              creditSales: row.creditSales,
              creditRefunds: row.creditRefunds,
              voucherSales: row.voucherSales,
            };
      result.push({
        ...totals,
        id: row.id,
        number: row.number,
        status: row.status,
        edgeNodeId: row.edgeNodeId,
        edgeNodeCode: till?.edgeNodeCode ?? '',
        tillId: row.tillId,
        tillCode: till?.code ?? '',
        tillName: till?.name ?? '',
        cashierUserId: row.cashierUserId,
        cashierName: names.get(row.cashierUserId) ?? null,
        openedAt: row.openedAt,
        openingFloat: row.openingFloat,
        closedAt: row.closedAt,
        countedCash: row.countedCash,
        floatKept: row.floatKept,
        expectedCash: row.expectedCash,
        variance: row.variance,
        note: row.note,
        journalEntryId: row.journalEntryId,
        journalNumber: row.journalNumber,
        handoverPaymentId: row.handoverPaymentId,
        handoverNumber: row.handoverNumber,
        handedOverAt: row.handedOverAt,
        handedOverByName: row.handedOverBy === null ? null : (names.get(row.handedOverBy) ?? null),
      });
    }
    return result;
  }

  private async saleSummaries(rows: SaleRow[]): Promise<SaleSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const tills = new Map(
      (
        await this.db
          .select({ id: posTills.id, code: posTills.code })
          .from(posTills)
          .where(idIn(posTills.id, [...new Set(rows.map((row) => row.tillId))]))
      ).map((till) => [till.id, till.code]),
    );
    const shifts = new Map(
      (
        await this.db
          .select({ id: posShifts.id, number: posShifts.number })
          .from(posShifts)
          .where(idIn(posShifts.id, [...new Set(rows.map((row) => row.shiftId))]))
      ).map((shift) => [shift.id, shift.number]),
    );
    const refundedIds = rows.flatMap((row) =>
      row.refundsSaleId === null ? [] : [row.refundsSaleId],
    );
    const refunded = new Map(
      refundedIds.length === 0
        ? []
        : (
            await this.db
              .select({ id: posSales.id, number: posSales.number })
              .from(posSales)
              .where(inArray(posSales.id, refundedIds))
          ).map((sale) => [sale.id, sale.number]),
    );
    const names = await this.names.namesOf(
      rows.flatMap((row) => [
        row.cashierUserId,
        ...(row.approvedBy === null ? [] : [row.approvedBy]),
      ]),
    );
    const tenderSums = await this.db
      .select({
        saleId: posTenders.saleId,
        cash: sql<string>`coalesce(sum(CASE WHEN ${posTenders.kind} = 'CASH' THEN ${posTenders.amount} ELSE 0 END), 0)`,
        card: sql<string>`coalesce(sum(CASE WHEN ${posTenders.kind} = 'CARD' THEN ${posTenders.amount} ELSE 0 END), 0)`,
      })
      .from(posTenders)
      .where(idIn(posTenders.saleId, ids))
      .groupBy(posTenders.saleId);
    const tenders = new Map(tenderSums.map((row) => [row.saleId, row]));
    const charged = new Map(
      (
        await this.customers.getMany([
          ...new Set(rows.flatMap((row) => (row.customerId === null ? [] : [row.customerId]))),
        ])
      ).map((customer) => [customer.id, customer]),
    );
    const lineCounts = new Map(
      (
        await this.db
          .select({ saleId: posSaleLines.saleId, count: sql<string>`count(*)` })
          .from(posSaleLines)
          .where(idIn(posSaleLines.saleId, ids))
          .groupBy(posSaleLines.saleId)
      ).map((row) => [row.saleId, Number.parseInt(row.count, 10)]),
    );
    const shortfallCounts = new Map(
      (
        await this.db
          .select({ saleId: posShortfalls.saleId, count: sql<string>`count(*)` })
          .from(posShortfalls)
          .where(idIn(posShortfalls.saleId, ids))
          .groupBy(posShortfalls.saleId)
      ).map((row) => [row.saleId, Number.parseInt(row.count, 10)]),
    );
    return rows.map((row) => {
      const tender = tenders.get(row.id);
      return {
        id: row.id,
        number: row.number,
        kind: row.kind,
        edgeNodeId: row.edgeNodeId,
        tillId: row.tillId,
        tillCode: tills.get(row.tillId) ?? '',
        shiftId: row.shiftId,
        shiftNumber: shifts.get(row.shiftId) ?? '',
        cashierUserId: row.cashierUserId,
        cashierName: names.get(row.cashierUserId) ?? null,
        approvedByName: row.approvedBy === null ? null : (names.get(row.approvedBy) ?? null),
        soldAt: row.soldAt,
        soldDay: row.soldDay,
        subtotal: row.subtotal,
        discountTotal: row.discountTotal,
        total: row.total,
        vatTotal: row.vatTotal,
        cashAmount: new Decimal(tender?.cash ?? '0'),
        cardAmount: new Decimal(tender?.card ?? '0'),
        creditAmount: row.creditTotal,
        creditCustomerId: row.customerId,
        creditCustomerCode:
          row.customerId === null ? null : (charged.get(row.customerId)?.code ?? null),
        creditCustomerName:
          row.customerId === null ? null : (charged.get(row.customerId)?.name ?? null),
        creditDocNumber: row.creditDocNumber,
        invoiceId: row.invoiceId,
        creditNoteId: row.creditNoteId,
        creditExcess: row.creditExcess,
        creditReviewedAt: row.creditReviewedAt,
        receiptType: row.receiptType,
        customerTin: row.customerTin,
        customerName: row.customerName,
        ebarimtStatus: row.ebarimtStatus,
        ddtd: row.ddtd,
        refundsSaleId: row.refundsSaleId,
        refundsSaleNumber:
          row.refundsSaleId === null ? null : (refunded.get(row.refundsSaleId) ?? null),
        lineCount: lineCounts.get(row.id) ?? 0,
        shortfallCount: shortfallCounts.get(row.id) ?? 0,
        createdAt: row.createdAt,
      };
    });
  }

  private async shortfallViews(where: SQL | undefined, limit?: number): Promise<ShortfallView[]> {
    const base = this.db
      .select({
        shortfall: posShortfalls,
        saleNumber: posSales.number,
        productSku: posSaleLines.productSku,
        productName: posSaleLines.productName,
      })
      .from(posShortfalls)
      .innerJoin(posSales, eq(posSales.id, posShortfalls.saleId))
      .innerJoin(posSaleLines, eq(posSaleLines.id, posShortfalls.saleLineId))
      .where(where)
      .orderBy(desc(posShortfalls.id));
    const rows = await (limit ? base.limit(limit) : base);
    const names = await this.names.namesOf(
      rows.flatMap((row) => (row.shortfall.resolvedBy === null ? [] : [row.shortfall.resolvedBy])),
    );
    return rows.map(({ shortfall, saleNumber, productSku, productName }) => ({
      id: shortfall.id,
      saleId: shortfall.saleId,
      saleNumber,
      saleLineId: shortfall.saleLineId,
      productId: shortfall.productId,
      productSku,
      productName,
      warehouseId: shortfall.warehouseId,
      qtyBase: shortfall.qtyBase,
      adjustmentId: shortfall.adjustmentId,
      adjustmentNumber: shortfall.adjustmentNumber,
      resolvedAt: shortfall.resolvedAt,
      resolvedByName:
        shortfall.resolvedBy === null ? null : (names.get(shortfall.resolvedBy) ?? null),
      note: shortfall.note,
      createdAt: shortfall.createdAt,
    }));
  }
}
