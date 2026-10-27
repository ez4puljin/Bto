import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  cashVariance,
  type EdgeCashier,
  type EdgeShiftSummary,
  expectedCash,
  posShiftNumber,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import { edgeSales, edgeShifts } from '../db/schema';
import { PrintableCache } from '../ebarimt/printable.cache';
import { OutboxService } from './outbox.service';
import { paymentTotalsOf } from './payment-totals';
import { nextSequence } from './sequences';
import { SnapshotStore } from './snapshot.store';

type ShiftRow = typeof edgeShifts.$inferSelect;

/**
 * A till's shift on the edge (ADR-0064): opened with the float in the drawer, closed with the cash
 * counted and the float kept for tomorrow. Each step is one edge transaction with its document in
 * the outbox; the centre books the shift's entry when SHIFT_CLOSED arrives.
 */
@Injectable()
export class EdgeShiftsService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly outbox: OutboxService,
    private readonly cache: PrintableCache,
    private readonly store: SnapshotStore,
  ) {}

  async current(tillCode: string, executor: EdgeDb | EdgeTx = this.db): Promise<ShiftRow | null> {
    const [row] = await executor
      .select()
      .from(edgeShifts)
      .where(and(eq(edgeShifts.tillCode, tillCode), eq(edgeShifts.status, 'OPEN')));
    return row ?? null;
  }

  async open(
    tillCode: string,
    cashier: EdgeCashier,
    openingFloat: Decimal,
  ): Promise<EdgeShiftSummary> {
    if (openingFloat.isNegative()) {
      throw new AppError('VALIDATION_FAILED', 'the opening float cannot be negative');
    }
    const row = await inEdgeTransaction(this.db, async (tx) => {
      if (await this.current(tillCode, tx)) {
        throw new AppError(
          'POS_SHIFT_STATE_INVALID',
          `till ${tillCode} already has an open shift`,
          {
            tillCode,
          },
        );
      }
      const openedAt = new Date();
      const day = businessDate(openedAt);
      const number = posShiftNumber(
        tillCode,
        day,
        await nextSequence(tx, `SHIFT:${tillCode}`, day),
      );
      const [created] = await tx
        .insert(edgeShifts)
        .values({
          clientId: randomUUID(),
          tillCode,
          cashierUserId: cashier.userId,
          cashierName: cashier.fullName,
          number,
          openedAt,
          openingFloat: openingFloat.toDecimalPlaces(2),
        })
        .returning();
      if (!created) throw new Error('shift not created');
      await this.outbox.enqueue(tx, {
        kind: 'SHIFT_OPENED',
        clientId: created.clientId,
        shiftOpened: {
          clientId: created.clientId,
          tillCode,
          cashierUserId: cashier.userId,
          number,
          openedAt: openedAt.toISOString(),
          openingFloat: created.openingFloat.toFixed(2),
        },
      });
      return created;
    });
    return this.summary(row);
  }

  async close(
    tillCode: string,
    input: { countedCash: Decimal; floatKept: Decimal; note: string | null },
  ): Promise<EdgeShiftSummary> {
    if (input.countedCash.isNegative() || input.floatKept.isNegative()) {
      throw new AppError('VALIDATION_FAILED', 'counted cash and the float kept cannot be negative');
    }
    if (input.floatKept.gt(input.countedCash)) {
      throw new AppError('VALIDATION_FAILED', 'the float kept cannot exceed the cash counted');
    }
    const row = await inEdgeTransaction(this.db, async (tx) => {
      const [open] = await tx
        .select()
        .from(edgeShifts)
        .where(and(eq(edgeShifts.tillCode, tillCode), eq(edgeShifts.status, 'OPEN')))
        .for('update');
      if (!open) {
        throw new AppError('POS_SHIFT_STATE_INVALID', `till ${tillCode} has no open shift`, {
          tillCode,
        });
      }
      const closedAt = new Date();
      const [closed] = await tx
        .update(edgeShifts)
        .set({
          status: 'CLOSED',
          closedAt,
          countedCash: input.countedCash.toDecimalPlaces(2),
          floatKept: input.floatKept.toDecimalPlaces(2),
          note: input.note,
        })
        .where(eq(edgeShifts.clientId, open.clientId))
        .returning();
      if (!closed) throw new Error('shift not closed');
      await this.outbox.enqueue(tx, {
        kind: 'SHIFT_CLOSED',
        clientId: open.clientId,
        shiftClosed: {
          clientId: open.clientId,
          closedAt: closedAt.toISOString(),
          countedCash: input.countedCash.toFixed(2),
          floatKept: input.floatKept.toFixed(2),
          note: input.note,
        },
      });
      return closed;
    });
    // The lottery and QR of this till's receipts are dropped with its shift (ADR-0065).
    this.cache.forgetTill(tillCode);
    return this.summary(row);
  }

  /** The shift's figures from its sales and returns on this edge (the Z of the till). */
  async summary(shift: ShiftRow): Promise<EdgeShiftSummary> {
    const sale = sql`${edgeSales.kind} = 'SALE'`;
    const refund = sql`${edgeSales.kind} = 'RETURN'`;
    const [totals] = await this.db
      .select({
        count: sql<number>`count(*) FILTER (WHERE ${sale})::int`,
        cash: sql<string>`coalesce(sum(${edgeSales.cashAmount}) FILTER (WHERE ${sale}), 0)::text`,
        card: sql<string>`coalesce(sum(${edgeSales.cardAmount}) FILTER (WHERE ${sale}), 0)::text`,
        total: sql<string>`coalesce(sum(${edgeSales.total}) FILTER (WHERE ${sale}), 0)::text`,
        vat: sql<string>`coalesce(sum(${edgeSales.vatTotal}) FILTER (WHERE ${sale}), 0)::text`,
        returns: sql<number>`count(*) FILTER (WHERE ${refund})::int`,
        refunds: sql<string>`coalesce(sum(${edgeSales.cashAmount}) FILTER (WHERE ${refund}), 0)::text`,
        credit: sql<string>`coalesce(sum(${edgeSales.creditAmount}) FILTER (WHERE ${sale}), 0)::text`,
        transfer: sql<string>`coalesce(sum(${edgeSales.transferAmount}) FILTER (WHERE ${sale}), 0)::text`,
        creditRefunds: sql<string>`coalesce(sum(${edgeSales.creditAmount}) FILTER (WHERE ${refund}), 0)::text`,
      })
      .from(edgeSales)
      .where(eq(edgeSales.shiftClientId, shift.clientId));
    const cashSales = new Decimal(totals?.cash ?? '0');
    const cashRefunds = new Decimal(totals?.refunds ?? '0');
    const expected = expectedCash({
      openingFloat: shift.openingFloat,
      cashSales,
      cashRefunds,
    });
    return {
      clientId: shift.clientId,
      number: shift.number,
      status: shift.status,
      openedAt: shift.openedAt.toISOString(),
      cashierName: shift.cashierName,
      openingFloat: shift.openingFloat.toFixed(2),
      salesCount: totals?.count ?? 0,
      cashSales: cashSales.toFixed(2),
      cardSales: new Decimal(totals?.card ?? '0').toFixed(2),
      total: new Decimal(totals?.total ?? '0').toFixed(2),
      vatTotal: new Decimal(totals?.vat ?? '0').toFixed(2),
      returnsCount: totals?.returns ?? 0,
      cashRefunds: cashRefunds.toFixed(2),
      creditSales: new Decimal(totals?.credit ?? '0').toFixed(2),
      creditRefunds: new Decimal(totals?.creditRefunds ?? '0').toFixed(2),
      transferSales: new Decimal(totals?.transfer ?? '0').toFixed(2),
      payments: paymentTotalsOf(
        await this.db
          .select({ kind: edgeSales.kind, doc: edgeSales.doc })
          .from(edgeSales)
          .where(eq(edgeSales.shiftClientId, shift.clientId))
          .orderBy(asc(edgeSales.soldAt)),
        this.store.peek()?.snapshot.paymentTypes ?? [],
      ),
      expectedCash: expected.toFixed(2),
      closedAt: shift.closedAt?.toISOString() ?? null,
      countedCash: shift.countedCash?.toFixed(2) ?? null,
      floatKept: shift.floatKept?.toFixed(2) ?? null,
      variance: shift.countedCash ? cashVariance(shift.countedCash, expected).toFixed(2) : null,
    };
  }
}
