import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  DENOMINATIONS,
  denominationTotal,
  type EdgeCashier,
  type EdgeDayCountRequest,
  type EdgeDaySummary,
  type EdgePaymentTotal,
  type EdgeSaleListItem,
  expectedCash,
  POS_LIMITS,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import { invalid } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, inEdgeTransaction } from '../db/edge-db';
import { edgeDayCounts, edgeSales, edgeShifts } from '../db/schema';
import { OutboxService } from './outbox.service';
import { paymentTotalsOf } from './payment-totals';
import { SnapshotStore } from './snapshot.store';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HISTORY_LIMIT = 500;

/** The Ulaanbaatar business day of a timestamp column, as text. */
const ubDay = (column: typeof edgeSales.soldAt | typeof edgeShifts.openedAt) =>
  sql`to_char(${column} AT TIME ZONE 'Asia/Ulaanbaatar', 'YYYY-MM-DD')`;

/**
 * A till's own records (ADR-0111): its sales and returns by day, and its day summary — the money
 * by payment type, the expected cash and the banknotes the cashier counted, replayed to the centre
 * as a DAY_COUNT document and kept there; a count posts nothing.
 */
@Injectable()
export class TillRecordsService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly store: SnapshotStore,
    private readonly outbox: OutboxService,
  ) {}

  async sales(tillCode: string, day: string, q?: string): Promise<EdgeSaleListItem[]> {
    if (!DAY.test(day)) throw invalid('day', 'date', 'YYYY-MM-DD');
    const typed = q?.trim();
    const rows = await this.db
      .select()
      .from(edgeSales)
      .where(
        and(
          eq(edgeSales.tillCode, tillCode),
          sql`${ubDay(edgeSales.soldAt)} = ${day}`,
          ...(typed ? [ilike(edgeSales.number, `%${typed.replace(/[%_\\]/g, '\\$&')}%`)] : []),
        ),
      )
      .orderBy(desc(edgeSales.soldAt))
      .limit(HISTORY_LIMIT);
    return rows.map((row) => ({
      clientId: row.clientId,
      kind: row.kind,
      number: row.number,
      soldAt: row.soldAt.toISOString(),
      total: row.total.toFixed(2),
      payments: row.doc.tenders.map((tender) => tender.paymentTypeName ?? tender.kind),
      customerName: row.receipt.credit?.customerName ?? row.receipt.ebarimt.customerName ?? null,
      receiptType: row.doc.receiptType,
      ebarimtStatus: row.receipt.ebarimt.status ?? null,
    }));
  }

  async daySummary(tillCode: string, day: string): Promise<EdgeDaySummary> {
    if (!DAY.test(day)) throw invalid('day', 'date', 'YYYY-MM-DD');
    const rows = await this.db
      .select({ kind: edgeSales.kind, doc: edgeSales.doc })
      .from(edgeSales)
      .where(and(eq(edgeSales.tillCode, tillCode), sql`${ubDay(edgeSales.soldAt)} = ${day}`))
      .orderBy(asc(edgeSales.soldAt));
    const shifts = await this.db
      .select({ openedAt: edgeShifts.openedAt, openingFloat: edgeShifts.openingFloat })
      .from(edgeShifts)
      .where(and(eq(edgeShifts.tillCode, tillCode), sql`${ubDay(edgeShifts.openedAt)} = ${day}`))
      .orderBy(asc(edgeShifts.openedAt))
      .limit(1);
    const salesCount = rows.filter((row) => row.kind === 'SALE').length;
    const returnsCount = rows.length - salesCount;
    const payments = paymentTotalsOf(rows, this.store.peek()?.snapshot.paymentTypes ?? []);
    const cash = payments.filter((payment) => payment.kind === 'CASH');
    const sum = (pick: (payment: EdgePaymentTotal) => string) =>
      cash.reduce((total, payment) => total.plus(pick(payment)), new Decimal(0));
    const [counted] = await this.db
      .select()
      .from(edgeDayCounts)
      .where(and(eq(edgeDayCounts.tillCode, tillCode), eq(edgeDayCounts.day, day)))
      .orderBy(desc(edgeDayCounts.countedAt))
      .limit(1);
    const till = this.store.peek()?.tills.get(tillCode);
    return {
      tillCode,
      tillName: till?.name ?? tillCode,
      day,
      startedAt: shifts[0]?.openedAt.toISOString() ?? null,
      salesCount,
      returnsCount,
      payments,
      expectedCash: expectedCash({
        openingFloat: shifts[0]?.openingFloat ?? 0,
        cashSales: sum((payment) => payment.sales),
        cashRefunds: sum((payment) => payment.refunds),
      }).toFixed(2),
      counted: counted
        ? {
            clientId: counted.clientId,
            counts: counted.counts,
            total: counted.total.toFixed(2),
            cashierName: counted.cashierName,
            countedAt: counted.countedAt.toISOString(),
          }
        : null,
    };
  }

  /** The cashier's banknote count of the day; a repeated client id keeps the first. */
  async count(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeDayCountRequest,
  ): Promise<EdgeDaySummary> {
    if (!DAY.test(request.day) || request.day > businessDate()) {
      throw invalid('day', 'date', 'today or an earlier day');
    }
    const seen = new Set<number>();
    const counts = request.counts
      .map((row, index) => {
        if (!(DENOMINATIONS as readonly number[]).includes(row.note) || seen.has(row.note)) {
          throw invalid(`counts[${index}].note`, 'note', 'a banknote, once');
        }
        seen.add(row.note);
        if (!Number.isInteger(row.count) || row.count < 0 || row.count > POS_LIMITS.maxNoteCount) {
          throw invalid(`counts[${index}].count`, 'count', 'a whole number of notes');
        }
        return { note: row.note, count: row.count };
      })
      .filter((row) => row.count > 0)
      .sort((a, b) => b.note - a.note);
    const total = denominationTotal(counts);
    const countedAt = new Date();
    await inEdgeTransaction(this.db, async (tx) => {
      const inserted = await tx
        .insert(edgeDayCounts)
        .values({
          clientId: request.clientId,
          tillCode,
          day: request.day,
          cashierUserId: cashier.userId,
          cashierName: cashier.fullName,
          counts,
          total,
          countedAt,
        })
        .onConflictDoNothing({ target: edgeDayCounts.clientId })
        .returning({ clientId: edgeDayCounts.clientId });
      if (inserted.length === 0) return;
      await this.outbox.enqueue(tx, {
        kind: 'DAY_COUNT',
        clientId: request.clientId,
        dayCount: {
          clientId: request.clientId,
          tillCode,
          day: request.day,
          cashierUserId: cashier.userId,
          counts,
          total: total.toFixed(2),
          countedAt: countedAt.toISOString(),
        },
      });
    });
    return this.daySummary(tillCode, request.day);
  }
}
