import { Inject, Injectable } from '@nestjs/common';
import {
  formatOrderNumber,
  ORDER_NUMBER_DEFAULTS,
  type OrderChannel,
  orderNumberPatternIssues,
  orderNumberPrefix,
} from '@tugeel/shared/sales';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, actorUserId, AuditService, NumberingService } from '../../identity';
import { salesChannelDefaults, salesPipelines, salesSettings, salesStages } from '../schema';
import { assertManager } from './sales-boards.service';

/** The counter every order number draws from, per rendered prefix (ADR-0057 #3). */
export const ORDER_NUMBER_SCOPE = 'SO_NO';

export interface NumberFormat {
  pattern: string;
  digits: number;
  updatedAt: Date | null;
  updatedBy: number | null;
}

export interface ChannelDefault {
  channel: OrderChannel;
  pipelineId: number;
  stageId: number;
}

/**
 * The sales settings (ADR-0057): the company's order number format and where each channel's new
 * orders land. Reading is open to every reader of orders; changes need `sales.boards.manage`.
 */
@Injectable()
export class SalesSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbers: NumberingService,
  ) {}

  /** The format in force: the settings row, else the shared defaults. */
  async numbering(executor: Db | Tx = this.db): Promise<NumberFormat> {
    const [row] = await executor.select().from(salesSettings).where(eq(salesSettings.id, 1));
    return row
      ? {
          pattern: row.numberPattern,
          digits: row.numberDigits,
          updatedAt: row.updatedAt,
          updatedBy: row.updatedBy,
        }
      : { ...ORDER_NUMBER_DEFAULTS, updatedAt: null, updatedBy: null };
  }

  async setNumbering(
    ctx: AuthContext,
    input: { pattern: string; digits: number },
  ): Promise<NumberFormat> {
    assertManager(ctx);
    const pattern = input.pattern.trim();
    const [issue] = orderNumberPatternIssues(pattern, input.digits);
    if (issue) throw invalid(issue.path, issue.code, `${issue.path}: ${issue.code}`);
    await inTransaction(this.db, async (tx) => {
      const before = await this.numbering(tx);
      await tx
        .insert(salesSettings)
        .values({
          id: 1,
          numberPattern: pattern,
          numberDigits: input.digits,
          updatedBy: actorUserId(ctx),
        })
        .onConflictDoUpdate({
          target: salesSettings.id,
          set: {
            numberPattern: pattern,
            numberDigits: input.digits,
            updatedBy: actorUserId(ctx),
            updatedAt: sql`now()`,
          },
        });
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_settings',
        entityId: 1,
        before: { pattern: before.pattern, digits: before.digits },
        after: { pattern, digits: input.digits },
      });
    });
    return this.numbering();
  }

  /**
   * The next order number, drawn last in the creating transaction: the pattern rendered with
   * today's Ulaanbaatar date is the prefix; one gap-free counter per prefix serves every pipeline.
   */
  async allocateNumber(tx: Tx): Promise<string> {
    const format = await this.numbering(tx);
    // The database's clock, as the order's created_at.
    const { rows } = await tx.execute<{ now: string | Date }>(sql`SELECT now() AS now`);
    const now = rows[0]?.now;
    const day = businessDate(now instanceof Date ? now : new Date(now ?? Date.now()));
    const prefix = orderNumberPrefix(format.pattern, day);
    const value = await this.numbers.next(tx, ORDER_NUMBER_SCOPE, prefix);
    return formatOrderNumber(prefix, format.digits, value);
  }

  async channels(executor: Db | Tx = this.db): Promise<ChannelDefault[]> {
    return executor
      .select({
        channel: salesChannelDefaults.channel,
        pipelineId: salesChannelDefaults.pipelineId,
        stageId: salesChannelDefaults.stageId,
      })
      .from(salesChannelDefaults)
      .orderBy(asc(salesChannelDefaults.channel));
  }

  /** Where a channel's new orders land: a live stage of a live pipeline; null clears it. */
  async setChannel(
    ctx: AuthContext,
    channel: OrderChannel,
    target: { pipelineId: number; stageId: number } | null,
  ): Promise<ChannelDefault[]> {
    assertManager(ctx);
    await inTransaction(this.db, async (tx) => {
      if (target === null) {
        await tx.delete(salesChannelDefaults).where(eq(salesChannelDefaults.channel, channel));
      } else {
        const [pipeline] = await tx
          .select({
            archivedAt: salesPipelines.archivedAt,
            ownOrdersOnly: salesPipelines.ownOrdersOnly,
            kind: salesPipelines.kind,
          })
          .from(salesPipelines)
          .where(eq(salesPipelines.id, target.pipelineId))
          .for('share');
        if (!pipeline || pipeline.archivedAt) {
          throw invalid('pipelineId', 'live', 'a live pipeline');
        }
        const [stage] = await tx
          .select({ archivedAt: salesStages.archivedAt, action: salesStages.action })
          .from(salesStages)
          .where(
            and(eq(salesStages.id, target.stageId), eq(salesStages.pipelineId, target.pipelineId)),
          )
          .for('share');
        if (!stage || stage.archivedAt) {
          throw invalid('stageId', 'ofPipeline', 'a live stage of the pipeline');
        }
        // The store's seller sends from the staff app into a transfer pipeline (ADR-0126 #1).
        if (channel === 'CUSTOMER_APP' && pipeline.kind !== 'SALES') {
          throw invalid('pipelineId', 'salesPipeline', 'a sales pipeline (ADR-0126 #1)');
        }
        // App orders wait for the office (ADR-0079 #5): a stage without an action, in a pipeline
        // where the office sees them (they have no author an own-orders-only pipeline could show).
        if (channel === 'CUSTOMER_APP' && (stage.action !== 'NONE' || pipeline.ownOrdersOnly)) {
          throw invalid('stageId', 'customerAppStage', 'a stage without an action, seen by all');
        }
        await tx
          .insert(salesChannelDefaults)
          .values({ channel, ...target, updatedBy: actorUserId(ctx) })
          .onConflictDoUpdate({
            target: salesChannelDefaults.channel,
            set: { ...target, updatedBy: actorUserId(ctx), updatedAt: sql`now()` },
          });
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_channel_defaults',
        entityId: channel,
        after: target ?? { cleared: true },
      });
    });
    return this.channels();
  }
}
