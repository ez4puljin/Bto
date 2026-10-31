import { Inject, Injectable } from '@nestjs/common';
import type {
  PipelineKind,
  CardSort,
  PipelineRight,
  PipelineVisibility,
  StageAction,
  StageRight,
} from '@tugeel/shared/sales';
import { asc, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import type { Actor, AuthContext } from '../../identity';
import {
  salesOrders,
  salesPipelineRoles,
  salesPipelines,
  salesStageRoles,
  salesStages,
} from '../schema';

/** Reads orders; a stage right with no roles listed falls back on it (VIEW). */
export const READ = 'sales.orders.read';
/** Writes orders; the fallback of EDIT and MOVE. */
export const WRITE = 'sales.orders.manage';
/** Configures boards and pipelines and sees everything. */
export const MANAGE = 'sales.boards.manage';

export interface StageView {
  id: number;
  pipelineId: number;
  name: string;
  position: number;
  action: StageAction;
  printPickList: boolean;
  printDeliveryNote: boolean;
  cardSort: CardSort;
  archivedAt: Date | null;
  roles: Record<StageRight, number[]>;
}

export interface PipelineView {
  id: number;
  boardId: number;
  name: string;
  position: number;
  visibility: PipelineVisibility;
  ownOrdersOnly: boolean;
  /** SALES or TRANSFER (ADR-0126 #1). */
  kind: PipelineKind;
  /** The STORE warehouse a TRANSFER stage fills (ADR-0125); null = none. */
  transferWarehouseId: number | null;
  archivedAt: Date | null;
  createdBy: number | null;
  createdAt: Date;
  roles: Record<PipelineRight, number[]>;
  /** By position, archived ones included. */
  stages: StageView[];
}

/** What the caller may do with a pipeline (ADR-0057 #2). */
export interface PipelineRights {
  view: boolean;
  /** Configure it (its stages, roles and settings) and see all of its orders. */
  manage: boolean;
  /** Every order of the pipeline, not only one's own. */
  seesAll: boolean;
}

/** What the caller may do with a stage (ADR-0056 #1). */
export interface StageRights {
  view: boolean;
  edit: boolean;
  move: boolean;
}

/** The order columns the visibility of one order depends on. */
export interface OrderPlace {
  pipelineId: number | null;
  stageId: number | null;
  createdBy: number | null;
}

/** A staff member's request context; plain actors (jobs, CLIs, tests) are trusted. */
export function isContext(actor: Actor | AuthContext): actor is AuthContext {
  return 'permissions' in actor;
}

function anyRole(roleIds: readonly number[], ctx: AuthContext): boolean {
  return roleIds.some((id) => ctx.roleIds.includes(id));
}

/** A right open to the roles listed, or, with none listed, to every holder of the permission. */
function allowed(roleIds: readonly number[], ctx: AuthContext, permission: string): boolean {
  if (roleIds.length === 0) return ctx.permissions.has(permission as never);
  return anyRole(roleIds, ctx);
}

/**
 * The caller's rights over every pipeline and stage at one moment, and the one predicate over
 * orders they give (ADR-0057 #2): an order without a pipeline is open to every reader; one in a
 * pipeline needs the stage's VIEW, and in an own-orders-only pipeline the caller must have
 * entered it unless they see all. A manager (or a trusted actor) is unrestricted.
 */
export class Access {
  private readonly byId: Map<number, PipelineView>;
  private readonly stageById: Map<number, { pipeline: PipelineView; stage: StageView }>;

  constructor(
    readonly ctx: AuthContext | null,
    readonly pipelines: readonly PipelineView[],
  ) {
    this.byId = new Map(pipelines.map((pipeline) => [pipeline.id, pipeline]));
    this.stageById = new Map(
      pipelines.flatMap((pipeline) =>
        pipeline.stages.map((stage) => [stage.id, { pipeline, stage }] as const),
      ),
    );
  }

  get unrestricted(): boolean {
    return this.ctx === null || this.ctx.permissions.has(MANAGE);
  }

  /**
   * The warehouses whose order lines the caller sees (ADR-0126 #3): every one (null), unless a
   * keeper without `sales.orders.manage` writes only some warehouses — then only those.
   */
  get lineWarehouses(): ReadonlySet<number> | null {
    const ctx = this.ctx;
    if (ctx === null || this.unrestricted || ctx.permissions.has('sales.orders.manage'))
      return null;
    return ctx.writableWarehouseIds;
  }

  pipeline(id: number): PipelineView | undefined {
    return this.byId.get(id);
  }

  stage(id: number): { pipeline: PipelineView; stage: StageView } | undefined {
    return this.stageById.get(id);
  }

  pipelineRights(pipeline: PipelineView): PipelineRights {
    const ctx = this.ctx;
    if (ctx === null || this.unrestricted) return { view: true, manage: true, seesAll: true };
    const manage = anyRole(pipeline.roles.MANAGE, ctx);
    const allOrders = anyRole(pipeline.roles.ALL_ORDERS, ctx);
    const view =
      manage ||
      allOrders ||
      (pipeline.visibility === 'PUBLIC'
        ? ctx.permissions.has(READ)
        : anyRole(pipeline.roles.VIEW, ctx));
    return { view, manage, seesAll: !pipeline.ownOrdersOnly || manage || allOrders };
  }

  stageRights(pipeline: PipelineView, stage: StageView): StageRights {
    const ctx = this.ctx;
    const rights = this.pipelineRights(pipeline);
    if (ctx === null || this.unrestricted || rights.manage) {
      return { view: true, edit: true, move: true };
    }
    if (!rights.view) return { view: false, edit: false, move: false };
    return {
      view: allowed(stage.roles.VIEW, ctx, READ),
      edit: allowed(stage.roles.EDIT, ctx, WRITE),
      move: allowed(stage.roles.MOVE, ctx, WRITE),
    };
  }

  /** Whether the caller sees an order sitting where `place` says. */
  canSee(place: OrderPlace): boolean {
    if (this.unrestricted) return true;
    if (place.pipelineId === null || place.stageId === null) return true;
    const found = this.stage(place.stageId);
    if (!found || found.pipeline.id !== place.pipelineId) return false;
    if (!this.stageRights(found.pipeline, found.stage).view) return false;
    return this.pipelineRights(found.pipeline).seesAll || place.createdBy === this.ctx?.userId;
  }

  /** The caller's EDIT right on an order's stage, or `sales.orders.manage` off any pipeline. */
  canEdit(place: OrderPlace): boolean {
    if (this.unrestricted) return true;
    if (place.stageId === null) return this.ctx?.permissions.has(WRITE) ?? false;
    const found = this.stage(place.stageId);
    return found ? this.stageRights(found.pipeline, found.stage).edit : false;
  }

  /** The same rule as `canSee`, as a condition on `sales_orders`. */
  visibleSql(): SQL {
    if (this.unrestricted) return sql`true`;
    const viewStages: number[] = [];
    const ownOnly: number[] = [];
    for (const pipeline of this.pipelines) {
      const rights = this.pipelineRights(pipeline);
      if (!rights.view) continue;
      if (!rights.seesAll) ownOnly.push(pipeline.id);
      for (const stage of pipeline.stages) {
        if (this.stageRights(pipeline, stage).view) viewStages.push(stage.id);
      }
    }
    const inStage = idIn(salesOrders.stageId, viewStages);
    const mine = sql`${salesOrders.createdBy} = ${this.ctx?.userId ?? 0}`;
    const own =
      ownOnly.length === 0
        ? sql`true`
        : sql`(NOT (${idIn(salesOrders.pipelineId, ownOnly)}) OR ${mine})`;
    return sql`(${salesOrders.pipelineId} IS NULL OR (${inStage} AND ${own}))`;
  }
}

/**
 * Loads pipelines with their stages and roles, and the caller's rights over them (ADR-0057 #2).
 * Every order read and action of the sales module asks this service.
 */
@Injectable()
export class SalesAccessService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The rights of `actor` over every pipeline (archived ones too, for orders sitting there). */
  async load(actor: Actor | AuthContext, executor: Db | Tx = this.db): Promise<Access> {
    const rows = await executor
      .select()
      .from(salesPipelines)
      .orderBy(asc(salesPipelines.position), asc(salesPipelines.id));
    return new Access(isContext(actor) ? actor : null, await this.views(rows, executor));
  }

  /** Pipelines as views: their roles and their stages with the stages' roles. */
  async views(
    rows: readonly (typeof salesPipelines.$inferSelect)[],
    executor: Db | Tx = this.db,
  ): Promise<PipelineView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const pipelineRoles = await executor
      .select()
      .from(salesPipelineRoles)
      .where(idIn(salesPipelineRoles.pipelineId, ids));
    const stages = await executor
      .select()
      .from(salesStages)
      .where(idIn(salesStages.pipelineId, ids))
      .orderBy(asc(salesStages.position), asc(salesStages.id));
    const stageRoles =
      stages.length === 0
        ? []
        : await executor
            .select()
            .from(salesStageRoles)
            .where(
              idIn(
                salesStageRoles.stageId,
                stages.map((stage) => stage.id),
              ),
            );
    return rows.map((row) => {
      const roles: Record<PipelineRight, number[]> = { VIEW: [], MANAGE: [], ALL_ORDERS: [] };
      for (const entry of pipelineRoles) {
        if (entry.pipelineId === row.id) roles[entry.right].push(entry.roleId);
      }
      return {
        id: row.id,
        boardId: row.boardId,
        name: row.name,
        position: row.position,
        visibility: row.visibility,
        ownOrdersOnly: row.ownOrdersOnly,
        kind: row.kind,
        transferWarehouseId: row.transferWarehouseId,
        archivedAt: row.archivedAt,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        roles,
        stages: stages
          .filter((stage) => stage.pipelineId === row.id)
          .map((stage) => {
            const own: Record<StageRight, number[]> = { VIEW: [], EDIT: [], MOVE: [] };
            for (const entry of stageRoles) {
              if (entry.stageId === stage.id) own[entry.right].push(entry.roleId);
            }
            return {
              id: stage.id,
              pipelineId: stage.pipelineId,
              name: stage.name,
              position: stage.position,
              action: stage.action,
              printPickList: stage.printPickList,
              printDeliveryNote: stage.printDeliveryNote,
              cardSort: stage.cardSort,
              archivedAt: stage.archivedAt,
              roles: own,
            };
          }),
      };
    });
  }
}
