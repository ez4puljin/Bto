import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeCardAttempt,
  EdgeCardAttemptRequest,
  EdgeCardAttemptResult,
  EdgeCardDetails,
  EdgeCardSettlementRequest,
  EdgeCashier,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { AppError, invalid } from '../../common/errors/app-error';
import { EDGE_DB, type EdgeDb, type EdgeTx, inEdgeTransaction } from '../db/edge-db';
import { edgeCardAttempts, edgeSales } from '../db/schema';
import { nextSequence } from './sequences';
import { EdgeShiftsService } from './shifts.service';
import { SnapshotStore } from './snapshot.store';

type AttemptRow = typeof edgeCardAttempts.$inferSelect;

/** The terminal's answer is kept whole, but not without end (a real one is a few hundred bytes). */
const MAX_RESPONSE_BYTES = 32_768;
const MAX_MESSAGE = 500;
const HISTORY_LIMIT = 500;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** What the centre's tender keeps of a card field (`POS_LIMITS.maxCardField`). */
const MAX_CARD_FIELD = 40;
/** A card number is kept only as the terminal masks it: digits around a run of X or *. */
const MASKED_PAN = /^[0-9]{0,8}[Xx*]{4,}[0-9]{0,4}$/;

/**
 * The card charges a till asks its bank terminal for (ADR-0208). The browser on the till PC talks
 * to the terminal's service itself (`localhost` there); the edge keeps the record around it:
 *
 * - `begin` writes the charge PENDING before the terminal is asked, with the reference the
 *   terminal is given, and refuses while the till has another PENDING charge — a charge that was
 *   never answered is not sent again until the cashier has read the terminal's slip;
 * - `finish` keeps how it ended and the terminal's whole answer;
 * - `saveLookup` keeps what the terminal answered when asked about the charge's reference later
 *   (`getLastTransaction`: free, no money moves);
 * - `claim`, inside the sale's transaction, lets an APPROVED charge pay one sale once and gives
 *   the tender the terminal's id, RRN and masked card number.
 */
@Injectable()
export class CardAttemptsService {
  constructor(
    @Inject(EDGE_DB) private readonly db: EdgeDb,
    private readonly store: SnapshotStore,
    private readonly shifts: EdgeShiftsService,
  ) {}

  async begin(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeCardAttemptRequest,
  ): Promise<EdgeCardAttempt> {
    const again = await this.find(request.id);
    if (again) return view(this.ofTill(again, tillCode));
    const type = (this.store.get().snapshot.paymentTypes ?? []).find(
      (entry) => entry.id === request.paymentTypeId,
    );
    if (!type || type.kind !== 'CARD' || !type.terminal) {
      throw invalid('paymentTypeId', 'terminal', 'a card type of the till with a terminal');
    }
    const amount = new Decimal(request.amount);
    if (!amount.isFinite() || !amount.gt(0) || amount.decimalPlaces() > 2) {
      throw invalid('amount', 'positive', 'a positive amount');
    }
    const [sold] = await this.db
      .select({ clientId: edgeSales.clientId })
      .from(edgeSales)
      .where(eq(edgeSales.clientId, request.saleClientId));
    if (sold) {
      throw new AppError('POS_CARD_ATTEMPT_STATE', 'the sale is already made', {
        status: 'SOLD',
      });
    }
    return this.insert(tillCode, cashier, {
      id: request.id,
      kind: 'SALE',
      provider: type.terminal,
      saleClientId: request.saleClientId,
      paymentTypeId: type.id,
      amount,
      terminalId: request.terminalId?.trim() || null,
    });
  }

  /** The terminal's settlement with the bank, kept like a charge (no money of a sale). */
  async beginSettlement(
    tillCode: string,
    cashier: EdgeCashier,
    request: EdgeCardSettlementRequest,
  ): Promise<EdgeCardAttempt> {
    const again = await this.find(request.id);
    if (again) return view(this.ofTill(again, tillCode));
    return this.insert(tillCode, cashier, {
      id: request.id,
      kind: 'SETTLEMENT',
      provider: 'KHAN',
      saleClientId: null,
      paymentTypeId: null,
      amount: new Decimal(0),
      terminalId: request.terminalId?.trim() || null,
    });
  }

  async finish(
    tillCode: string,
    cashier: EdgeCashier,
    id: string,
    result: EdgeCardAttemptResult,
  ): Promise<EdgeCardAttempt> {
    const response = result.response ?? null;
    if (response !== null && JSON.stringify(response).length > MAX_RESPONSE_BYTES) {
      throw invalid('response', 'size', 'the terminal’s answer is too large to keep');
    }
    const [updated] = await this.db
      .update(edgeCardAttempts)
      .set({
        status: result.outcome,
        source: result.source,
        response,
        message: result.message?.trim().slice(0, MAX_MESSAGE) || null,
        answeredAt: new Date(),
        resolvedByUserId: result.source === 'CASHIER' ? cashier.userId : null,
      })
      .where(
        and(
          eq(edgeCardAttempts.id, id),
          eq(edgeCardAttempts.tillCode, tillCode),
          eq(edgeCardAttempts.status, 'PENDING'),
        ),
      )
      .returning();
    if (updated) return view(updated);
    const row = await this.find(id);
    if (!row || row.tillCode !== tillCode) throw unknownAttempt(id);
    // The same answer sent again (a retry after a lost reply) changes nothing.
    if (row.status === result.outcome) return view(row);
    throw new AppError('POS_CARD_ATTEMPT_STATE', `the charge is ${row.status}`, {
      status: row.status,
    });
  }

  /**
   * What the terminal answered `getLastTransaction` for this charge's reference, kept as it came.
   * An answer about another reference is refused: it says nothing of this charge.
   */
  async saveLookup(tillCode: string, id: string, response: unknown): Promise<EdgeCardAttempt> {
    if (response === null || response === undefined) {
      throw invalid('response', 'required', 'the terminal’s answer');
    }
    if (JSON.stringify(response).length > MAX_RESPONSE_BYTES) {
      throw invalid('response', 'size', 'the terminal’s answer is too large to keep');
    }
    const row = await this.find(id);
    if (!row || row.tillCode !== tillCode) throw unknownAttempt(id);
    const told = text(answerOf(response)?.db_ref_no);
    if (told !== null && told !== row.refNo) {
      throw invalid('response', 'reference', `an answer about ${told}, not ${row.refNo}`);
    }
    const [updated] = await this.db
      .update(edgeCardAttempts)
      .set({ lookup: response })
      .where(eq(edgeCardAttempts.id, id))
      .returning();
    return view(updated ?? row);
  }

  /** This till's charges and settlements of a business day, newest first, with their sales. */
  async ofDay(tillCode: string, day: string): Promise<EdgeCardAttempt[]> {
    if (!DAY.test(day)) throw invalid('day', 'date', 'YYYY-MM-DD');
    const rows = await this.db
      .select({ attempt: edgeCardAttempts, saleNumber: edgeSales.number })
      .from(edgeCardAttempts)
      .leftJoin(
        edgeSales,
        and(
          eq(edgeSales.clientId, edgeCardAttempts.saleClientId),
          sql`${edgeCardAttempts.usedAt} IS NOT NULL`,
        ),
      )
      .where(
        and(
          eq(edgeCardAttempts.tillCode, tillCode),
          sql`to_char(${edgeCardAttempts.createdAt} AT TIME ZONE 'Asia/Ulaanbaatar', 'YYYY-MM-DD') = ${day}`,
        ),
      )
      .orderBy(desc(edgeCardAttempts.createdAt))
      .limit(HISTORY_LIMIT);
    return rows.map((row) => ({ ...view(row.attempt), saleNumber: row.saleNumber ?? null }));
  }

  /** An approved charge given back on the terminal by hand before any sale used it. */
  async voidApproved(tillCode: string, cashier: EdgeCashier, id: string): Promise<EdgeCardAttempt> {
    const [updated] = await this.db
      .update(edgeCardAttempts)
      .set({ status: 'VOIDED', resolvedByUserId: cashier.userId })
      .where(
        and(
          eq(edgeCardAttempts.id, id),
          eq(edgeCardAttempts.tillCode, tillCode),
          eq(edgeCardAttempts.kind, 'SALE'),
          eq(edgeCardAttempts.status, 'APPROVED'),
          isNull(edgeCardAttempts.usedAt),
        ),
      )
      .returning();
    if (updated) return view(updated);
    const row = await this.find(id);
    if (!row || row.tillCode !== tillCode) throw unknownAttempt(id);
    if (row.status === 'VOIDED') return view(row);
    throw new AppError('POS_CARD_ATTEMPT_STATE', `the charge is ${row.status}`, {
      status: row.usedAt ? 'USED' : row.status,
    });
  }

  /**
   * What the till must still deal with: a charge without an answer, and approved charges no sale
   * has used (the payment was left, or the page was loaded again).
   */
  async open(tillCode: string): Promise<EdgeCardAttempt[]> {
    const rows = await this.db
      .select()
      .from(edgeCardAttempts)
      .where(
        and(
          eq(edgeCardAttempts.tillCode, tillCode),
          or(
            eq(edgeCardAttempts.status, 'PENDING'),
            and(
              eq(edgeCardAttempts.kind, 'SALE'),
              eq(edgeCardAttempts.status, 'APPROVED'),
              isNull(edgeCardAttempts.usedAt),
            ),
          ),
        ),
      )
      .orderBy(asc(edgeCardAttempts.createdAt));
    return rows.map(view);
  }

  /**
   * Inside the sale's transaction: the approved charge of exactly this amount pays this sale, once.
   * Answers the terminal's id, RRN and masked card number for the tender.
   */
  async claim(
    tx: EdgeTx,
    tillCode: string,
    saleClientId: string,
    attemptId: string,
    amount: Decimal,
  ): Promise<{ terminalId: string | null; rrn: string | null; maskedPan: string | null }> {
    const [row] = await tx
      .update(edgeCardAttempts)
      .set({ saleClientId, usedAt: new Date() })
      .where(
        and(
          eq(edgeCardAttempts.id, attemptId),
          eq(edgeCardAttempts.tillCode, tillCode),
          eq(edgeCardAttempts.kind, 'SALE'),
          eq(edgeCardAttempts.status, 'APPROVED'),
          isNull(edgeCardAttempts.usedAt),
          eq(edgeCardAttempts.amount, amount),
        ),
      )
      .returning();
    if (!row) {
      throw new AppError('POS_CARD_NOT_CHARGED', `no approved card charge ${attemptId}`, {
        amount: amount.toFixed(2),
      });
    }
    const details = detailsOf(row);
    return { terminalId: row.terminalId, rrn: details.rrn, maskedPan: details.maskedPan };
  }

  private async find(id: string): Promise<AttemptRow | null> {
    const [row] = await this.db.select().from(edgeCardAttempts).where(eq(edgeCardAttempts.id, id));
    return row ?? null;
  }

  private ofTill(row: AttemptRow, tillCode: string): AttemptRow {
    if (row.tillCode !== tillCode) throw unknownAttempt(row.id);
    return row;
  }

  private insert(
    tillCode: string,
    cashier: EdgeCashier,
    values: Pick<
      AttemptRow,
      'id' | 'kind' | 'provider' | 'saleClientId' | 'paymentTypeId' | 'amount' | 'terminalId'
    >,
  ): Promise<EdgeCardAttempt> {
    return inEdgeTransaction(this.db, async (tx) => {
      const shift = await this.shifts.current(tillCode, tx);
      if (!shift) {
        throw new AppError('POS_SHIFT_STATE_INVALID', `till ${tillCode} has no open shift`, {
          tillCode,
        });
      }
      const [pending] = await tx
        .select()
        .from(edgeCardAttempts)
        .where(and(eq(edgeCardAttempts.tillCode, tillCode), eq(edgeCardAttempts.status, 'PENDING')))
        .for('update');
      if (pending) {
        throw new AppError('POS_CARD_PENDING', `till ${tillCode} waits for a card charge`, {
          refNo: pending.refNo,
          amount: pending.amount.toFixed(2),
        });
      }
      const day = businessDate();
      // Digits only, 14 of them (the terminal took 14–15 and refused 19): the day, a 9 and a
      // number of this edge. Erxes sends the same terminal the day and four digits, and the
      // terminal answers a lookup by this reference alone — the two must never be equal.
      const refNo = `${day.replaceAll('-', '')}9${String(await nextSequence(tx, 'CARD-REF', day)).padStart(5, '0')}`;
      const [row] = await tx
        .insert(edgeCardAttempts)
        .values({
          ...values,
          tillCode,
          shiftClientId: shift.clientId,
          cashierUserId: cashier.userId,
          cashierName: cashier.fullName,
          refNo,
        })
        .returning();
      if (!row) throw new Error('the card attempt was not written');
      return view(row);
    });
  }
}

function unknownAttempt(id: string): AppError {
  return new AppError('NOT_FOUND', `card attempt ${id} not found`, { id });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The `response` object inside one of the terminal's answers (`{ status, response: {…} }`). */
function answerOf(body: unknown): Record<string, unknown> | null {
  return isRecord(body) && isRecord(body.response) ? body.response : null;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() && value.trim().length <= MAX_CARD_FIELD
    ? value.trim()
    : null;

/**
 * The terminal's facts of a charge: from its answer to the lookup when the till asked (the shape
 * seen on the real terminal), else from the sale's own answer where it holds the same fields. Only
 * an answer the terminal approved (`000`) describes money that moved.
 */
function detailsOf(row: AttemptRow): EdgeCardDetails {
  const answers = [answerOf(row.lookup), answerOf(row.response)].filter(
    (answer): answer is Record<string, unknown> => answer?.response_code === '000',
  );
  const pick = (field: string) =>
    answers.map((answer) => text(answer[field])).find((value) => value !== null) ?? null;
  const pan = pick('pan');
  return {
    maskedPan: pan !== null && MASKED_PAN.test(pan) ? pan : null,
    rrn: pick('rrn'),
    traceNo: pick('trace_no'),
    batchNo: pick('batch_no'),
    entryMode: pick('entry_mode'),
    appName: pick('app_name'),
  };
}

function view(row: AttemptRow): EdgeCardAttempt {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    refNo: row.refNo,
    saleClientId: row.saleClientId,
    paymentTypeId: row.paymentTypeId,
    amount: row.amount.toFixed(2),
    cashierName: row.cashierName,
    createdAt: row.createdAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    source: row.source,
    message: row.message,
    details: row.status === 'APPROVED' || row.status === 'VOIDED' ? detailsOf(row) : null,
  };
}
