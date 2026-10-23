import { Inject, Injectable } from '@nestjs/common';
import { Decimal, toMoney } from '@tugeel/shared/money';
import {
  type EdgeCashier,
  type EdgeReceipt,
  type EdgeReturnRequest,
  type EdgeReturnSale,
  lineMoney,
  lineVat,
  posSaleNumber,
  type SaleDocLineWire,
  type SaleDocWire,
  saleTotals,
  tillCodeLookKey,
  withinReturnWindow,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, or } from 'drizzle-orm';
import { AppError, invalid } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import { edgeSales } from '../db/schema';
import { KioskAuthService } from './kiosk-auth.service';
import { OutboxService } from './outbox.service';
import { nextSequence } from './sequences';
import { EdgeShiftsService } from './shifts.service';
import { SnapshotStore } from './snapshot.store';

type SaleRow = typeof edgeSales.$inferSelect;

/** What earlier returns took back of each sold line: quantity and discount. */
interface Taken {
  qty: Decimal;
  discount: Decimal;
}

/**
 * Returns at the till (ADR-0104): the receipt's number finds a sale this edge made, a supervisor's
 * PIN approves, the goods come back at the price they were sold at (each line's discount shared
 * out by quantity) and the money goes back in cash. The document is a RETURN under the till's own
 * number series; the centre checks it again and posts the goods back onto the shelf or DAMAGED.
 */
@Injectable()
export class EdgeReturnsService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly store: SnapshotStore,
    private readonly auth: KioskAuthService,
    private readonly shifts: EdgeShiftsService,
    private readonly outbox: OutboxService,
  ) {}

  /** A sale by its receipt number, «K1-…» typed on a Latin keyboard included. */
  async findSale(number: string): Promise<EdgeReturnSale> {
    const typed = number.trim().toUpperCase();
    const [sale] = await this.db
      .select()
      .from(edgeSales)
      .where(
        and(
          eq(edgeSales.kind, 'SALE'),
          or(eq(edgeSales.number, typed), eq(edgeSales.number, tillCodeLookKey(typed))),
        ),
      );
    if (!sale) throw new AppError('NOT_FOUND', `sale ${typed} not found`, { number: typed });
    const taken = await this.taken(this.db, sale.clientId);
    const windowDays = this.store.get().snapshot.settings.returnWindowDays;
    const soldDay = businessDate(sale.soldAt);
    return {
      clientId: sale.clientId,
      number: sale.number,
      soldAt: sale.soldAt.toISOString(),
      soldDay,
      tillCode: sale.tillCode,
      total: sale.total.toFixed(2),
      windowDays,
      withinWindow: withinReturnWindow(soldDay, businessDate(), windowDays),
      lines: sale.doc.lines.map((line, index) => {
        const shown = sale.receipt.lines[index];
        const left = new Decimal(line.qty).minus(taken.get(line.lineNo)?.qty ?? 0);
        return {
          lineNo: line.lineNo,
          productId: line.productId,
          productUnitId: line.productUnitId,
          name: shown?.name ?? this.nameOf(line.productUnitId),
          uomName: shown?.uomName ?? '',
          qty: new Decimal(line.qty).toString(),
          unitPrice: line.unitPrice,
          total: line.total,
          returnable: Decimal.max(left, 0).toString(),
        };
      }),
    };
  }

  /** The return of chosen lines; a repeated client id answers its receipt. */
  async refund(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeReturnRequest,
  ): Promise<EdgeReceipt> {
    const [existing] = await this.db
      .select({ receipt: edgeSales.receipt })
      .from(edgeSales)
      .where(eq(edgeSales.clientId, request.clientId));
    if (existing) return existing.receipt;
    if (request.lines.length === 0) throw invalid('lines', 'required', 'at least one line');
    const approver = await this.auth.approve(request.approval);
    const loaded = this.store.get();
    return inEdgeTransaction(this.db, async (tx) => {
      const shift = await this.shifts.current(tillCode, tx);
      if (!shift) {
        throw new AppError('POS_SHIFT_STATE_INVALID', `till ${tillCode} has no open shift`, {
          tillCode,
        });
      }
      // The sale is locked so two returns of it at once cannot both take its last items.
      const [sale] = await tx
        .select()
        .from(edgeSales)
        .where(and(eq(edgeSales.clientId, request.refundsSaleClientId), eq(edgeSales.kind, 'SALE')))
        .for('update');
      if (!sale)
        throw new AppError('NOT_FOUND', `sale ${request.refundsSaleClientId} not found`, {
          clientId: request.refundsSaleClientId,
        });
      const windowDays = loaded.snapshot.settings.returnWindowDays;
      const today = businessDate();
      if (!withinReturnWindow(businessDate(sale.soldAt), today, windowDays)) {
        throw new AppError('POS_RETURN_WINDOW', `sale ${sale.number} is past the window`, {
          number: sale.number,
          windowDays,
        });
      }
      const taken = await this.taken(tx, sale.clientId);
      const seen = new Set<number>();
      const lines: SaleDocLineWire[] = request.lines.map((input, index) => {
        if (seen.has(input.refundsLineNo)) {
          throw invalid(`lines[${index}].refundsLineNo`, 'unique', 'once per return');
        }
        seen.add(input.refundsLineNo);
        const sold = sale.doc.lines.find((line) => line.lineNo === input.refundsLineNo);
        if (!sold) throw invalid(`lines[${index}].refundsLineNo`, 'exists', 'a line of the sale');
        const qty = new Decimal(input.qty);
        const before = taken.get(sold.lineNo) ?? { qty: new Decimal(0), discount: new Decimal(0) };
        const left = new Decimal(sold.qty).minus(before.qty);
        if (qty.lte(0) || qty.gt(left)) {
          throw new AppError('POS_RETURN_EXCEEDS', `line ${sold.lineNo}: ${left.toString()} left`, {
            lineNo: sold.lineNo,
            remaining: left.toString(),
          });
        }
        // The rest of a line takes the rest of its discount, so the parts add up to the sale.
        const discount = qty.eq(left)
          ? new Decimal(sold.discountAmount).minus(before.discount)
          : toMoney(new Decimal(sold.discountAmount).times(qty).dividedBy(sold.qty));
        const money = lineMoney(qty, sold.unitPrice, discount);
        const rate = loaded.vatRates.get(sold.productId) ?? new Decimal(sold.vatRatePct);
        return {
          lineNo: index + 1,
          productId: sold.productId,
          productUnitId: sold.productUnitId,
          qty: qty.toFixed(3),
          factorSnapshot: sold.factorSnapshot,
          basis: sold.basis,
          listPrice: sold.listPrice,
          unitPrice: sold.unitPrice,
          discountAmount: discount.toFixed(2),
          subtotal: money.subtotal.toFixed(2),
          total: money.total.toFixed(2),
          vatRatePct: rate.toFixed(2),
          vatAmount: lineVat(money.total, rate).toFixed(2),
          applied: [],
          refundsLineNo: sold.lineNo,
          damaged: input.damaged,
        };
      });
      const totals = saleTotals(lines);
      const soldAt = new Date();
      const day = businessDate(soldAt);
      const number = posSaleNumber(tillCode, day, await nextSequence(tx, `SALE:${tillCode}`, day));
      const amount = totals.total.toFixed(2);
      const doc: SaleDocWire = {
        clientId: request.clientId,
        kind: 'RETURN',
        tillCode,
        shiftClientId: shift.clientId,
        cashierUserId: cashier.userId,
        approvedByUserId: approver?.userId ?? null,
        number,
        soldAt: soldAt.toISOString(),
        receiptType: 'B2C',
        customerTin: null,
        customerName: null,
        consumerNo: null,
        refundsSaleClientId: sale.clientId,
        lines,
        // Returns are paid back in cash only (owner 2026-10-23).
        tenders: [
          { kind: 'CASH', amount, tendered: null, terminalId: null, rrn: null, maskedPan: null },
        ],
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        total: amount,
        vatTotal: totals.vatTotal.toFixed(2),
        note: null,
        snapshotVersion: loaded.snapshot.version,
        ebarimt: null,
      };
      const receipt: EdgeReceipt = {
        clientId: request.clientId,
        kind: 'RETURN',
        refundsNumber: sale.number,
        number,
        soldAt: doc.soldAt,
        tillCode,
        cashierName: cashier.fullName,
        companyName: loaded.snapshot.company.name,
        lines: lines.map((line) => {
          const index = sale.doc.lines.findIndex((sold) => sold.lineNo === line.refundsLineNo);
          const shown = sale.receipt.lines[index];
          return {
            name: shown?.name ?? this.nameOf(line.productUnitId),
            uomName: shown?.uomName ?? '',
            qty: new Decimal(line.qty).toString(),
            unitPrice: line.unitPrice,
            total: line.total,
          };
        }),
        subtotal: doc.subtotal,
        discountTotal: doc.discountTotal,
        total: amount,
        vatTotal: doc.vatTotal,
        tenders: [{ kind: 'CASH', amount, tendered: null }],
        change: '0.00',
        ebarimt: { mode: 'TEST', ddtd: null },
      };
      await tx.insert(edgeSales).values({
        clientId: request.clientId,
        kind: 'RETURN',
        refundsClientId: sale.clientId,
        shiftClientId: shift.clientId,
        tillCode,
        cashierUserId: cashier.userId,
        number,
        soldAt,
        total: totals.total,
        cashAmount: totals.total,
        cardAmount: new Decimal(0),
        vatTotal: totals.vatTotal,
        doc,
        receipt,
      });
      await this.outbox.enqueue(tx, { kind: 'RETURN', clientId: request.clientId, sale: doc });
      return receipt;
    });
  }

  /** What the sale's earlier returns on this edge took back, by sold line. */
  private async taken(
    executor: EdgeDb | EdgeTx,
    saleClientId: string,
  ): Promise<Map<number, Taken>> {
    const rows: Pick<SaleRow, 'doc'>[] = await executor
      .select({ doc: edgeSales.doc })
      .from(edgeSales)
      .where(and(eq(edgeSales.refundsClientId, saleClientId), eq(edgeSales.kind, 'RETURN')));
    const taken = new Map<number, Taken>();
    for (const row of rows) {
      for (const line of row.doc.lines) {
        if (line.refundsLineNo === null) continue;
        const before = taken.get(line.refundsLineNo) ?? {
          qty: new Decimal(0),
          discount: new Decimal(0),
        };
        taken.set(line.refundsLineNo, {
          qty: before.qty.plus(line.qty),
          discount: before.discount.plus(line.discountAmount),
        });
      }
    }
    return taken;
  }

  private nameOf(unitId: number): string {
    return this.store.peek()?.units.get(unitId)?.product.name ?? '';
  }
}
