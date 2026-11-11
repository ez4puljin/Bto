import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  DDTD_PATTERN,
  POSAPI_DATE_PATTERN,
  type RelayOperation,
  type RelayResultWire,
  type WholesaleErrorCode,
} from '@tugeel/shared/mn';
import { businessInstant } from '@tugeel/shared/time';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { type Actor, AuditService } from '../../identity';
import { ebarimtReceipts } from '../schema';
import { EbarimtReceiptsService, type ReceiptRow } from './ebarimt-receipts.service';
import { ReceiptSecretsCache } from './receipt-secrets.cache';

/** The store edge that asks: its node id and code (pos owns the node; this module only names it). */
export interface RelayNode {
  id: number;
  code: string;
}

const t = ebarimtReceipts;
/** PosAPI was away: the receipt is offered again after a wait that grows with the attempts. */
const RETRY_BASE_MS = 30_000;
const RETRY_MAX_MS = 30 * 60_000;

/**
 * The centre's half of the wholesale relay (ADR-0185 #1, #5). The store edge cannot be called
 * (NAT), so it pulls: `claim` hands it one operation and moves the row to SENDING under a lock;
 * `result` records what PosAPI answered, idempotent by receipt and attempt. A row an edge holds is
 * handed to the same edge again (its answer to the claim was lost before it could store it — the
 * edge calls PosAPI only for an operation it has stored). Nothing here ever re-sends a receipt
 * that may exist: INDETERMINATE waits for a person. The lottery and QR data of a result go
 * straight to `ReceiptSecretsCache` and nowhere else.
 */
@Injectable()
export class EbarimtRelayService {
  private readonly logger = new Logger(EbarimtRelayService.name);
  private seen: { at: Date; nodeCode: string } | null = null;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly receipts: EbarimtReceiptsService,
    private readonly secrets: ReceiptSecretsCache,
  ) {}

  /** When an edge last asked for work (this process's memory), for the list's hint. */
  lastSeen(): { at: Date; nodeCode: string } | null {
    return this.seen;
  }

  /** One operation for the edge, or null when nothing is due. */
  async claim(node: RelayNode, actor: Actor): Promise<RelayOperation | null> {
    this.seen = { at: new Date(), nodeCode: node.code };
    return inTransaction(this.db, async (tx) => {
      await this.receipts.sweepInTx(tx);
      // What this edge already holds: its answer was lost, or it stopped before storing it.
      const [held] = await tx
        .select()
        .from(t)
        .where(and(eq(t.status, 'SENDING'), eq(t.claimedNodeId, node.id)))
        .orderBy(asc(t.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (held) return issueOperation(held);
      const [heldCancel] = await tx
        .select()
        .from(t)
        .where(and(eq(t.cancelStatus, 'SENDING'), eq(t.cancelNodeId, node.id)))
        .orderBy(asc(t.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (heldCancel) return cancelOperation(heldCancel);

      const [next] = await tx
        .select()
        .from(t)
        .where(
          and(
            eq(t.status, 'PENDING'),
            isNull(t.cancelStatus),
            or(isNull(t.nextAttemptAt), lte(t.nextAttemptAt, sql`now()`)),
          ),
        )
        .orderBy(asc(t.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (next) {
        const [claimed] = await tx
          .update(t)
          .set({
            status: 'SENDING',
            attempt: next.attempt + 1,
            claimedAt: sql`now()`,
            claimedNodeId: node.id,
            claimedNodeCode: node.code,
            nextAttemptAt: null,
            resolvedBy: null,
            resolvedAt: null,
            message: null,
            updatedAt: sql`now()`,
          })
          .where(eq(t.id, next.id))
          .returning();
        if (!claimed) throw new Error('claim update returned no row');
        await this.audit.record(tx, actor, {
          action: 'CLAIM',
          entity: 'ebarimt_receipts',
          entityId: claimed.id,
          after: { op: 'ISSUE', attempt: claimed.attempt, node: node.code },
        });
        return issueOperation(claimed);
      }

      const [cancel] = await tx
        .select()
        .from(t)
        .where(
          and(
            eq(t.status, 'CONFIRMED'),
            eq(t.cancelStatus, 'PENDING'),
            or(isNull(t.cancelNextAttemptAt), lte(t.cancelNextAttemptAt, sql`now()`)),
          ),
        )
        .orderBy(asc(t.id))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!cancel) return null;
      const [claimed] = await tx
        .update(t)
        .set({
          cancelStatus: 'SENDING',
          cancelAttempt: cancel.cancelAttempt + 1,
          cancelClaimedAt: sql`now()`,
          cancelNodeId: node.id,
          cancelNextAttemptAt: null,
          cancelMessage: null,
          updatedAt: sql`now()`,
        })
        .where(eq(t.id, cancel.id))
        .returning();
      if (!claimed) throw new Error('cancel claim update returned no row');
      await this.audit.record(tx, actor, {
        action: 'CLAIM',
        entity: 'ebarimt_receipts',
        entityId: claimed.id,
        after: { op: 'CANCEL', attempt: claimed.cancelAttempt, node: node.code },
      });
      return cancelOperation(claimed);
    });
  }

  /**
   * The edge's report of one operation. Applied once: a repeat, or a report of an older attempt,
   * is acknowledged and changes nothing. Answers whether it changed the row.
   */
  async result(node: RelayNode, actor: Actor, wire: RelayResultWire): Promise<boolean> {
    this.seen = { at: new Date(), nodeCode: node.code };
    // The secrets leave the wire here and go nowhere but the cache.
    const { lottery, qrData, ...facts } = wire;
    const applied = await inTransaction(this.db, async (tx) => {
      const [row] = await tx.select().from(t).where(eq(t.id, facts.receiptId)).for('update');
      if (!row) return false;
      return facts.op === 'ISSUE'
        ? this.issueResult(tx, actor, row, facts)
        : this.cancelResult(tx, actor, row, facts);
    });
    if (applied && facts.op === 'ISSUE' && facts.outcome === 'ISSUED') {
      this.secrets.put(facts.receiptId, { lottery: lottery ?? null, qrData: qrData ?? null });
    }
    if (applied && facts.op === 'CANCEL' && facts.outcome === 'CANCELLED') {
      this.secrets.forget(facts.receiptId);
    }
    return applied;
  }

  private async issueResult(
    tx: Tx,
    actor: Actor,
    row: ReceiptRow,
    wire: Omit<RelayResultWire, 'lottery' | 'qrData'>,
  ): Promise<boolean> {
    const same = wire.attempt === row.attempt;
    const before = { status: row.status, attempt: row.attempt };
    const message = wire.message?.slice(0, 300) ?? null;
    let outcome = wire.outcome;
    if (outcome === 'ISSUED') {
      // A SUCCESS the edge could not read an id or a date from: the receipt may exist.
      if (!DDTD_PATTERN.test(wire.ddtd ?? '') || !wire.posapiDate) outcome = 'INDETERMINATE';
    }
    if (outcome === 'ISSUED') {
      if (!same || row.status === 'CONFIRMED' || row.status === 'CANCELLED') {
        if (row.ddtd !== wire.ddtd) {
          // A receipt exists that the row does not name: a person must see it.
          this.logger.warn(
            { receiptId: row.id, attempt: wire.attempt },
            'an edge reports a receipt the centre does not expect',
          );
          await this.audit.record(tx, actor, {
            action: 'UNEXPECTED_RECEIPT',
            entity: 'ebarimt_receipts',
            entityId: row.id,
            before: { ...before, ddtd: row.ddtd },
            after: { attempt: wire.attempt, ddtd: wire.ddtd, posapiDate: wire.posapiDate },
          });
        }
        return false;
      }
      await tx
        .update(t)
        .set({
          status: 'CONFIRMED',
          ddtd: wire.ddtd,
          posapiDate: wire.posapiDate,
          issuedAt: POSAPI_DATE_PATTERN.test(wire.posapiDate ?? '')
            ? businessInstant(wire.posapiDate ?? '')
            : sql`now()`,
          merchantTin: wire.merchantTin,
          merchantName: wire.merchantName?.slice(0, 200) ?? null,
          errorCode: null,
          message: null,
          nextAttemptAt: null,
          updatedAt: sql`now()`,
        })
        .where(eq(t.id, row.id));
      await this.audit.record(tx, actor, {
        action: 'RESULT',
        entity: 'ebarimt_receipts',
        entityId: row.id,
        before,
        after: { status: 'CONFIRMED', ddtd: wire.ddtd, posapiDate: wire.posapiDate },
      });
      return true;
    }
    // Anything else only settles the claim it answers, before a person has decided on it.
    const open =
      row.status === 'SENDING' || (row.status === 'INDETERMINATE' && row.resolvedAt === null);
    if (!same || !open) return false;
    if (outcome === 'INDETERMINATE') {
      if (row.status === 'INDETERMINATE') return false;
      await tx
        .update(t)
        .set({ status: 'INDETERMINATE', message, updatedAt: sql`now()` })
        .where(eq(t.id, row.id));
    } else if (row.cancelStatus !== null) {
      // Its document was voided while the edge held it, and no receipt was made.
      await tx
        .update(t)
        .set({
          status: 'CANCELLED',
          cancelStatus: 'DONE',
          cancelledAt: sql`now()`,
          cancelMessage: 'never issued',
          message,
          updatedAt: sql`now()`,
        })
        .where(eq(t.id, row.id));
    } else if (outcome === 'REFUSED') {
      const errorCode: WholesaleErrorCode =
        wire.errorCode === 'EDGE_BUILD' ? 'EDGE_BUILD' : 'POSAPI_REFUSED';
      await tx
        .update(t)
        .set({ status: 'ERROR', errorCode, message, updatedAt: sql`now()` })
        .where(eq(t.id, row.id));
    } else if (outcome === 'NOT_SENT') {
      await tx
        .update(t)
        .set({
          status: 'PENDING',
          message,
          nextAttemptAt: new Date(Date.now() + backoff(row.attempt)),
          updatedAt: sql`now()`,
        })
        .where(eq(t.id, row.id));
    } else {
      return false;
    }
    await this.audit.record(tx, actor, {
      action: 'RESULT',
      entity: 'ebarimt_receipts',
      entityId: row.id,
      before,
      after: { outcome, message },
    });
    return true;
  }

  private async cancelResult(
    tx: Tx,
    actor: Actor,
    row: ReceiptRow,
    wire: Omit<RelayResultWire, 'lottery' | 'qrData'>,
  ): Promise<boolean> {
    const open =
      row.cancelStatus === 'SENDING' ||
      row.cancelStatus === 'INDETERMINATE' ||
      (wire.outcome === 'CANCELLED' &&
        (row.cancelStatus === 'PENDING' || row.cancelStatus === 'ERROR'));
    if (wire.attempt !== row.cancelAttempt || !open || row.status === 'CANCELLED') return false;
    const message = wire.message?.slice(0, 300) ?? null;
    switch (wire.outcome) {
      case 'CANCELLED':
        await tx
          .update(t)
          .set({
            status: 'CANCELLED',
            cancelStatus: 'DONE',
            cancelledAt: sql`now()`,
            cancelMessage: null,
            updatedAt: sql`now()`,
          })
          .where(eq(t.id, row.id));
        break;
      case 'REFUSED':
        await tx
          .update(t)
          .set({ cancelStatus: 'ERROR', cancelMessage: message, updatedAt: sql`now()` })
          .where(eq(t.id, row.id));
        break;
      case 'NOT_SENT':
        await tx
          .update(t)
          .set({
            cancelStatus: 'PENDING',
            cancelMessage: message,
            cancelNextAttemptAt: new Date(Date.now() + backoff(row.cancelAttempt)),
            updatedAt: sql`now()`,
          })
          .where(eq(t.id, row.id));
        break;
      case 'INDETERMINATE':
        if (row.cancelStatus === 'INDETERMINATE') return false;
        await tx
          .update(t)
          .set({ cancelStatus: 'INDETERMINATE', cancelMessage: message, updatedAt: sql`now()` })
          .where(eq(t.id, row.id));
        break;
      default:
        return false;
    }
    await this.audit.record(tx, actor, {
      action: 'CANCEL_RESULT',
      entity: 'ebarimt_receipts',
      entityId: row.id,
      before: { status: row.status, cancel: row.cancelStatus, attempt: row.cancelAttempt },
      after: { outcome: wire.outcome, message },
    });
    return true;
  }
}

function backoff(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(Math.max(attempt - 1, 0), 10));
}

function issueOperation(row: ReceiptRow): RelayOperation {
  return {
    op: 'ISSUE',
    receiptId: row.id,
    attempt: row.attempt,
    docNumber: row.docNumber,
    type: row.receiptType,
    customerTin: row.customerTin,
    consumerNo: row.consumerNo,
    lines: row.lines,
    payments: row.payments,
    total: row.total.toFixed(2),
  };
}

function cancelOperation(row: ReceiptRow): RelayOperation {
  if (!row.ddtd || !row.posapiDate) throw new Error(`receipt ${row.id} has no ДДТД to cancel`);
  return {
    op: 'CANCEL',
    receiptId: row.id,
    attempt: row.cancelAttempt,
    docNumber: row.docNumber,
    ddtd: row.ddtd,
    posapiDate: row.posapiDate,
  };
}
