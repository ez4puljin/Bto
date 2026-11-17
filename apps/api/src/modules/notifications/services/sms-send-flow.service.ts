import { Inject, Injectable, Logger } from '@nestjs/common';
import { isSmsErrorCode, smsSize } from '@tugeel/shared/notifications';
import { localMnPhone } from '@tugeel/shared/phone';
import { and, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { SmsError, SmsGateway, type SmsSent, type WesendClient } from '../../../integrations/sms';
import { smsBatches, smsMessages } from '../schema';
import { SmsSettingsFlowService } from './sms-settings-flow.service';

/** Attempts at one message WeSend answered «too many» (429), with the same key each time. */
const RATE_LIMIT_ATTEMPTS = 3;
/** The longest wait a `Retry-After` is honoured for, seconds. */
const RETRY_AFTER_MAX = 30;

/** Refusals about the account, not the message: the rest of the batch fails at once (ADR-0216). */
function stopsTheBatch(error: SmsError): boolean {
  if (error.status === 401 || error.status === 402) return true;
  return (
    error.status === 403 && ['sending_paused', 'forbidden', 'ip_not_allowed'].includes(error.code)
  );
}

/** A code the database and the screen know: WeSend's own when it is one, else `unknown_error`. */
const storedCode = (code: string): string => (isSmsErrorCode(code) ? code : 'unknown_error');

export interface SmsBatchOutcome {
  sent: number;
  failed: number;
  /** Why the batch stopped early, when it did. */
  stoppedCode: string | null;
}

/**
 * Sends one batch (ADR-0216), message by message, each call to WeSend between transactions. Safe
 * to run twice: a message that is no longer QUEUED is passed over, and every attempt at one message
 * carries its own stable `Idempotency-Key`, so WeSend answers a retried job with the first answer
 * instead of a second SMS. A timeout marks the message FAILED `timeout` and is never resent.
 */
@Injectable()
export class SmsSendFlowService {
  private readonly logger = new Logger(SmsSendFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: SmsSettingsFlowService,
    private readonly gateway: SmsGateway,
  ) {}

  async execute(batchId: number): Promise<SmsBatchOutcome> {
    const started = await inTransaction(this.db, async (tx) => {
      const [batch] = await tx
        .select({ status: smsBatches.status })
        .from(smsBatches)
        .where(eq(smsBatches.id, batchId))
        .for('update');
      if (!batch || batch.status === 'DONE') return false;
      await tx
        .update(smsBatches)
        .set({ status: 'SENDING', startedAt: sql`coalesce(${smsBatches.startedAt}, now())` })
        .where(eq(smsBatches.id, batchId));
      return true;
    });
    if (!started) return { sent: 0, failed: 0, stoppedCode: null };

    const key = await this.settings.savedKey();
    if (key.failure !== null) {
      await this.failRemaining(batchId, key.failure);
      return this.finish(batchId, key.failure);
    }
    const client = this.gateway.clientFor(key.apiKey);
    const queued = await this.db
      .select({ id: smsMessages.id })
      .from(smsMessages)
      .where(and(eq(smsMessages.batchId, batchId), eq(smsMessages.status, 'QUEUED')))
      .orderBy(smsMessages.id);
    let stoppedCode: string | null = null;
    for (const { id } of queued) {
      const [message] = await this.db
        .select()
        .from(smsMessages)
        .where(and(eq(smsMessages.id, id), eq(smsMessages.status, 'QUEUED')));
      if (!message?.phone) continue;
      try {
        const sent = await this.sendOne(client, {
          to: localMnPhone(message.phone),
          text: message.text,
          idempotencyKey: `bto-sms-${message.idempotencyKey}`,
        });
        await this.markSent(id, sent, smsSize(message.text).parts);
      } catch (error: unknown) {
        if (!(error instanceof SmsError)) throw error;
        await this.markFailed(id, storedCode(error.code));
        if (stopsTheBatch(error)) {
          stoppedCode = storedCode(error.code);
          this.logger.warn(`sms batch ${batchId} stopped: WeSend answered ${error.code}`);
          await this.failRemaining(batchId, stoppedCode);
          break;
        }
      }
    }
    return this.finish(batchId, stoppedCode);
  }

  /** One message; a 429 is waited out (its `Retry-After`) and tried again with the same key. */
  private async sendOne(
    client: WesendClient,
    request: { to: string; text: string; idempotencyKey: string },
  ): Promise<SmsSent> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await client.send(request);
      } catch (error: unknown) {
        if (!(error instanceof SmsError) || error.status !== 429) throw error;
        if (attempt >= RATE_LIMIT_ATTEMPTS) throw error;
        await this.wait(Math.min(RETRY_AFTER_MAX, Math.max(1, error.retryAfter ?? 1)) * 1000);
      }
    }
  }

  /** A pause between attempts; tests replace it. */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async markSent(id: number, sent: SmsSent, ownParts: number): Promise<void> {
    await this.db
      .update(smsMessages)
      .set({
        status: 'SENT',
        providerMessageId: sent.id,
        parts: sent.parts ?? ownParts,
        credits: sent.credits,
        errorCode: null,
        sentAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(smsMessages.id, id), eq(smsMessages.status, 'QUEUED')));
  }

  private async markFailed(id: number, code: string): Promise<void> {
    await this.db
      .update(smsMessages)
      .set({ status: 'FAILED', errorCode: code, updatedAt: sql`now()` })
      .where(and(eq(smsMessages.id, id), eq(smsMessages.status, 'QUEUED')));
  }

  private async failRemaining(batchId: number, code: string): Promise<void> {
    await this.db
      .update(smsMessages)
      .set({ status: 'FAILED', errorCode: code, updatedAt: sql`now()` })
      .where(and(eq(smsMessages.batchId, batchId), eq(smsMessages.status, 'QUEUED')));
  }

  /** The batch's counts from its messages, and DONE. */
  private async finish(batchId: number, stoppedCode: string | null): Promise<SmsBatchOutcome> {
    return inTransaction(this.db, async (tx) => {
      const [counts] = await tx
        .select({
          sent: sql<number>`count(*) FILTER (WHERE ${smsMessages.status} = 'SENT')::int`,
          failed: sql<number>`count(*) FILTER (WHERE ${smsMessages.status} = 'FAILED')::int`,
          skipped: sql<number>`count(*) FILTER (WHERE ${smsMessages.status} = 'SKIPPED')::int`,
          credits: sql<number>`coalesce(sum(${smsMessages.credits}), 0)::int`,
        })
        .from(smsMessages)
        .where(eq(smsMessages.batchId, batchId));
      const sent = counts?.sent ?? 0;
      const failed = counts?.failed ?? 0;
      await tx
        .update(smsBatches)
        .set({
          status: 'DONE',
          sentCount: sent,
          failedCount: failed,
          skippedCount: counts?.skipped ?? 0,
          creditsUsed: counts?.credits ?? 0,
          stoppedCode,
          finishedAt: sql`now()`,
        })
        .where(eq(smsBatches.id, batchId));
      return { sent, failed, stoppedCode };
    });
  }
}
