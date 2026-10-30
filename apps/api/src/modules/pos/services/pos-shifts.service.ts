import { Inject, Injectable } from '@nestjs/common';
import type { GlRole } from '@tugeel/shared/finance';
import { Decimal } from '@tugeel/shared/money';
import {
  cashVariance,
  expectedCash,
  handoverAmount,
  POS_LIMITS,
  type TenderKind,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  GlAccountsService,
  type JournalLineInput,
  JournalService,
  MoneyAccountsService,
  PaymentsService,
} from '../../finance';
import { type Actor, AuditService, type AuthContext, UserNamesService } from '../../identity';
import type { Accepted, ShiftCloseDoc, ShiftOpenDoc } from '../sale-doc';
import { posSaleLoyalty, posSales, posShifts, posTenders } from '../schema';
import type { EdgeNode } from './pos-edge-nodes.service';
import { PosCashiersService } from './pos-cashiers.service';
import { PosSettingsService } from './pos-settings.service';
import { PosTillsService } from './pos-tills.service';

export type ShiftRow = typeof posShifts.$inferSelect;

/** What a shift sold and took back, from its accepted documents. */
export interface ShiftTotals {
  salesCount: number;
  returnsCount: number;
  cashSales: Decimal;
  cashRefunds: Decimal;
  cardSales: Decimal;
  cardRefunds: Decimal;
  salesTotal: Decimal;
  returnsTotal: Decimal;
  salesVat: Decimal;
  returnsVat: Decimal;
  /** ADR-0109: the CREDIT tenders of the sales, and of the returns (taken off the debts). */
  creditSales: Decimal;
  creditRefunds: Decimal;
  /** ADR-0110: the VOUCHER tenders of the sales (a voucher's part is never refunded). */
  voucherSales: Decimal;
  /** ADR-0111: bank transfers taken at the till, and given back. */
  transferSales: Decimal;
  transferRefunds: Decimal;
  /**
   * ADR-0112: the POINTS tenders of the sales and of the returns (points given back), and the
   * points the sales earned and the returns took back.
   */
  pointsSales: Decimal;
  pointsRefunds: Decimal;
  pointsEarned: Decimal;
  pointsClawback: Decimal;
}

/** One payment type's money on a shift (ADR-0111), in the till's order; null type = older tenders. */
export interface ShiftPayment {
  paymentTypeId: number | null;
  name: string | null;
  kind: TenderKind;
  sales: Decimal;
  refunds: Decimal;
}

/**
 * What the shift's credit sales and their returns booked on their own invoices and credit notes
 * (ADR-0109): left out of the close's entry, which books the rest.
 */
export interface ShiftBooked {
  salesTotal: Decimal;
  salesVat: Decimal;
  returnsTotal: Decimal;
  returnsVat: Decimal;
  /** Cash taken by the invoiced sales less cash paid back by the credited returns. */
  cash: Decimal;
  card: Decimal;
  transfer: Decimal;
}

const NOTHING_BOOKED: ShiftBooked = {
  salesTotal: new Decimal(0),
  salesVat: new Decimal(0),
  returnsTotal: new Decimal(0),
  returnsVat: new Decimal(0),
  cash: new Decimal(0),
  card: new Decimal(0),
  transfer: new Decimal(0),
};

export interface HandoverInput {
  moneyAccountId: number | null;
  amount: Decimal | null;
  paidOn: string | null;
}

const ZERO = new Decimal(0);
const MONEY_SCALE = 2;

/**
 * Shifts (ADR-0064): opened and closed at the till and replayed here; the close books the shift's
 * money in one journal entry, the hand-over records the cash the accountant received.
 */
@Injectable()
export class PosShiftsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly tills: PosTillsService,
    private readonly cashiers: PosCashiersService,
    private readonly settings: PosSettingsService,
    private readonly journal: JournalService,
    private readonly accounts: GlAccountsService,
    private readonly payments: PaymentsService,
    private readonly moneyAccounts: MoneyAccountsService,
  ) {}

  /** A shift opened at a till: one open shift per till; a repeated document is a duplicate. */
  async acceptOpen(tx: Tx, actor: Actor, node: EdgeNode, doc: ShiftOpenDoc): Promise<Accepted> {
    const existing = await this.byClientId(tx, node.id, doc.clientId);
    if (existing) return { id: existing.id, number: existing.number, created: false };
    const till = await this.tills.activeByCode(node.id, doc.tillCode, tx);
    await this.cashiers.assertActive(doc.cashierUserId, tx);
    if (doc.openingFloat.isNegative() || doc.openingFloat.decimalPlaces() > MONEY_SCALE) {
      throw invalid('openingFloat', 'money', 'a non-negative amount with 2 decimals');
    }
    const [open] = await tx
      .select({ id: posShifts.id, number: posShifts.number })
      .from(posShifts)
      .where(and(eq(posShifts.tillId, till.id), eq(posShifts.status, 'OPEN')));
    if (open) {
      throw new AppError('POS_TILL_BUSY', `till ${till.code} has the open shift ${open.number}`, {
        tillCode: till.code,
        number: open.number,
      });
    }
    const [row] = await tx
      .insert(posShifts)
      .values({
        clientId: doc.clientId,
        edgeNodeId: node.id,
        tillId: till.id,
        cashierUserId: doc.cashierUserId,
        number: doc.number,
        openedAt: doc.openedAt,
        openingFloat: doc.openingFloat,
      })
      .onConflictDoNothing({ target: [posShifts.edgeNodeId, posShifts.clientId] })
      .returning({ id: posShifts.id, number: posShifts.number });
    if (!row) {
      const raced = await this.byClientId(tx, node.id, doc.clientId);
      if (!raced) throw new Error('pos_shifts insert returned no row');
      return { id: raced.id, number: raced.number, created: false };
    }
    await this.audit.record(tx, actor, {
      action: 'OPEN',
      entity: 'pos_shifts',
      entityId: row.id,
      after: {
        number: doc.number,
        tillCode: till.code,
        cashierUserId: doc.cashierUserId,
        openingFloat: doc.openingFloat.toFixed(MONEY_SCALE),
      },
    });
    return { id: row.id, number: row.number, created: true };
  }

  /** The open shift a document belongs to, locked for the rest of the transaction. */
  async lockOpen(tx: Tx, nodeId: number, clientId: string): Promise<ShiftRow> {
    const [row] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.edgeNodeId, nodeId), eq(posShifts.clientId, clientId)))
      .for('update');
    if (!row) {
      throw new AppError('POS_SHIFT_STATE_INVALID', `shift ${clientId} is unknown`, {
        status: 'MISSING',
      });
    }
    if (row.status !== 'OPEN') {
      throw new AppError('POS_SHIFT_STATE_INVALID', `shift ${row.number} is ${row.status}`, {
        status: row.status,
        number: row.number,
      });
    }
    return row;
  }

  /**
   * The close (ADR-0064 #2): the shift's totals from its documents, the expected cash, the
   * variance, and one balanced journal entry — Dr POS_CASH (counted − float), Dr CARD_CLEARING,
   * Dr SALES_RETURN and VAT_PAYABLE for the returns, Cr POS_SALES and VAT_PAYABLE for the sales,
   * the variance on CASH_VARIANCE. A repeated close is a duplicate.
   */
  async acceptClose(tx: Tx, actor: Actor, node: EdgeNode, doc: ShiftCloseDoc): Promise<Accepted> {
    const [row] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.edgeNodeId, node.id), eq(posShifts.clientId, doc.clientId)))
      .for('update');
    if (!row) {
      throw new AppError('POS_SHIFT_STATE_INVALID', `shift ${doc.clientId} is unknown`, {
        status: 'MISSING',
      });
    }
    if (row.status !== 'OPEN') return { id: row.id, number: row.number, created: false };
    for (const [path, value] of [
      ['countedCash', doc.countedCash],
      ['floatKept', doc.floatKept],
    ] as const) {
      if (value.isNegative() || value.decimalPlaces() > MONEY_SCALE) {
        throw invalid(path, 'money', 'a non-negative amount with 2 decimals');
      }
    }
    const note = doc.note?.trim() || null;
    if (note && note.length > POS_LIMITS.maxNote) {
      throw invalid('note', 'length', `at most ${POS_LIMITS.maxNote} characters`);
    }
    const totals = await this.totals(row.id, tx);
    const booked = await this.booked(row.id, tx);
    const expected = expectedCash({
      openingFloat: row.openingFloat,
      cashSales: totals.cashSales,
      cashRefunds: totals.cashRefunds,
    });
    const variance = cashVariance(doc.countedCash, expected);
    const closeDay = businessDate(doc.closedAt);
    const entry = await this.bookClose(
      tx,
      actor,
      row,
      totals,
      doc.countedCash,
      variance,
      closeDay,
      booked,
    );
    await tx
      .update(posShifts)
      .set({
        status: 'CLOSED',
        closedAt: doc.closedAt,
        countedCash: doc.countedCash,
        floatKept: doc.floatKept,
        expectedCash: expected,
        variance,
        note,
        salesCount: totals.salesCount,
        returnsCount: totals.returnsCount,
        cashSales: totals.cashSales,
        cashRefunds: totals.cashRefunds,
        cardSales: totals.cardSales,
        cardRefunds: totals.cardRefunds,
        salesTotal: totals.salesTotal,
        returnsTotal: totals.returnsTotal,
        salesVat: totals.salesVat,
        returnsVat: totals.returnsVat,
        creditSales: totals.creditSales,
        creditRefunds: totals.creditRefunds,
        voucherSales: totals.voucherSales,
        transferSales: totals.transferSales,
        transferRefunds: totals.transferRefunds,
        pointsSales: totals.pointsSales,
        pointsRefunds: totals.pointsRefunds,
        pointsEarned: totals.pointsEarned,
        pointsClawback: totals.pointsClawback,
        journalEntryId: entry?.id ?? null,
        journalNumber: entry?.number ?? null,
        updatedAt: sql`now()`,
      })
      .where(eq(posShifts.id, row.id));
    await this.audit.record(tx, actor, {
      action: 'CLOSE',
      entity: 'pos_shifts',
      entityId: row.id,
      after: {
        number: row.number,
        countedCash: doc.countedCash.toFixed(MONEY_SCALE),
        expectedCash: expected.toFixed(MONEY_SCALE),
        variance: variance.toFixed(MONEY_SCALE),
        salesCount: totals.salesCount,
        returnsCount: totals.returnsCount,
        journalEntry: entry?.number ?? null,
      },
    });
    return { id: row.id, number: row.number, created: true };
  }

  /**
   * The accountant received the shift's cash (ADR-0064 #3): an OTHER_IN voucher on the chosen cash
   * box against the POS_CASH account, in the same transaction as the shift's new status.
   */
  async handOver(ctx: AuthContext, shiftId: number, input: HandoverInput): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .select()
        .from(posShifts)
        .where(eq(posShifts.id, shiftId))
        .for('update');
      if (!row) throw notFound('pos_shift', shiftId);
      if (row.status !== 'CLOSED' || row.countedCash === null || row.floatKept === null) {
        throw new AppError('POS_SHIFT_STATE_INVALID', `shift ${row.number} is ${row.status}`, {
          status: row.status,
          number: row.number,
        });
      }
      const settings = await this.settings.get(tx);
      const moneyAccountId = input.moneyAccountId ?? settings.handoverMoneyAccountId;
      if (moneyAccountId === null) {
        throw invalid('moneyAccountId', 'required', 'choose the cash box');
      }
      const account = await this.moneyAccounts.get(moneyAccountId, tx);
      if (account.kind !== 'CASH') throw invalid('moneyAccountId', 'cash', 'a cash box');
      const amount = input.amount ?? handoverAmount(row.countedCash, row.floatKept);
      if (!amount.gt(0) || amount.decimalPlaces() > MONEY_SCALE) {
        throw invalid('amount', 'money', 'a positive amount with 2 decimals');
      }
      const cashierName = (await this.names.namesOf([row.cashierUserId])).get(row.cashierUserId);
      const posCash = await this.accounts.byRole('POS_CASH', tx);
      const voucher = await this.payments.recordInTx(tx, ctx, {
        kind: 'OTHER_IN',
        moneyAccountId,
        customerId: null,
        glAccountId: posCash.id,
        amount,
        paidOn: input.paidOn ?? businessDate(),
        description: label(row.number, cashierName),
        reference: row.number,
        counterpartyName: cashierName ?? null,
        collectedBy: row.cashierUserId,
      });
      await tx
        .update(posShifts)
        .set({
          status: 'HANDED_OVER',
          handoverPaymentId: voucher.id,
          handoverNumber: voucher.number,
          handedOverAt: sql`now()`,
          handedOverBy: ctx.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(posShifts.id, shiftId));
      await this.audit.record(tx, ctx, {
        action: 'HANDOVER',
        entity: 'pos_shifts',
        entityId: shiftId,
        after: { number: row.number, voucher: voucher.number, amount: amount.toFixed(MONEY_SCALE) },
      });
    });
  }

  /** The shift's money from its accepted documents (live for an open shift). */
  async totals(shiftId: number, executor: Db | Tx = this.db): Promise<ShiftTotals> {
    const sale = (kind: 'SALE' | 'RETURN', column: 'total' | 'vat_total') =>
      sql<string>`coalesce(sum(CASE WHEN ${posSales.kind} = ${kind} THEN ${sql.raw(`"pos_sales"."${column}"`)} ELSE 0 END), 0)`;
    const [header] = await executor
      .select({
        salesCount: sql<string>`count(*) FILTER (WHERE ${posSales.kind} = 'SALE')`,
        returnsCount: sql<string>`count(*) FILTER (WHERE ${posSales.kind} = 'RETURN')`,
        salesTotal: sale('SALE', 'total'),
        returnsTotal: sale('RETURN', 'total'),
        salesVat: sale('SALE', 'vat_total'),
        returnsVat: sale('RETURN', 'vat_total'),
      })
      .from(posSales)
      .where(eq(posSales.shiftId, shiftId));
    const tender = (kind: 'SALE' | 'RETURN', tenderKind: TenderKind) =>
      sql<string>`coalesce(sum(CASE WHEN ${posSales.kind} = ${kind} AND ${posTenders.kind} = ${tenderKind} THEN ${posTenders.amount} ELSE 0 END), 0)`;
    const [tenders] = await executor
      .select({
        cashSales: tender('SALE', 'CASH'),
        cashRefunds: tender('RETURN', 'CASH'),
        cardSales: tender('SALE', 'CARD'),
        cardRefunds: tender('RETURN', 'CARD'),
        creditSales: tender('SALE', 'CREDIT'),
        creditRefunds: tender('RETURN', 'CREDIT'),
        voucherSales: tender('SALE', 'VOUCHER'),
        transferSales: tender('SALE', 'TRANSFER'),
        transferRefunds: tender('RETURN', 'TRANSFER'),
        pointsSales: tender('SALE', 'POINTS'),
        pointsRefunds: tender('RETURN', 'POINTS'),
      })
      .from(posTenders)
      .innerJoin(posSales, eq(posSales.id, posTenders.saleId))
      .where(eq(posSales.shiftId, shiftId));
    const [points] = await executor
      .select({
        earned: sql<string>`coalesce(sum(${posSaleLoyalty.earned}), 0)`,
        clawback: sql<string>`coalesce(sum(${posSaleLoyalty.clawback}), 0)`,
      })
      .from(posSaleLoyalty)
      .innerJoin(posSales, eq(posSales.id, posSaleLoyalty.saleId))
      .where(eq(posSales.shiftId, shiftId));
    const money = (value: string | undefined) => new Decimal(value ?? '0');
    return {
      salesCount: Number.parseInt(header?.salesCount ?? '0', 10),
      returnsCount: Number.parseInt(header?.returnsCount ?? '0', 10),
      cashSales: money(tenders?.cashSales),
      cashRefunds: money(tenders?.cashRefunds),
      cardSales: money(tenders?.cardSales),
      cardRefunds: money(tenders?.cardRefunds),
      salesTotal: money(header?.salesTotal),
      returnsTotal: money(header?.returnsTotal),
      salesVat: money(header?.salesVat),
      returnsVat: money(header?.returnsVat),
      creditSales: money(tenders?.creditSales),
      creditRefunds: money(tenders?.creditRefunds),
      voucherSales: money(tenders?.voucherSales),
      transferSales: money(tenders?.transferSales),
      transferRefunds: money(tenders?.transferRefunds),
      pointsSales: money(tenders?.pointsSales),
      pointsRefunds: money(tenders?.pointsRefunds),
      pointsEarned: money(points?.earned),
      pointsClawback: money(points?.clawback),
    };
  }

  /** The shift's money by payment type (ADR-0111): the till's lines of its Z. */
  async paymentsByType(shiftId: number, executor: Db | Tx = this.db): Promise<ShiftPayment[]> {
    const rows = await executor
      .select({
        paymentTypeId: posTenders.paymentTypeId,
        name: sql<string | null>`max(${posTenders.paymentTypeName})`,
        kind: posTenders.kind,
        sales: sql<string>`coalesce(sum(${posTenders.amount}) FILTER (WHERE ${posSales.kind} = 'SALE'), 0)`,
        refunds: sql<string>`coalesce(sum(${posTenders.amount}) FILTER (WHERE ${posSales.kind} = 'RETURN'), 0)`,
        first: sql<number>`min(${posTenders.id})`,
      })
      .from(posTenders)
      .innerJoin(posSales, eq(posSales.id, posTenders.saleId))
      .where(eq(posSales.shiftId, shiftId))
      .groupBy(posTenders.paymentTypeId, posTenders.kind)
      .orderBy(sql`min(${posTenders.id})`);
    return rows.map((row) => ({
      paymentTypeId: row.paymentTypeId,
      name: row.name,
      kind: row.kind,
      sales: new Decimal(row.sales),
      refunds: new Decimal(row.refunds),
    }));
  }

  /** The part of the shift its credit sales and returns booked themselves (ADR-0109). */
  async booked(shiftId: number, executor: Db | Tx = this.db): Promise<ShiftBooked> {
    const own = sql`(${posSales.invoiceId} IS NOT NULL OR ${posSales.creditNoteId} IS NOT NULL)`;
    const sale = (kind: 'SALE' | 'RETURN', column: 'total' | 'vat_total') =>
      sql<string>`coalesce(sum(CASE WHEN ${posSales.kind} = ${kind} AND ${own} THEN ${sql.raw(`"pos_sales"."${column}"`)} ELSE 0 END), 0)`;
    const [header] = await executor
      .select({
        salesTotal: sale('SALE', 'total'),
        salesVat: sale('SALE', 'vat_total'),
        returnsTotal: sale('RETURN', 'total'),
        returnsVat: sale('RETURN', 'vat_total'),
      })
      .from(posSales)
      .where(eq(posSales.shiftId, shiftId));
    const paid = (tenderKind: 'CASH' | 'CARD' | 'TRANSFER') =>
      sql<string>`coalesce(sum(CASE WHEN ${posTenders.kind} = ${tenderKind} AND ${own} THEN (CASE WHEN ${posSales.kind} = 'SALE' THEN ${posTenders.amount} ELSE -${posTenders.amount} END) ELSE 0 END), 0)`;
    const [tenders] = await executor
      .select({ cash: paid('CASH'), card: paid('CARD'), transfer: paid('TRANSFER') })
      .from(posTenders)
      .innerJoin(posSales, eq(posSales.id, posTenders.saleId))
      .where(eq(posSales.shiftId, shiftId));
    const money = (value: string | undefined) => new Decimal(value ?? '0');
    return {
      salesTotal: money(header?.salesTotal),
      salesVat: money(header?.salesVat),
      returnsTotal: money(header?.returnsTotal),
      returnsVat: money(header?.returnsVat),
      cash: money(tenders?.cash),
      card: money(tenders?.card),
      transfer: money(tenders?.transfer),
    };
  }

  /** A shift by the uuid its till gave it, in any state. */
  async byClientId(tx: Tx, nodeId: number, clientId: string): Promise<ShiftRow | null> {
    const [row] = await tx
      .select()
      .from(posShifts)
      .where(and(eq(posShifts.edgeNodeId, nodeId), eq(posShifts.clientId, clientId)));
    return row ?? null;
  }

  /**
   * The development re-post of F1's ledger (ADR-0089): a closed shift whose entry went with Finance
   * I's journal is booked again from the totals kept on it, dated its close day, and keeps the new
   * entry's id and number. Null when the shift has its entry, is still open, or moved nothing.
   */
  async repostCloseInTx(
    tx: Tx,
    actor: Actor,
    shiftId: number,
  ): Promise<{ id: number; number: string } | null> {
    const [row] = await tx.select().from(posShifts).where(eq(posShifts.id, shiftId)).for('update');
    if (
      !row ||
      row.status === 'OPEN' ||
      row.journalEntryId !== null ||
      row.countedCash === null ||
      row.variance === null ||
      row.closedAt === null
    ) {
      return null;
    }
    const entry = await this.bookClose(
      tx,
      actor,
      row,
      row,
      row.countedCash,
      row.variance,
      businessDate(row.closedAt),
      await this.booked(row.id, tx),
    );
    if (!entry) return null;
    await tx
      .update(posShifts)
      .set({ journalEntryId: entry.id, journalNumber: entry.number, updatedAt: sql`now()` })
      .where(eq(posShifts.id, row.id));
    return entry;
  }

  /** The closed shifts without an entry, oldest close first (the development re-post). */
  async closedWithoutEntry(): Promise<number[]> {
    const rows = await this.db
      .select({ id: posShifts.id })
      .from(posShifts)
      .where(and(isNull(posShifts.journalEntryId), isNotNull(posShifts.closedAt)))
      .orderBy(asc(posShifts.closedAt), asc(posShifts.id));
    return rows.map((row) => row.id);
  }

  /** The close entry; null when nothing moved and the count matched. */
  private async bookClose(
    tx: Tx,
    actor: Actor,
    shift: ShiftRow,
    totals: Parameters<typeof shiftCloseLines>[0]['totals'],
    countedCash: Decimal,
    variance: Decimal,
    closeDay: string,
    booked: ShiftBooked,
  ): Promise<{ id: number; number: string } | null> {
    const lines = shiftCloseLines({
      openingFloat: shift.openingFloat,
      countedCash,
      variance,
      totals,
      booked,
    });
    if (lines.length === 0) return null;
    const till = await this.tills.get(shift.tillId, tx);
    const cashierName = (await this.names.namesOf([shift.cashierUserId])).get(shift.cashierUserId);
    const entry = await this.journal.post(tx, actor, {
      entryDate: closeDay,
      // ADR-0123: the till's own sales floor, not the edge's.
      warehouseIds: [till.warehouseId],
      description: label(shift.number, [till.name, cashierName].filter(Boolean).join(' · ')),
      source: 'AUTO_POS_SHIFT',
      sourceType: 'POS_SHIFT',
      sourceId: shift.id,
      lines,
    });
    return entry;
  }
}

/**
 * A shift close's entry (ADR-0064 #2): Dr POS_CASH (counted − float), Dr CARD_CLEARING, Dr
 * SALES_RETURN and VAT_PAYABLE for the returns, Cr POS_SALES and VAT_PAYABLE for the sales, the
 * variance on CASH_VARIANCE; zero lines skipped, none at all when nothing moved. Also used by the
 * development re-post (`pnpm finance:repost-journal`, ADR-0089) from the totals kept on the shift.
 * ADR-0109: what the credit sales and their returns booked on their own invoices and credit notes
 * (their revenue, VAT, and the cash and card the till took or paid back for them) is left out;
 * the counted cash, the expected cash and the variance are the drawer's, unchanged. ADR-0110: Dr
 * VOUCHER_CLEARING for what partner vouchers paid; each partner's bill credits it. ADR-0112 (the
 * bonus card, TODO-VERIFY D16): Dr LOYALTY_LIABILITY for the points spent and Cr for the points
 * given back; the points earned Dr LOYALTY_EXPENSE / Cr LOYALTY_LIABILITY, those taken back the
 * reverse.
 */
export function shiftCloseLines(input: {
  openingFloat: Decimal;
  countedCash: Decimal;
  variance: Decimal;
  totals: Pick<
    ShiftTotals,
    'cardSales' | 'cardRefunds' | 'returnsTotal' | 'returnsVat' | 'salesTotal' | 'salesVat'
  > &
    Partial<
      Pick<
        ShiftTotals,
        | 'voucherSales'
        | 'transferSales'
        | 'transferRefunds'
        | 'pointsSales'
        | 'pointsRefunds'
        | 'pointsEarned'
        | 'pointsClawback'
      >
    >;
  booked?: ShiftBooked;
}): JournalLineInput[] {
  const { totals } = input;
  const booked = input.booked ?? NOTHING_BOOKED;
  const salesTotal = totals.salesTotal.minus(booked.salesTotal);
  const salesVat = totals.salesVat.minus(booked.salesVat);
  const returnsTotal = totals.returnsTotal.minus(booked.returnsTotal);
  const returnsVat = totals.returnsVat.minus(booked.returnsVat);
  const signed: { role: GlRole; amount: Decimal }[] = [
    // Positive = debit, negative = credit.
    { role: 'POS_CASH', amount: input.countedCash.minus(input.openingFloat).minus(booked.cash) },
    {
      role: 'CARD_CLEARING',
      amount: totals.cardSales.minus(totals.cardRefunds).minus(booked.card),
    },
    { role: 'VOUCHER_CLEARING', amount: totals.voucherSales ?? ZERO },
    {
      role: 'LOYALTY_LIABILITY',
      amount: (totals.pointsSales ?? ZERO)
        .minus(totals.pointsRefunds ?? ZERO)
        .minus(totals.pointsEarned ?? ZERO)
        .plus(totals.pointsClawback ?? ZERO),
    },
    {
      role: 'LOYALTY_EXPENSE',
      amount: (totals.pointsEarned ?? ZERO).minus(totals.pointsClawback ?? ZERO),
    },
    {
      role: 'TRANSFER_CLEARING',
      amount: (totals.transferSales ?? ZERO)
        .minus(totals.transferRefunds ?? ZERO)
        .minus(booked.transfer),
    },
    { role: 'CASH_VARIANCE', amount: input.variance.negated() },
    { role: 'SALES_RETURN', amount: returnsTotal.minus(returnsVat) },
    { role: 'POS_SALES', amount: salesTotal.minus(salesVat).negated() },
    { role: 'VAT_PAYABLE', amount: returnsVat.minus(salesVat) },
  ];
  return signed
    .filter((entry) => !entry.amount.isZero())
    .map((entry) => ({
      role: entry.role,
      debit: entry.amount.gt(0) ? entry.amount : ZERO,
      credit: entry.amount.lt(0) ? entry.amount.negated() : ZERO,
    }));
}

function label(number: string, who: string | null | undefined): string {
  const name = who?.trim();
  return name ? `${number} — ${name}`.slice(0, 300) : number;
}
