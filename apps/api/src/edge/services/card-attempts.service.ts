import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import type {
  EdgeCardAttempt,
  EdgeCardAttemptRequest,
  EdgeCardAttemptResult,
  EdgeCardSettlementRequest,
  EdgeCashier,
} from '@tugeel/shared/pos';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
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

/**
 * The card charges a till asks its bank terminal for (ADR-0208). The browser on the till PC talks
 * to the terminal's service itself (`localhost` there); the edge keeps the record around it:
 *
 * - `begin` writes the charge PENDING before the terminal is asked, with the reference the
 *   terminal is given, and refuses while the till has another PENDING charge — a charge that was
 *   never answered is not sent again until the cashier has read the terminal's slip;
 * - `finish` keeps how it ended and the terminal's whole answer;
 * - `claim`, inside the sale's transaction, lets an APPROVED charge pay one sale once.
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
   * Answers the terminal's id for the tender.
   */
  async claim(
    tx: EdgeTx,
    tillCode: string,
    saleClientId: string,
    attemptId: string,
    amount: Decimal,
  ): Promise<{ terminalId: string | null }> {
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
      .returning({ terminalId: edgeCardAttempts.terminalId });
    if (!row) {
      throw new AppError('POS_CARD_NOT_CHARGED', `no approved card charge ${attemptId}`, {
        amount: amount.toFixed(2),
      });
    }
    return row;
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
      // Digits only, as the terminal's service is given by the till it came with: the day and a
      // number of this edge.
      const refNo = `${day.replaceAll('-', '')}${String(await nextSequence(tx, 'CARD-REF', day)).padStart(4, '0')}`;
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
  };
}
