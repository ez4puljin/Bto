import { Inject, Injectable } from '@nestjs/common';
import { Decimal, toMoney } from '@tugeel/shared/money';
import {
  type EdgeCashier,
  type EdgeReceipt,
  type EdgeReturnRequest,
  type EdgeReturnSale,
  lineMoney,
  lineVat,
  loyaltyReturn,
  maskPhone,
  posSaleNumber,
  refundSplit,
  voucherSaleRefundable,
  type SaleDocLineWire,
  type SaleDocWire,
  type SaleLoyaltyWire,
  saleTotals,
  type TenderWire,
  tillCodeLookKey,
  withinReturnWindow,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, or } from 'drizzle-orm';
import { AppError, invalid } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import { edgeSales } from '../db/schema';
import { KioskAuthService } from './kiosk-auth.service';
import { LoyaltyStore } from './loyalty.store';
import { EbarimtService } from '../ebarimt/ebarimt.service';
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
    private readonly ebarimt: EbarimtService,
    private readonly loyalty: LoyaltyStore,
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
      credit: sale.receipt.credit
        ? {
            customerName: sale.receipt.credit.customerName,
            left: Decimal.max(
              sale.creditAmount.minus(await this.creditTaken(this.db, sale.clientId)),
              0,
            ).toFixed(2),
          }
        : null,
      refundable: sale.voucherAmount.gt(0)
        ? (await this.voucherRefundable(this.db, sale)).toFixed(2)
        : null,
      loyalty: sale.doc.loyalty
        ? {
            memberName: sale.receipt.loyalty?.memberName ?? '',
            spent: sale.doc.loyalty.spent,
            earned: sale.doc.loyalty.earned,
          }
        : null,
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
      // ADR-0110 #4: a partner voucher's part is never paid back (owner 2026-10-27).
      if (sale.voucherAmount.gt(0)) {
        const refundable = await this.voucherRefundable(tx, sale);
        if (totals.total.gt(refundable)) {
          throw new AppError(
            'POS_RETURN_VOUCHER_PART',
            `sale ${sale.number}: its voucher part stays`,
            {
              number: sale.number,
              refundable: refundable.toFixed(2),
            },
          );
        }
      }
      // ADR-0109 #6: a sale with credit is paid back off its customer's debt first, then in cash.
      const split = sale.creditAmount.gt(0)
        ? refundSplit({
            saleCredit: sale.creditAmount,
            creditRefunded: await this.creditTaken(tx, sale.clientId),
            total: totals.total,
          })
        : { credit: new Decimal(0), cash: totals.total };
      // ADR-0112: a bonus card sale gives its spent points back first, as points; the earned ones
      // go back by the share of the money returned (owner 2026-10-28).
      const card = sale.doc.loyalty ? await this.cardReturn(tx, sale, totals.total) : null;
      if (card) split.cash = card.split.money;
      const tenders: TenderWire[] = [
        ...(card && card.split.givenBack.gt(0)
          ? [
              {
                kind: 'POINTS' as const,
                amount: card.split.givenBack.toFixed(2),
                tendered: null,
                terminalId: null,
                rrn: null,
                maskedPan: null,
              },
            ]
          : []),
        ...(split.credit.gt(0)
          ? [
              {
                kind: 'CREDIT' as const,
                amount: split.credit.toFixed(2),
                tendered: null,
                terminalId: null,
                rrn: null,
                maskedPan: null,
              },
            ]
          : []),
        ...(split.cash.gt(0)
          ? [
              {
                kind: 'CASH' as const,
                amount: split.cash.toFixed(2),
                tendered: null,
                terminalId: null,
                rrn: null,
                maskedPan: null,
              },
            ]
          : []),
      ];
      const customerId = split.credit.gt(0) ? sale.customerId : null;
      // A sale with credit had no e-Barimt (owner 2026-10-27), so its return changes none.
      const issues = this.ebarimt.enabled && sale.creditAmount.isZero();
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
        customerId,
        loyalty: card?.wire ?? null,
        lines,
        // Returns are paid back in cash (owner 2026-10-23), a credit sale's off its debt first.
        tenders,
        subtotal: totals.subtotal.toFixed(2),
        discountTotal: totals.discountTotal.toFixed(2),
        total: amount,
        vatTotal: totals.vatTotal.toFixed(2),
        note: null,
        snapshotVersion: loaded.snapshot.version,
        ebarimt: null,
      };
      // The return's own receipt facts are the change it makes to the sale's (ADR-0065).
      const saleFacts = sale.receipt.ebarimt;
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
        tenders: tenders.map((tender) => ({
          kind: tender.kind,
          amount: tender.amount,
          tendered: null,
        })),
        change: '0.00',
        credit:
          split.credit.gt(0) && sale.receipt.credit
            ? { ...sale.receipt.credit, amount: split.credit.toFixed(2) }
            : null,
        loyalty: card?.receipt ?? null,
        title: loaded.snapshot.settings.receiptTitle ?? null,
        footer: loaded.snapshot.settings.receiptFooter ?? null,
        ebarimt:
          issues && saleFacts.mode === 'REAL'
            ? {
                ...this.ebarimt.pendingFacts(
                  saleFacts.receiptType ?? 'B2C',
                  saleFacts.customerTin ?? null,
                  saleFacts.customerName ?? null,
                ),
                inactiveId: saleFacts.ddtd,
              }
            : { mode: 'TEST', ddtd: null },
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
        cashAmount: split.cash,
        cardAmount: new Decimal(0),
        creditAmount: split.credit,
        customerId,
        memberId: sale.memberId,
        pointsAmount: card?.split.givenBack ?? new Decimal(0),
        pointsDelta: card ? card.split.givenBack.minus(card.split.clawback) : new Decimal(0),
        spendDelta: card?.split.spendDelta ?? new Decimal(0),
        vatTotal: totals.vatTotal,
        doc,
        receipt,
      });
      await this.outbox.enqueue(tx, { kind: 'RETURN', clientId: request.clientId, sale: doc });
      if (issues) {
        await this.ebarimt.enqueueReturn(tx, { clientId: request.clientId, tillCode }, sale);
      }
      return receipt;
    });
  }

  /**
   * How a return settles a bonus card sale (ADR-0112): `loyaltyReturn` from the sale's member part
   * and its earlier returns', under the member's lock, with the card's balance after it.
   */
  private async cardReturn(
    tx: EdgeTx,
    sale: SaleRow,
    refund: Decimal,
  ): Promise<{
    split: ReturnType<typeof loyaltyReturn>;
    wire: SaleLoyaltyWire;
    receipt: NonNullable<EdgeReceipt['loyalty']>;
  } | null> {
    const sold = sale.doc.loyalty;
    if (!sold) return null;
    await this.loyalty.lock(tx, sold.memberId);
    const earlier = await tx
      .select({ doc: edgeSales.doc })
      .from(edgeSales)
      .where(and(eq(edgeSales.refundsClientId, sale.clientId), eq(edgeSales.kind, 'RETURN')));
    const before = earlier.reduce(
      (sum, row) => ({
        givenBack: sum.givenBack.plus(row.doc.loyalty?.givenBack ?? 0),
        clawedBack: sum.clawedBack.plus(row.doc.loyalty?.clawback ?? 0),
        money: sum.money.minus(row.doc.loyalty?.spendDelta ?? 0),
      }),
      { givenBack: new Decimal(0), clawedBack: new Decimal(0), money: new Decimal(0) },
    );
    const split = loyaltyReturn({
      refund,
      sale: { earned: sold.earned, spent: sold.spent, earnBase: sold.earnBase },
      previous: before,
    });
    const standing = await this.loyalty.standing(sold.memberId, tx);
    return {
      split,
      wire: {
        memberId: sold.memberId,
        earnBase: '0.00',
        percent: sold.percent,
        earned: '0.00',
        spent: '0.00',
        givenBack: split.givenBack.toFixed(2),
        clawback: split.clawback.toFixed(2),
        spendDelta: split.spendDelta.toFixed(2),
      },
      receipt: {
        memberName: standing.member.name,
        phone: maskPhone(standing.member.phone),
        tierName: standing.tier?.name ?? null,
        percent: sold.percent,
        earned: '0.00',
        spent: '0.00',
        givenBack: split.givenBack.toFixed(2),
        clawback: split.clawback.toFixed(2),
        balance: standing.balance.plus(split.givenBack).minus(split.clawback).toFixed(2),
      },
    };
  }

  /** What a sale partly paid by vouchers may still give back: its cash and card, less returns. */
  private async voucherRefundable(
    executor: EdgeDb | EdgeTx,
    sale: { clientId: string; total: Decimal; voucherAmount: Decimal },
  ): Promise<Decimal> {
    const rows = await executor
      .select({ total: edgeSales.total })
      .from(edgeSales)
      .where(and(eq(edgeSales.refundsClientId, sale.clientId), eq(edgeSales.kind, 'RETURN')));
    return voucherSaleRefundable({
      cashAndCardPaid: sale.total.minus(sale.voucherAmount),
      refunded: rows.reduce((sum, row) => sum.plus(row.total), new Decimal(0)),
    });
  }

  /** What the sale's earlier returns took off its customer's debt (ADR-0109). */
  private async creditTaken(executor: EdgeDb | EdgeTx, saleClientId: string): Promise<Decimal> {
    const rows = await executor
      .select({ credit: edgeSales.creditAmount })
      .from(edgeSales)
      .where(and(eq(edgeSales.refundsClientId, saleClientId), eq(edgeSales.kind, 'RETURN')));
    return rows.reduce((sum, row) => sum.plus(row.credit), new Decimal(0));
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
