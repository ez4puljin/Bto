import { Inject, Injectable } from '@nestjs/common';
import type { SyncEventWire, SyncOutcomeWire } from '@tugeel/shared/pos';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { EDGE_DB, type EdgeDb, type EdgeTx } from '../db/edge-db';
import { edgeOutbox } from '../db/schema';

export interface PendingEvent {
  seq: number;
  payload: SyncEventWire;
}

/**
 * What the centre has still to hear (ADR-0063 #4): every document goes in with the change that
 * made it (one edge transaction), and leaves in the order it went in.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(EDGE_DB) private readonly db: EdgeDb) {}

  /** Inside the transaction that made the document; a repeat of the same document is ignored. */
  async enqueue(tx: EdgeTx, event: SyncEventWire): Promise<void> {
    await tx
      .insert(edgeOutbox)
      .values({ kind: event.kind, clientId: event.clientId, payload: event })
      .onConflictDoNothing({ target: [edgeOutbox.kind, edgeOutbox.clientId] });
  }

  async pending(limit: number): Promise<PendingEvent[]> {
    return this.db
      .select({ seq: edgeOutbox.seq, payload: edgeOutbox.payload })
      .from(edgeOutbox)
      .where(eq(edgeOutbox.status, 'PENDING'))
      .orderBy(asc(edgeOutbox.seq))
      .limit(limit);
  }

  /** The centre's answers, matched by kind and client id. */
  async settle(batch: readonly PendingEvent[], results: readonly SyncOutcomeWire[]): Promise<void> {
    const byKey = new Map(results.map((result) => [`${result.kind}:${result.clientId}`, result]));
    await this.db.transaction(async (tx) => {
      for (const event of batch) {
        const result = byKey.get(`${event.payload.kind}:${event.payload.clientId}`);
        if (!result) continue;
        await tx
          .update(edgeOutbox)
          .set(
            result.status === 'REJECTED'
              ? { status: 'REJECTED', code: result.code, attempts: sql`${edgeOutbox.attempts} + 1` }
              : { status: 'SENT', sentAt: new Date(), attempts: sql`${edgeOutbox.attempts} + 1` },
          )
          .where(eq(edgeOutbox.seq, event.seq));
      }
    });
  }

  /** A batch the centre did not take (offline, an error it asks to retry): counted, kept pending. */
  async failed(batch: readonly PendingEvent[], error: string): Promise<void> {
    if (batch.length === 0) return;
    const first = batch[0];
    const last = batch[batch.length - 1];
    if (!first || !last) return;
    await this.db
      .update(edgeOutbox)
      .set({ attempts: sql`${edgeOutbox.attempts} + 1`, lastError: error.slice(0, 500) })
      .where(
        and(
          eq(edgeOutbox.status, 'PENDING'),
          sql`${edgeOutbox.seq} BETWEEN ${first.seq} AND ${last.seq}`,
        ),
      );
  }

  async counts(): Promise<{ pending: number; rejected: number }> {
    const rows = await this.db
      .select({ status: edgeOutbox.status, n: count() })
      .from(edgeOutbox)
      .groupBy(edgeOutbox.status);
    const of = (status: string) => rows.find((row) => row.status === status)?.n ?? 0;
    return { pending: of('PENDING'), rejected: of('REJECTED') };
  }
}
