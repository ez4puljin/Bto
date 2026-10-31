import { Inject, Injectable } from '@nestjs/common';
import {
  BOARD_LIMITS,
  type CardSort,
  FINISHED_STATUSES,
  KIND_STAGE_ACTIONS,
  type OrderChannel,
  type PipelineKind,
  PIPELINE_RIGHTS,
  type PipelineRight,
  type PipelineVisibility,
  type PrintKind,
  type StageAction,
  STAGE_RIGHTS,
  type StageRight,
} from '@tugeel/shared/sales';
import { and, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import {
  type AuditEntry,
  type AuthContext,
  actorUserId,
  AuditService,
  OrgService,
} from '../../identity';
import {
  salesBoards,
  salesChannelDefaults,
  salesOrders,
  salesPipelineRoles,
  salesPipelines,
  salesStageRoles,
  salesStages,
} from '../schema';
import {
  type Access,
  type PipelineRights,
  type PipelineView,
  SalesAccessService,
  type StageRights,
  type StageView,
} from './sales-access.service';
import { assertManager, checkedName } from './sales-boards.service';

export interface StageInput {
  /** An existing live stage of the pipeline; absent for a new one. */
  id?: number | null;
  name: string;
  action: StageAction;
  printPickList: boolean;
  printDeliveryNote: boolean;
  roles: Record<StageRight, readonly number[]>;
  /** Only when copying: the source stage's card sort. */
  cardSort?: CardSort;
}

/** A pipeline saved whole (ADR-0057 #1): its settings and its stages in their order. */
export interface PipelineInput {
  boardId: number;
  name: string;
  visibility: PipelineVisibility;
  ownOrdersOnly: boolean;
  /** SALES or TRANSFER (ADR-0126 #1); the stage actions follow it. */
  kind: PipelineKind;
  /** The STORE warehouse a TRANSFER stage moves the picked goods into (ADR-0125). */
  transferWarehouseId: number | null;
  roles: Record<PipelineRight, readonly number[]>;
  stages: readonly StageInput[];
}

/** A pipeline with what the caller may do with it and with each stage. */
export interface PipelineDetail {
  pipeline: PipelineView;
  rights: PipelineRights;
  stages: { stage: StageView; rights: StageRights }[];
}

/** Where a new order lands. */
export interface Placement {
  pipelineId: number;
  stageId: number;
}

/** Statuses an order may still change from: such an order holds a stage or a pipeline. */
const unfinished = () => notInArray(salesOrders.status, [...FINISHED_STATUSES]);

/**
 * Pipelines and their stages (ADR-0056, ADR-0057): configuring them, where new orders land, the
 * stage a card moves into. Locks: creating and moving lock the pipeline and then the stage FOR
 * SHARE (after the order row); saving and archiving lock the pipeline FOR UPDATE, so an order
 * never lands in a stage being archived.
 */
@Injectable()
export class SalesPipelinesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly access: SalesAccessService,
    private readonly org: OrgService,
  ) {}

  /** A pipeline the caller sees, with the rights on it and on each stage; 404 otherwise. */
  async get(ctx: AuthContext, id: number, executor: Db | Tx = this.db): Promise<PipelineDetail> {
    const access = await this.access.load(ctx, executor);
    const pipeline = access.pipeline(id);
    if (!pipeline || !access.pipelineRights(pipeline).view) throw notFound('pipeline', id);
    return detailOf(access, pipeline);
  }

  /** A new pipeline with its stages (managers). */
  async create(ctx: AuthContext, input: PipelineInput): Promise<number> {
    assertManager(ctx);
    const name = checkedName(input.name);
    const stages = checkedStages(input.stages);
    return inTransaction(this.db, (tx) => this.insertPipeline(tx, ctx, input, name, stages));
  }

  private async insertPipeline(
    tx: Tx,
    ctx: AuthContext,
    input: PipelineInput,
    name: string,
    stages: readonly StageInput[],
  ): Promise<number> {
    {
      await this.liveBoard(tx, input.boardId);
      await this.checkTransferTarget(tx, input, stages);
      const [counted] = await tx
        .select({
          live: sql<string>`count(*) FILTER (WHERE archived_at IS NULL)`,
          next: sql<string>`coalesce(max(position) FILTER (WHERE board_id = ${input.boardId}), -1) + 1`,
        })
        .from(salesPipelines);
      if (Number.parseInt(counted?.live ?? '0', 10) >= BOARD_LIMITS.maxPipelines) {
        throw invalid('name', 'maxPipelines', `at most ${BOARD_LIMITS.maxPipelines} pipelines`);
      }
      const [row] = await tx
        .insert(salesPipelines)
        .values({
          boardId: input.boardId,
          name,
          position: Number.parseInt(counted?.next ?? '0', 10),
          visibility: input.visibility,
          ownOrdersOnly: input.ownOrdersOnly,
          kind: input.kind,
          transferWarehouseId: storeOf(input),
          createdBy: actorUserId(ctx),
        })
        .returning({ id: salesPipelines.id });
      if (!row) throw new Error('pipeline insert returned no row');
      await this.writePipelineRoles(tx, row.id, rolesFor(input));
      const created = await this.insertStages(tx, row.id, stages, 0);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'sales_pipelines',
        entityId: row.id,
        after: { ...summaryOf(input, name), stages: stages.map((stage) => stage.name) },
      });
      await this.audit.recordMany(
        tx,
        ctx,
        created.map((stageId, index) => ({
          action: 'CREATE',
          entity: 'sales_stages',
          entityId: stageId,
          after: { pipelineId: row.id, ...stageSummary(stages[index]) },
        })),
      );
      return row.id;
    }
  }

  /**
   * Saves a pipeline whole (a manager or a MANAGE role): settings, roles and the stages in their
   * new order — a stage without an id is new, a live stage left out is archived (refused while an
   * unfinished order sits there or a channel lands there).
   */
  async update(ctx: AuthContext, id: number, input: PipelineInput): Promise<void> {
    const name = checkedName(input.name);
    const stages = checkedStages(input.stages);
    await inTransaction(this.db, async (tx) => {
      const { pipeline } = await this.lockForManage(ctx, tx, id);
      if (input.boardId !== pipeline.boardId) await this.liveBoard(tx, input.boardId);
      const live = new Map(
        pipeline.stages
          .filter((stage) => stage.archivedAt === null)
          .map((stage) => [stage.id, stage]),
      );
      for (const [index, stage] of stages.entries()) {
        if (stage.id != null && !live.has(stage.id)) {
          throw invalid(`stages.${index}.id`, 'ofPipeline', 'a live stage of the pipeline');
        }
      }
      const kept = new Set(stages.flatMap((stage) => (stage.id == null ? [] : [stage.id])));
      const removed = [...live.values()].filter((stage) => !kept.has(stage.id));
      for (const stage of removed) await this.assertStageFree(tx, stage);
      await this.assertCustomerAppStage(tx, id, stages, input.ownOrdersOnly);
      await this.checkTransferTarget(tx, input, stages);
      if (input.kind === 'TRANSFER') await this.assertNoAppChannel(tx, id);

      await tx
        .update(salesPipelines)
        .set({
          boardId: input.boardId,
          name,
          visibility: input.visibility,
          ownOrdersOnly: input.ownOrdersOnly,
          kind: input.kind,
          transferWarehouseId: storeOf(input),
          updatedAt: sql`now()`,
        })
        .where(eq(salesPipelines.id, id));
      await tx.delete(salesPipelineRoles).where(eq(salesPipelineRoles.pipelineId, id));
      await this.writePipelineRoles(tx, id, rolesFor(input));

      const entries: AuditEntry[] = [];
      for (const stage of removed) {
        await tx
          .update(salesStages)
          .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
          .where(eq(salesStages.id, stage.id));
        entries.push({ action: 'ARCHIVE', entity: 'sales_stages', entityId: stage.id });
      }
      for (const [position, stage] of stages.entries()) {
        if (stage.id == null) continue;
        const before = live.get(stage.id);
        await tx
          .update(salesStages)
          .set({
            name: stage.name,
            position,
            action: stage.action,
            printPickList: stage.printPickList,
            printDeliveryNote: stage.printDeliveryNote,
            updatedAt: sql`now()`,
          })
          .where(eq(salesStages.id, stage.id));
        await tx.delete(salesStageRoles).where(eq(salesStageRoles.stageId, stage.id));
        await this.writeStageRoles(tx, stage.id, stage.roles);
        if (before && changed(before, stage, position)) {
          entries.push({
            action: 'UPDATE',
            entity: 'sales_stages',
            entityId: stage.id,
            before: { ...stageSummary(before), position: before.position },
            after: { ...stageSummary(stage), position },
          });
        }
      }
      for (const [position, stage] of stages.entries()) {
        if (stage.id != null) continue;
        const [created] = await this.insertStages(tx, id, [stage], position);
        if (created !== undefined) {
          entries.push({
            action: 'CREATE',
            entity: 'sales_stages',
            entityId: created,
            after: { pipelineId: id, ...stageSummary(stage), position },
          });
        }
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_pipelines',
        entityId: id,
        before: {
          boardId: pipeline.boardId,
          name: pipeline.name,
          visibility: pipeline.visibility,
          ownOrdersOnly: pipeline.ownOrdersOnly,
          kind: pipeline.kind,
          transferWarehouseId: pipeline.transferWarehouseId,
          roles: pipeline.roles,
        },
        after: { ...summaryOf(input, name), stages: stages.map((stage) => stage.name) },
      });
      if (entries.length > 0) await this.audit.recordMany(tx, ctx, entries);
    });
  }

  /**
   * A TRANSFER stage needs the pipeline's store (ADR-0125), and the store is a live STORE
   * warehouse; a pipeline without a TRANSFER stage may still name one (the stage comes later).
   */
  private async checkTransferTarget(
    tx: Tx,
    input: PipelineInput,
    stages: readonly StageInput[],
  ): Promise<void> {
    // The stage actions follow the pipeline's kind (ADR-0126 #1).
    const allowed = KIND_STAGE_ACTIONS[input.kind];
    const index = stages.findIndex((stage) => !allowed.includes(stage.action));
    const stray = stages[index];
    if (stray) {
      throw new AppError(
        'PIPELINE_KIND_STAGE',
        `stage ${stray.name} does ${stray.action}, not offered by a ${input.kind} pipeline`,
        { stage: stray.name, action: stray.action, kind: input.kind },
      );
    }
    const transferStage = stages.find((stage) => stage.action === 'TRANSFER');
    if (input.kind === 'SALES') return;
    if (input.transferWarehouseId === null) {
      throw new AppError(
        'PIPELINE_TRANSFER_STAGE_NEEDS_STORE',
        'a transfer pipeline names its store',
        { stage: transferStage?.name ?? input.name },
      );
    }
    const warehouse = await this.org.getWarehouse(input.transferWarehouseId, tx).catch(() => null);
    if (!warehouse || warehouse.kind !== 'STORE' || warehouse.status !== 'ACTIVE') {
      throw new AppError(
        'PIPELINE_TRANSFER_WAREHOUSE_INVALID',
        `warehouse ${input.transferWarehouseId} is not an active store`,
        { warehouse: warehouse?.name ?? null },
      );
    }
  }

  /**
   * The customer app lands only in SALES pipelines (ADR-0126 #1). A rep — the store's seller in the
   * staff app — may place on a transfer pipeline's stage: that is how the floor orders its goods
   * (owner, 2026-10-31).
   */
  private async assertNoAppChannel(tx: Tx, pipelineId: number): Promise<void> {
    const [landing] = await tx
      .select({ channel: salesChannelDefaults.channel })
      .from(salesChannelDefaults)
      .where(
        and(
          eq(salesChannelDefaults.pipelineId, pipelineId),
          eq(salesChannelDefaults.channel, 'CUSTOMER_APP'),
        ),
      );
    if (landing) {
      throw new AppError('PIPELINE_KIND_CHANNEL', `the ${landing.channel} channel lands here`, {
        channel: landing.channel,
      });
    }
  }

  /**
   * The CUSTOMER_APP channel lands only on a stage without an action, in a pipeline every reader
   * sees (ADR-0079 #5): a save may give that stage no action and may not make the pipeline
   * own-orders-only. The pipeline is locked FOR UPDATE by the save, so a send waits for it.
   */
  private async assertCustomerAppStage(
    tx: Tx,
    pipelineId: number,
    stages: readonly StageInput[],
    ownOrdersOnly: boolean,
  ): Promise<void> {
    const [landing] = await tx
      .select({ stageId: salesChannelDefaults.stageId })
      .from(salesChannelDefaults)
      .where(
        and(
          eq(salesChannelDefaults.channel, 'CUSTOMER_APP'),
          eq(salesChannelDefaults.pipelineId, pipelineId),
        ),
      );
    if (!landing) return;
    const index = stages.findIndex((stage) => stage.id === landing.stageId);
    const stage = stages[index];
    if (stage && stage.action !== 'NONE') {
      throw invalid(`stages.${index}.action`, 'customerAppStage', 'the app channel lands here');
    }
    if (ownOrdersOnly) {
      throw invalid('ownOrdersOnly', 'customerAppStage', 'the app channel lands in this pipeline');
    }
  }

  /** A copy of a pipeline's settings, roles and live stages (with their sorts) under a new name. */
  async copy(
    ctx: AuthContext,
    id: number,
    input: { name: string; boardId: number },
  ): Promise<number> {
    assertManager(ctx);
    const name = checkedName(input.name);
    return inTransaction(this.db, async (tx) => {
      const source = (await this.get(ctx, id, tx)).pipeline;
      const stages = checkedStages(
        source.stages
          .filter((stage) => stage.archivedAt === null)
          .map((stage) => ({
            name: stage.name,
            action: stage.action,
            printPickList: stage.printPickList,
            printDeliveryNote: stage.printDeliveryNote,
            roles: stage.roles,
            cardSort: stage.cardSort,
          })),
      );
      const copied = await this.insertPipeline(
        tx,
        ctx,
        {
          boardId: input.boardId,
          name,
          visibility: source.visibility,
          ownOrdersOnly: source.ownOrdersOnly,
          kind: source.kind,
          transferWarehouseId: source.transferWarehouseId,
          roles: source.roles,
          stages,
        },
        name,
        stages,
      );
      await this.audit.record(tx, ctx, {
        action: 'COPY',
        entity: 'sales_pipelines',
        entityId: copied,
        after: { from: id, name, boardId: input.boardId },
      });
      return copied;
    });
  }

  /**
   * Archives a pipeline (a manager or a MANAGE role); refused while an unfinished order sits in
   * it (`PIPELINE_IN_USE`). Its channel defaults go.
   */
  async archive(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const { pipeline } = await this.lockForManage(ctx, tx, id);
      if (pipeline.archivedAt) return;
      const [held] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(salesOrders)
        .where(and(eq(salesOrders.pipelineId, id), unfinished()));
      const count = Number.parseInt(held?.count ?? '0', 10);
      if (count > 0) {
        throw new AppError('PIPELINE_IN_USE', 'unfinished orders sit in the pipeline', { count });
      }
      await tx.delete(salesChannelDefaults).where(eq(salesChannelDefaults.pipelineId, id));
      await tx
        .update(salesPipelines)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(salesPipelines.id, id));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'sales_pipelines',
        entityId: id,
      });
    });
  }

  /** Takes a pipeline back; refused while its board is archived. */
  async unarchive(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const { pipeline } = await this.lockForManage(ctx, tx, id);
      if (!pipeline.archivedAt) return;
      await this.liveBoard(tx, pipeline.boardId);
      await tx
        .update(salesPipelines)
        .set({ archivedAt: null, updatedAt: sql`now()` })
        .where(eq(salesPipelines.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UNARCHIVE',
        entity: 'sales_pipelines',
        entityId: id,
      });
    });
  }

  /** Archives one stage from the board's menu; a pipeline keeps at least one live stage. */
  async archiveStage(ctx: AuthContext, stageId: number): Promise<number> {
    return inTransaction(this.db, async (tx) => {
      const pipelineId = await this.pipelineOf(tx, stageId);
      const { pipeline } = await this.lockForManage(ctx, tx, pipelineId);
      const stage = pipeline.stages.find((entry) => entry.id === stageId);
      if (!stage) throw notFound('stage', stageId);
      if (stage.archivedAt) return pipelineId;
      if (pipeline.stages.filter((entry) => entry.archivedAt === null).length <= 1) {
        throw invalid('stageId', 'lastStage', 'a pipeline keeps at least one stage');
      }
      await this.assertStageFree(tx, stage);
      await tx
        .update(salesStages)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(salesStages.id, stageId));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'sales_stages',
        entityId: stageId,
      });
      return pipelineId;
    });
  }

  /** How a stage orders its cards for everyone (ADR-0057 #6); the stage's EDIT right. */
  async setSort(ctx: AuthContext, stageId: number, sort: CardSort): Promise<number> {
    return inTransaction(this.db, async (tx) => {
      const { pipeline, stage, rights } = await this.stageFor(ctx, tx, stageId);
      if (!rights.edit) {
        throw new AppError('FORBIDDEN', 'the stage does not let this role edit it', { stageId });
      }
      if (stage.cardSort !== sort) {
        await tx
          .update(salesStages)
          .set({ cardSort: sort, updatedAt: sql`now()` })
          .where(eq(salesStages.id, stageId));
        await this.audit.record(tx, ctx, {
          action: 'SORT',
          entity: 'sales_stages',
          entityId: stageId,
          before: { sort: stage.cardSort },
          after: { sort },
        });
      }
      return pipeline.id;
    });
  }

  /**
   * Where a new order lands (ADR-0057 #4), the pipeline and the stage locked FOR SHARE: the
   * chosen pipeline (one the caller sees) or the channel's default; with `stageId` that stage,
   * which must be live, without an action and open to the caller's MOVE; else the channel's stage
   * on that pipeline, else its first live stage. Null when nothing is configured.
   */
  async placementFor(
    ctx: AuthContext,
    channel: OrderChannel,
    pipelineId: number | null,
    stageId: number | null,
    tx: Tx,
  ): Promise<Placement | null> {
    const [fallback] = await tx
      .select({
        pipelineId: salesChannelDefaults.pipelineId,
        stageId: salesChannelDefaults.stageId,
      })
      .from(salesChannelDefaults)
      .where(eq(salesChannelDefaults.channel, channel));
    if (pipelineId === null) {
      if (stageId !== null) throw invalid('pipelineId', 'required', 'the stage needs its pipeline');
      if (!fallback) return null;
      await this.lockShare(tx, fallback.pipelineId, fallback.stageId);
      return fallback;
    }
    const access = await this.access.load(ctx, tx);
    const pipeline = access.pipeline(pipelineId);
    if (!pipeline || !access.pipelineRights(pipeline).view) throw notFound('pipeline', pipelineId);
    if (pipeline.archivedAt) throw invalid('pipelineId', 'archived', 'the pipeline is archived');
    let target: StageView | undefined;
    if (stageId !== null) {
      target = pipeline.stages.find((stage) => stage.id === stageId && stage.archivedAt === null);
      if (!target) throw invalid('stageId', 'ofPipeline', 'a live stage of the pipeline');
      if (target.action !== 'NONE') {
        throw invalid('stageId', 'noAction', 'a new order lands only in a stage without an action');
      }
      if (!access.stageRights(pipeline, target).move) {
        throw new AppError('FORBIDDEN', 'the stage does not let this role move cards into it', {
          stageId,
        });
      }
    } else {
      target =
        (fallback?.pipelineId === pipelineId
          ? pipeline.stages.find((stage) => stage.id === fallback.stageId && !stage.archivedAt)
          : undefined) ?? pipeline.stages.find((stage) => stage.archivedAt === null);
      if (!target) throw invalid('pipelineId', 'noStages', 'the pipeline has no stage');
    }
    await this.lockShare(tx, pipelineId, target.id);
    return { pipelineId, stageId: target.id };
  }

  /**
   * The stage a card moves into, with its pipeline and the caller's rights; the pipeline and the
   * stage locked FOR SHARE so neither is archived meanwhile (call after locking the order).
   */
  async stageFor(
    ctx: AuthContext,
    tx: Tx,
    stageId: number,
  ): Promise<{ pipeline: PipelineView; stage: StageView; rights: StageRights; access: Access }> {
    const pipelineId = await this.pipelineOf(tx, stageId);
    await this.lockShare(tx, pipelineId, stageId);
    const access = await this.access.load(ctx, tx);
    const found = access.stage(stageId);
    if (!found || !access.pipelineRights(found.pipeline).view) throw notFound('stage', stageId);
    return { ...found, rights: access.stageRights(found.pipeline, found.stage), access };
  }

  /**
   * Locks a stage and its pipeline FOR SHARE and returns the pipeline (the rep app's placement,
   * ADR-0061 #6: its own rule decides, not the caller's stage rights).
   */
  async lockStage(tx: Tx, stageId: number): Promise<number> {
    const pipelineId = await this.pipelineOf(tx, stageId);
    await this.lockShare(tx, pipelineId, stageId);
    return pipelineId;
  }

  /**
   * Where an app order lands (ADR-0079 #5): the CUSTOMER_APP default, its pipeline and stage
   * locked FOR SHARE and read under that lock — live, a stage without an action, a pipeline that
   * is not own-orders-only. Anything else, or no default at all: 409 CUSTOMER_APP_CLOSED, and the
   * app does not send.
   */
  async customerAppPlacement(tx: Tx): Promise<Placement> {
    const [target] = await tx
      .select({
        pipelineId: salesChannelDefaults.pipelineId,
        stageId: salesChannelDefaults.stageId,
      })
      .from(salesChannelDefaults)
      .where(eq(salesChannelDefaults.channel, 'CUSTOMER_APP'));
    const closed = () => new AppError('CUSTOMER_APP_CLOSED', 'no stage takes app orders');
    if (!target) throw closed();
    const [pipeline] = await tx
      .select({
        archivedAt: salesPipelines.archivedAt,
        ownOrdersOnly: salesPipelines.ownOrdersOnly,
      })
      .from(salesPipelines)
      .where(eq(salesPipelines.id, target.pipelineId))
      .for('share');
    const [stage] = await tx
      .select({ archivedAt: salesStages.archivedAt, action: salesStages.action })
      .from(salesStages)
      .where(and(eq(salesStages.id, target.stageId), eq(salesStages.pipelineId, target.pipelineId)))
      .for('share');
    if (
      !pipeline ||
      pipeline.archivedAt ||
      pipeline.ownOrdersOnly ||
      !stage ||
      stage.archivedAt ||
      stage.action !== 'NONE'
    ) {
      throw closed();
    }
    return target;
  }

  /** Whether app orders are accepted now (the app's checkout and the admin's warning). */
  async customerAppOpen(executor: Db | Tx = this.db): Promise<boolean> {
    const [row] = await executor
      .select({ stageId: salesChannelDefaults.stageId })
      .from(salesChannelDefaults)
      .innerJoin(salesPipelines, eq(salesPipelines.id, salesChannelDefaults.pipelineId))
      .innerJoin(salesStages, eq(salesStages.id, salesChannelDefaults.stageId))
      .where(
        and(
          eq(salesChannelDefaults.channel, 'CUSTOMER_APP'),
          isNull(salesPipelines.archivedAt),
          eq(salesPipelines.ownOrdersOnly, false),
          isNull(salesStages.archivedAt),
          eq(salesStages.action, 'NONE'),
        ),
      );
    return row !== undefined;
  }

  /** The documents a stage prints when a card arrives. */
  printsOf(stage: StageView): PrintKind[] {
    return [
      ...(stage.printPickList ? (['PICK_LIST'] as const) : []),
      ...(stage.printDeliveryNote ? (['DELIVERY_NOTE'] as const) : []),
    ];
  }

  // -------------------------------------------------------------------------------------------

  private async lockShare(tx: Tx, pipelineId: number, stageId: number): Promise<void> {
    const [pipeline] = await tx
      .select({ archivedAt: salesPipelines.archivedAt })
      .from(salesPipelines)
      .where(eq(salesPipelines.id, pipelineId))
      .for('share');
    if (!pipeline) throw notFound('pipeline', pipelineId);
    if (pipeline.archivedAt) throw invalid('pipelineId', 'archived', 'the pipeline is archived');
    const [stage] = await tx
      .select({ archivedAt: salesStages.archivedAt })
      .from(salesStages)
      .where(and(eq(salesStages.id, stageId), eq(salesStages.pipelineId, pipelineId)))
      .for('share');
    if (!stage) throw notFound('stage', stageId);
    if (stage.archivedAt) throw invalid('stageId', 'archived', 'the stage is archived');
  }

  /** The pipeline FOR UPDATE for someone who may manage it (a manager or a MANAGE role). */
  private async lockForManage(
    ctx: AuthContext,
    tx: Tx,
    id: number,
  ): Promise<{ pipeline: PipelineView; access: Access }> {
    const [row] = await tx
      .select({ id: salesPipelines.id })
      .from(salesPipelines)
      .where(eq(salesPipelines.id, id))
      .for('update');
    if (!row) throw notFound('pipeline', id);
    const access = await this.access.load(ctx, tx);
    const pipeline = access.pipeline(id);
    if (!pipeline) throw notFound('pipeline', id);
    const rights = access.pipelineRights(pipeline);
    if (!rights.view) throw notFound('pipeline', id);
    if (!rights.manage) {
      throw new AppError('FORBIDDEN', 'the pipeline is managed by other roles', { pipelineId: id });
    }
    return { pipeline, access };
  }

  private async pipelineOf(executor: Db | Tx, stageId: number): Promise<number> {
    const [stage] = await executor
      .select({ pipelineId: salesStages.pipelineId })
      .from(salesStages)
      .where(eq(salesStages.id, stageId));
    if (!stage) throw notFound('stage', stageId);
    return stage.pipelineId;
  }

  private async liveBoard(tx: Tx, boardId: number): Promise<void> {
    const [board] = await tx
      .select({ archivedAt: salesBoards.archivedAt })
      .from(salesBoards)
      .where(eq(salesBoards.id, boardId))
      .for('share');
    if (!board) throw invalid('boardId', 'exists', 'a board');
    if (board.archivedAt) throw invalid('boardId', 'archived', 'the board is archived');
  }

  /** A stage may go when no unfinished order sits there and no channel lands there. */
  private async assertStageFree(tx: Tx, stage: StageView): Promise<void> {
    const [held] = await tx
      .select({ count: sql<string>`count(*)` })
      .from(salesOrders)
      .where(and(eq(salesOrders.stageId, stage.id), unfinished()));
    const count = Number.parseInt(held?.count ?? '0', 10);
    if (count > 0) {
      throw new AppError('STAGE_IN_USE', 'move the unfinished cards out of the stage first', {
        stageId: stage.id,
        name: stage.name,
        count,
      });
    }
    const [landing] = await tx
      .select({ channel: salesChannelDefaults.channel })
      .from(salesChannelDefaults)
      .where(eq(salesChannelDefaults.stageId, stage.id));
    if (landing) {
      throw new AppError('STAGE_IN_USE', 'a channel lands its orders here', {
        stageId: stage.id,
        name: stage.name,
        channel: landing.channel,
      });
    }
  }

  private async insertStages(
    tx: Tx,
    pipelineId: number,
    stages: readonly StageInput[],
    firstPosition: number,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (const [index, stage] of stages.entries()) {
      const [row] = await tx
        .insert(salesStages)
        .values({
          pipelineId,
          name: stage.name,
          position: firstPosition + index,
          action: stage.action,
          printPickList: stage.printPickList,
          printDeliveryNote: stage.printDeliveryNote,
          ...(stage.cardSort ? { cardSort: stage.cardSort } : {}),
        })
        .returning({ id: salesStages.id });
      if (!row) throw new Error('stage insert returned no row');
      await this.writeStageRoles(tx, row.id, stage.roles);
      ids.push(row.id);
    }
    return ids;
  }

  private async writePipelineRoles(
    tx: Tx,
    pipelineId: number,
    roles: Record<PipelineRight, readonly number[]>,
  ): Promise<void> {
    const rows = PIPELINE_RIGHTS.flatMap((right) =>
      [...new Set(roles[right])].map((roleId) => ({ pipelineId, roleId, right })),
    );
    if (rows.length > 0) await insertRoles(() => tx.insert(salesPipelineRoles).values(rows));
  }

  private async writeStageRoles(
    tx: Tx,
    stageId: number,
    roles: Record<StageRight, readonly number[]>,
  ): Promise<void> {
    const rows = STAGE_RIGHTS.flatMap((right) =>
      [...new Set(roles[right])].map((roleId) => ({ stageId, roleId, right })),
    );
    if (rows.length > 0) await insertRoles(() => tx.insert(salesStageRoles).values(rows));
  }
}

export function detailOf(access: Access, pipeline: PipelineView): PipelineDetail {
  return {
    pipeline,
    rights: access.pipelineRights(pipeline),
    stages: pipeline.stages.map((stage) => ({
      stage,
      rights: access.stageRights(pipeline, stage),
    })),
  };
}

/** The roles as saved: ALL_ORDERS only while the pipeline shows each user their own orders. */
function rolesFor(input: PipelineInput): Record<PipelineRight, readonly number[]> {
  return {
    VIEW: input.visibility === 'PRIVATE' ? input.roles.VIEW : [],
    MANAGE: input.roles.MANAGE,
    ALL_ORDERS: input.ownOrdersOnly ? input.roles.ALL_ORDERS : [],
  };
}

/** A SALES pipeline names no store (ADR-0126 #1). */
function storeOf(input: PipelineInput): number | null {
  return input.kind === 'TRANSFER' ? input.transferWarehouseId : null;
}

function checkedStages(stages: readonly StageInput[]): StageInput[] {
  if (stages.length === 0) throw invalid('stages', 'min', 'a pipeline needs a stage');
  if (stages.length > BOARD_LIMITS.maxStages) {
    throw invalid('stages', 'maxStages', `at most ${BOARD_LIMITS.maxStages} stages`);
  }
  const seen = new Set<number>();
  return stages.map((stage, index) => {
    if (stage.id != null) {
      if (seen.has(stage.id)) throw invalid(`stages.${index}.id`, 'unique', 'once');
      seen.add(stage.id);
    }
    return { ...stage, name: checkedName(stage.name, `stages.${index}.name`) };
  });
}

function summaryOf(input: PipelineInput, name: string) {
  return {
    boardId: input.boardId,
    name,
    visibility: input.visibility,
    ownOrdersOnly: input.ownOrdersOnly,
    kind: input.kind,
    transferWarehouseId: storeOf(input),
    roles: rolesFor(input),
  };
}

function stageSummary(stage: StageInput | StageView | undefined) {
  return {
    name: stage?.name,
    action: stage?.action,
    printPickList: stage?.printPickList,
    printDeliveryNote: stage?.printDeliveryNote,
    roles: stage?.roles,
  };
}

function sameRoles(
  a: Record<StageRight, readonly number[]>,
  b: Record<StageRight, readonly number[]>,
) {
  return STAGE_RIGHTS.every(
    (right) => [...new Set(a[right])].sort().join() === [...new Set(b[right])].sort().join(),
  );
}

function changed(before: StageView, after: StageInput, position: number): boolean {
  return (
    before.name !== after.name ||
    before.action !== after.action ||
    before.printPickList !== after.printPickList ||
    before.printDeliveryNote !== after.printDeliveryNote ||
    before.position !== position ||
    !sameRoles(before.roles, after.roles)
  );
}

/** A role that does not exist fails the foreign key: say so as a field error. */
async function insertRoles(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (databaseErrorOf(error)?.code === '23503') {
      throw invalid('roles', 'exists', 'a role does not exist');
    }
    throw error;
  }
}
