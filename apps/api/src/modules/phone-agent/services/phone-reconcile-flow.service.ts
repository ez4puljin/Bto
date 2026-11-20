import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import {
  type ElevenLabsConversation,
  ElevenLabsError,
  ElevenLabsGateway,
} from '../../../integrations/elevenlabs';
import { PHONE_LIMITS, sameTurn } from '../phone-agent.rules';
import { phoneCallMessages, phoneCalls } from '../schema';
import { type MessageMeta, PhoneCallsService } from './phone-calls.service';

export type ReconcileResult =
  | { status: 'done'; added: number }
  | { status: 'skipped'; why: 'no_call' | 'not_ended' | 'no_conversation' | 'already' }
  | { status: 'unavailable'; code: string };

/** Thrown to let the queue try again: the provider has not finished the conversation yet. */
export class ConversationNotReady extends Error {
  constructor(readonly callId: number) {
    super(`conversation of call ${callId} is not ready`);
    this.name = 'ConversationNotReady';
  }
}

/**
 * Fills a finished call's transcript from the provider (ADR-0232 #3): the turns the bridge never
 * delivered are appended as RECONCILED messages; a stored turn is never changed (the table is
 * append-only). The provider is read between transactions; a call is reconciled once.
 */
@Injectable()
export class PhoneReconcileFlowService {
  private readonly logger = new Logger(PhoneReconcileFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly calls: PhoneCallsService,
    private readonly agent: ElevenLabsGateway,
  ) {}

  async reconcile(callId: number): Promise<ReconcileResult> {
    const [call] = await this.db.select().from(phoneCalls).where(eq(phoneCalls.id, callId));
    if (!call) return { status: 'skipped', why: 'no_call' };
    if (call.endedAt === null) return { status: 'skipped', why: 'not_ended' };
    if (call.reconciledAt !== null) return { status: 'skipped', why: 'already' };
    if (call.elConversationId === null) return { status: 'skipped', why: 'no_conversation' };
    if (!this.agent.configured) return { status: 'unavailable', code: 'NOT_CONFIGURED' };
    let conversation: ElevenLabsConversation;
    try {
      conversation = await this.agent.getConversation(call.elConversationId);
    } catch (error) {
      const code = error instanceof ElevenLabsError ? error.code : 'UNKNOWN';
      this.logger.warn({ callId, code }, 'phone reconcile: provider not read');
      // A conversation the provider does not know will not appear later.
      if (error instanceof ElevenLabsError && error.status === 404) {
        return { status: 'unavailable', code: 'NOT_FOUND' };
      }
      throw error;
    }
    if (conversation.status !== 'done' && conversation.status !== 'failed') {
      throw new ConversationNotReady(callId);
    }
    const added = await inTransaction(this.db, async (tx) => {
      const [locked] = await tx
        .select()
        .from(phoneCalls)
        .where(eq(phoneCalls.id, callId))
        .for('update');
      if (!locked || locked.reconciledAt !== null) return 0;
      const stored = (await this.calls.messages(callId, tx)).filter(
        (message) => message.role !== 'TOOL',
      );
      let cursor = 0;
      let nextSeq = (await this.calls.lastSeq(tx, callId)) + 1;
      const missing: (typeof phoneCallMessages.$inferInsert)[] = [];
      for (const [index, turn] of conversation.transcript.entries()) {
        const text = turn.message.trim();
        if (text.length === 0) continue;
        const role = turn.role === 'user' ? 'USER' : 'AGENT';
        // The bridge delivers in the provider's order, so a stored turn is looked for onwards only.
        const at = stored.findIndex(
          (message, position) =>
            position >= cursor && message.role === role && sameTurn(message.text, text),
        );
        if (at >= 0) {
          cursor = at + 1;
          continue;
        }
        if (nextSeq > PHONE_LIMITS.seqMax) break;
        missing.push({
          callId,
          seq: nextSeq,
          role,
          text: text.slice(0, PHONE_LIMITS.textMax),
          atMs: Math.min(Math.round(turn.timeInCallSecs * 1000), PHONE_LIMITS.atMsMax),
          meta: { source: 'RECONCILED', turn: index } satisfies MessageMeta,
        });
        nextSeq += 1;
      }
      if (missing.length > 0) await tx.insert(phoneCallMessages).values(missing);
      const duration =
        conversation.durationSecs === null
          ? null
          : Math.min(Math.max(Math.round(conversation.durationSecs), 0), PHONE_LIMITS.durationMax);
      await tx
        .update(phoneCalls)
        .set({
          reconciledAt: sql`now()`,
          durationS: locked.durationS ?? duration,
          costEstimate: conversation.cost === null ? null : conversation.cost.toFixed(4),
        })
        .where(eq(phoneCalls.id, callId));
      return missing.length;
    });
    this.logger.log({ callId, added }, 'phone call reconciled');
    return { status: 'done', added };
  }

  /** Closes the calls the bridge never ended; each gets its own reconcile job. */
  async sweep(): Promise<{ closed: number }> {
    const closed = await this.calls.closeAbandoned();
    if (closed > 0) this.logger.warn({ closed }, 'phone calls closed as abandoned');
    return { closed };
  }
}
