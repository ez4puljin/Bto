import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  BOARD_LIMITS,
  type BoardRight,
  type Fulfilment,
  type OrderChannel,
  type OrderStatus,
  type PrintKind,
  type StageAction,
  type StageRight,
} from '@tugeel/shared/sales';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  type AuthContext,
  actorUserId,
  AuditService,
  OrgService,
  UserNamesService,
} from '../../identity';
import { CustomersService } from '../../partners';
import {
  salesBoardRoles,
  salesBoards,
  salesChannelDefaults,
  salesOrders,
  salesStageRoles,
  salesStages,
} from '../schema';

type BoardRow = typeof salesBoards.$inferSelect;
type StageRow = typeof salesStages.$inferSelect;

const MANAGE = 'sales.boards.manage';
const READ = 'sales.orders.read';
const WRITE = 'sales.orders.manage';
/** Cards shown per stage; older ones stay on the list. */
const CARDS_PER_STAGE = 200;

export interface StageView {
  id: number;
  boardId: number;
  name: string;
  position: number;
  action: StageAction;
  printPickList: boolean;
  printDeliveryNote: boolean;
  archivedAt: Date | null;
  roles: Record<StageRight, number[]>;
}

export interface BoardView {
  id: number;
  name: string;
  branchId: number | null;
  position: number;
  archivedAt: Date | null;
  roles: Record<BoardRight, number[]>;
  stages: StageView[];
  /** What the caller may do on this board. */
  canManage: boolean;
}

export interface ChannelDefault {
  channel: OrderChannel;
  boardId: number;
  stageId: number;
}

export interface StageInput {
  name: string;
  action: StageAction;
  printPickList: boolean;
  printDeliveryNote: boolean;
  roles: Record<StageRight, readonly number[]>;
}

/** A card of the board: an order as the column shows it. */
export interface OrderCard {
  id: number;
  number: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  customerId: number;
  customerCode: string;
  customerName: string;
  fulfilment: Fulfilment;
  deliveryDate: string;
  total: Decimal | null;
  lineCount: number;
  createdByName: string | null;
  stageEnteredAt: Date;
}

export interface StageCards {
  stageId: number;
  cards: OrderCard[];
  /** Cards in the stage, also those beyond the first page. */
  count: number;
  total: Decimal;
}

/** What the caller may do with a stage (ADR-0056 #1). */
export interface StageRights {
  view: boolean;
  edit: boolean;
  move: boolean;
}

/**
 * Boards and stages (ADR-0056): the owner's workflow per branch, rights by role on each board and
 * stage, where each channel's new orders land, and the cards of a board. Rights: ADMIN (or any
 * holder of `sales.boards.manage`) may everything; a board or stage without roles for a right is
 * open to everyone holding the sales permission that right needs.
 */
@Injectable()
export class SalesBoardsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly names: UserNamesService,
    private readonly customers: CustomersService,
  ) {}

  /** The boards the caller may see, live first, with their stages (archived ones for managers). */
  async list(ctx: AuthContext, withArchived = false): Promise<BoardView[]> {
    const boards = await this.db
      .select()
      .from(salesBoards)
      .where(withArchived && this.isManager(ctx) ? undefined : isNull(salesBoards.archivedAt))
      .orderBy(asc(salesBoards.position), asc(salesBoards.id));
    const views = (await this.views(boards, this.db)).map((board) => this.withRights(ctx, board));
    return views.filter((board) => this.canView(ctx, board));
  }

  async get(ctx: AuthContext, id: number, executor: Db | Tx = this.db): Promise<BoardView> {
    const [row] = await executor.select().from(salesBoards).where(eq(salesBoards.id, id));
    if (!row) throw notFound('board', id);
    const [found] = await this.views([row], executor);
    const view = found ? this.withRights(ctx, found) : undefined;
    if (!view || !this.canView(ctx, view)) throw notFound('board', id);
    return view;
  }

  async create(
    ctx: AuthContext,
    input: { name: string; branchId: number | null },
  ): Promise<BoardView> {
    this.assertManager(ctx);
    const name = checkedName(input.name);
    if (input.branchId !== null) await this.org.getBranch(input.branchId);
    const id = await inTransaction(this.db, async (tx) => {
      const [counted] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(salesBoards)
        .where(isNull(salesBoards.archivedAt));
      if (Number.parseInt(counted?.count ?? '0', 10) >= BOARD_LIMITS.maxBoards) {
        throw invalid('name', 'maxBoards', `at most ${BOARD_LIMITS.maxBoards} boards`);
      }
      const [last] = await tx
        .select({ next: sql<string>`coalesce(max(position), -1) + 1` })
        .from(salesBoards);
      const next = last?.next;
      const [row] = await tx
        .insert(salesBoards)
        .values({
          name,
          branchId: input.branchId,
          position: Number.parseInt(next ?? '0', 10),
          createdBy: actorUserId(ctx),
        })
        .returning({ id: salesBoards.id });
      if (!row) throw new Error('board insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'sales_boards',
        entityId: row.id,
        after: { name, branchId: input.branchId },
      });
      return row.id;
    });
    return this.get(ctx, id);
  }

  async update(
    ctx: AuthContext,
    id: number,
    input: { name: string; branchId: number | null },
  ): Promise<BoardView> {
    const name = checkedName(input.name);
    if (input.branchId !== null) await this.org.getBranch(input.branchId);
    await inTransaction(this.db, async (tx) => {
      const board = await this.lockBoard(ctx, tx, id);
      await tx
        .update(salesBoards)
        .set({ name, branchId: input.branchId, updatedAt: sql`now()` })
        .where(eq(salesBoards.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_boards',
        entityId: id,
        before: { name: board.name, branchId: board.branchId },
        after: { name, branchId: input.branchId },
      });
    });
    return this.get(ctx, id);
  }

  /** Archives a board; its channel defaults go, its orders keep their place for reading. */
  async archive(ctx: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const board = await this.lockBoard(ctx, tx, id);
      if (board.archivedAt) return;
      await tx
        .update(salesBoards)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(salesBoards.id, id));
      await tx.delete(salesChannelDefaults).where(eq(salesChannelDefaults.boardId, id));
      await this.audit.record(tx, ctx, { action: 'ARCHIVE', entity: 'sales_boards', entityId: id });
    });
  }

  async setBoardRoles(
    ctx: AuthContext,
    id: number,
    roles: Record<BoardRight, readonly number[]>,
  ): Promise<BoardView> {
    await inTransaction(this.db, async (tx) => {
      await this.lockBoard(ctx, tx, id);
      await tx.delete(salesBoardRoles).where(eq(salesBoardRoles.boardId, id));
      const rows = (['VIEW', 'MANAGE'] as const).flatMap((right) =>
        [...new Set(roles[right])].map((roleId) => ({ boardId: id, roleId, right })),
      );
      if (rows.length > 0) await insertRoles(() => tx.insert(salesBoardRoles).values(rows));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_boards',
        entityId: id,
        after: { roles },
      });
    });
    return this.get(ctx, id);
  }

  async addStage(ctx: AuthContext, boardId: number, input: StageInput): Promise<BoardView> {
    const name = checkedName(input.name);
    await inTransaction(this.db, async (tx) => {
      await this.lockBoard(ctx, tx, boardId);
      const [counted] = await tx
        .select({
          count: sql<string>`count(*) FILTER (WHERE archived_at IS NULL)`,
          next: sql<string>`coalesce(max(position), -1) + 1`,
        })
        .from(salesStages)
        .where(eq(salesStages.boardId, boardId));
      const next = counted?.next;
      if (Number.parseInt(counted?.count ?? '0', 10) >= BOARD_LIMITS.maxStages) {
        throw invalid('name', 'maxStages', `at most ${BOARD_LIMITS.maxStages} stages`);
      }
      const [row] = await tx
        .insert(salesStages)
        .values({
          boardId,
          name,
          position: Number.parseInt(next ?? '0', 10),
          action: input.action,
          printPickList: input.printPickList,
          printDeliveryNote: input.printDeliveryNote,
        })
        .returning({ id: salesStages.id });
      if (!row) throw new Error('stage insert returned no row');
      await this.writeStageRoles(tx, row.id, input.roles);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'sales_stages',
        entityId: row.id,
        after: { boardId, ...input, name },
      });
    });
    return this.get(ctx, boardId);
  }

  async updateStage(ctx: AuthContext, stageId: number, input: StageInput): Promise<BoardView> {
    const name = checkedName(input.name);
    const boardId = await inTransaction(this.db, async (tx) => {
      const stage = await this.stage(tx, stageId);
      await this.lockBoard(ctx, tx, stage.boardId);
      await tx
        .update(salesStages)
        .set({
          name,
          action: input.action,
          printPickList: input.printPickList,
          printDeliveryNote: input.printDeliveryNote,
          updatedAt: sql`now()`,
        })
        .where(eq(salesStages.id, stageId));
      await tx.delete(salesStageRoles).where(eq(salesStageRoles.stageId, stageId));
      await this.writeStageRoles(tx, stageId, input.roles);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_stages',
        entityId: stageId,
        before: {
          name: stage.name,
          action: stage.action,
          printPickList: stage.printPickList,
          printDeliveryNote: stage.printDeliveryNote,
        },
        after: { ...input, name },
      });
      return stage.boardId;
    });
    return this.get(ctx, boardId);
  }

  /** The new order of a board's live stages: every live stage once. */
  async reorderStages(
    ctx: AuthContext,
    boardId: number,
    stageIds: readonly number[],
  ): Promise<BoardView> {
    await inTransaction(this.db, async (tx) => {
      await this.lockBoard(ctx, tx, boardId);
      const live = await tx
        .select({ id: salesStages.id })
        .from(salesStages)
        .where(and(eq(salesStages.boardId, boardId), isNull(salesStages.archivedAt)));
      const wanted = [...new Set(stageIds)];
      const ids = new Set(live.map((row) => row.id));
      if (wanted.length !== ids.size || wanted.some((id) => !ids.has(id))) {
        throw invalid('stageIds', 'complete', 'every live stage of the board, once');
      }
      for (const [position, id] of wanted.entries()) {
        await tx
          .update(salesStages)
          .set({ position, updatedAt: sql`now()` })
          .where(eq(salesStages.id, id));
      }
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'sales_boards',
        entityId: boardId,
        after: { stageOrder: wanted },
      });
    });
    return this.get(ctx, boardId);
  }

  /** Archives a stage; refused while cards sit in it or a channel lands there. */
  async archiveStage(ctx: AuthContext, stageId: number): Promise<BoardView> {
    const boardId = await inTransaction(this.db, async (tx) => {
      const stage = await this.stage(tx, stageId);
      await this.lockBoard(ctx, tx, stage.boardId);
      if (stage.archivedAt) return stage.boardId;
      const [held] = await tx
        .select({ cards: sql<string>`count(*)` })
        .from(salesOrders)
        .where(eq(salesOrders.stageId, stageId));
      const cards = Number.parseInt(held?.cards ?? '0', 10);
      if (cards > 0) {
        throw new AppError('STAGE_IN_USE', 'move the cards out of the stage first', {
          count: cards,
        });
      }
      const [landing] = await tx
        .select({ channel: salesChannelDefaults.channel })
        .from(salesChannelDefaults)
        .where(eq(salesChannelDefaults.stageId, stageId));
      if (landing) {
        throw new AppError('STAGE_IN_USE', 'a channel lands its orders here', {
          channel: landing.channel,
        });
      }
      await tx
        .update(salesStages)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(salesStages.id, stageId));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'sales_stages',
        entityId: stageId,
      });
      return stage.boardId;
    });
    return this.get(ctx, boardId);
  }

  async defaults(executor: Db | Tx = this.db): Promise<ChannelDefault[]> {
    return executor
      .select({
        channel: salesChannelDefaults.channel,
        boardId: salesChannelDefaults.boardId,
        stageId: salesChannelDefaults.stageId,
      })
      .from(salesChannelDefaults)
      .orderBy(asc(salesChannelDefaults.channel));
  }

  /** Where a channel's new orders land; null clears it. */
  async setDefault(
    ctx: AuthContext,
    channel: OrderChannel,
    target: { boardId: number; stageId: number } | null,
  ): Promise<ChannelDefault[]> {
    this.assertManager(ctx);
    await inTransaction(this.db, async (tx) => {
      if (target === null) {
        await tx.delete(salesChannelDefaults).where(eq(salesChannelDefaults.channel, channel));
      } else {
        const stage = await this.stage(tx, target.stageId);
        if (stage.boardId !== target.boardId || stage.archivedAt) {
          throw invalid('stageId', 'ofBoard', 'a live stage of the board');
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
    return this.defaults();
  }

  /**
   * Where a new order of a channel goes (ADR-0056 #2): the chosen board's channel default, else
   * its first live stage; without a board, the channel default; null when nothing is configured.
   */
  async placementFor(
    ctx: AuthContext,
    channel: OrderChannel,
    boardId: number | null,
    executor: Db | Tx = this.db,
  ): Promise<{ boardId: number; stageId: number } | null> {
    const [fallback] = await executor
      .select({ boardId: salesChannelDefaults.boardId, stageId: salesChannelDefaults.stageId })
      .from(salesChannelDefaults)
      .where(eq(salesChannelDefaults.channel, channel));
    if (boardId === null) return fallback ?? null;
    const board = await this.get(ctx, boardId, executor);
    if (board.archivedAt) throw invalid('boardId', 'archived', 'the board is archived');
    if (fallback?.boardId === boardId) return fallback;
    const first = board.stages.find((stage) => stage.archivedAt === null);
    if (!first) throw invalid('boardId', 'noStages', 'the board has no stage');
    return { boardId, stageId: first.id };
  }

  /** The caller's rights on a stage (ADR-0056 #1); the stage with its board. */
  async stageRights(
    ctx: AuthContext,
    stageId: number,
    executor: Db | Tx = this.db,
  ): Promise<{ stage: StageView; board: BoardView; rights: StageRights }> {
    const [row] = await executor.select().from(salesStages).where(eq(salesStages.id, stageId));
    if (!row) throw notFound('stage', stageId);
    const board = await this.get(ctx, row.boardId, executor);
    const stage = board.stages.find((entry) => entry.id === stageId);
    if (!stage) throw notFound('stage', stageId);
    return { stage, board, rights: this.rightsOn(ctx, board, stage) };
  }

  /** The cards of a board's visible stages, newest first, with their counts and totals. */
  async cards(ctx: AuthContext, boardId: number): Promise<StageCards[]> {
    const board = await this.get(ctx, boardId);
    const stages = board.stages.filter(
      (stage) => stage.archivedAt === null && this.rightsOn(ctx, board, stage).view,
    );
    if (stages.length === 0) return [];
    const stageIds = stages.map((stage) => stage.id);
    const rows = await this.db
      .select({
        id: salesOrders.id,
        number: salesOrders.number,
        status: salesOrders.status,
        channel: salesOrders.channel,
        customerId: salesOrders.customerId,
        fulfilment: salesOrders.fulfilment,
        deliveryDate: salesOrders.deliveryDate,
        total: salesOrders.total,
        stageId: salesOrders.stageId,
        stageEnteredAt: salesOrders.stageEnteredAt,
        createdBy: salesOrders.createdBy,
        lineCount: sql<string>`(SELECT count(*) FROM sales_order_lines l WHERE l.order_id = sales_orders.id)`,
        rank: sql<string>`row_number() OVER (PARTITION BY sales_orders.stage_id ORDER BY sales_orders.id DESC)`,
      })
      .from(salesOrders)
      .where(idIn(salesOrders.stageId, stageIds))
      .orderBy(desc(salesOrders.id));
    const totals = await this.db
      .select({
        stageId: salesOrders.stageId,
        count: sql<string>`count(*)`,
        total: sql<string>`coalesce(sum(total), 0)`,
      })
      .from(salesOrders)
      .where(idIn(salesOrders.stageId, stageIds))
      .groupBy(salesOrders.stageId);
    const shown = rows.filter((row) => Number.parseInt(row.rank, 10) <= CARDS_PER_STAGE);
    const customers = new Map(
      (await this.customers.getMany(shown.map((row) => row.customerId))).map((c) => [c.id, c]),
    );
    const names = await this.names.namesOf(
      shown.flatMap((row) => (row.createdBy === null ? [] : [row.createdBy])),
    );
    return stages.map((stage) => {
      const sums = totals.find((entry) => entry.stageId === stage.id);
      return {
        stageId: stage.id,
        count: Number.parseInt(sums?.count ?? '0', 10),
        total: new Decimal(sums?.total ?? 0),
        cards: shown
          .filter((row) => row.stageId === stage.id)
          .map((row) => ({
            id: row.id,
            number: row.number,
            status: row.status,
            channel: row.channel,
            customerId: row.customerId,
            customerCode: customers.get(row.customerId)?.code ?? '',
            customerName: customers.get(row.customerId)?.name ?? '',
            fulfilment: row.fulfilment,
            deliveryDate: row.deliveryDate,
            total: row.total,
            lineCount: Number.parseInt(row.lineCount, 10),
            createdByName: row.createdBy === null ? null : (names.get(row.createdBy) ?? null),
            stageEnteredAt: row.stageEnteredAt ?? new Date(0),
          })),
      };
    });
  }

  /** The names of an order's board and stage, for its page. */
  async namesOf(
    boardId: number | null,
    stageId: number | null,
    executor: Db | Tx = this.db,
  ): Promise<{ boardName: string | null; stageName: string | null }> {
    if (boardId === null || stageId === null) return { boardName: null, stageName: null };
    const [board] = await executor
      .select({ name: salesBoards.name })
      .from(salesBoards)
      .where(eq(salesBoards.id, boardId));
    const [stage] = await executor
      .select({ name: salesStages.name })
      .from(salesStages)
      .where(eq(salesStages.id, stageId));
    return { boardName: board?.name ?? null, stageName: stage?.name ?? null };
  }

  /** The documents a stage prints when a card arrives. */
  printsOf(stage: StageView): PrintKind[] {
    return [
      ...(stage.printPickList ? (['PICK_LIST'] as const) : []),
      ...(stage.printDeliveryNote ? (['DELIVERY_NOTE'] as const) : []),
    ];
  }

  isManager(ctx: AuthContext): boolean {
    return ctx.permissions.has(MANAGE);
  }

  canView(ctx: AuthContext, board: BoardView): boolean {
    return this.isManager(ctx) || board.canManage || allowed(board.roles.VIEW, ctx, READ);
  }

  /** The board with `canManage` worked out for the caller (a MANAGE role, never a fallback). */
  private withRights(ctx: AuthContext, board: BoardView): BoardView {
    return {
      ...board,
      canManage: board.roles.MANAGE.some((roleId) => ctx.roleIds.includes(roleId)),
    };
  }

  rightsOn(ctx: AuthContext, board: BoardView, stage: StageView): StageRights {
    if (this.isManager(ctx) || board.canManage) return { view: true, edit: true, move: true };
    return {
      view: allowed(stage.roles.VIEW, ctx, READ),
      edit: allowed(stage.roles.EDIT, ctx, WRITE),
      move: allowed(stage.roles.MOVE, ctx, WRITE),
    };
  }

  // -------------------------------------------------------------------------------------------

  private assertManager(ctx: AuthContext): void {
    if (!this.isManager(ctx)) {
      throw new AppError('FORBIDDEN', 'configuring boards needs sales.boards.manage', {
        permission: MANAGE,
      });
    }
  }

  /** The board row FOR UPDATE, for someone who may manage it. */
  private async lockBoard(ctx: AuthContext, tx: Tx, id: number): Promise<BoardRow> {
    const [row] = await tx.select().from(salesBoards).where(eq(salesBoards.id, id)).for('update');
    if (!row) throw notFound('board', id);
    const [found] = await this.views([row], tx);
    const view = found ? this.withRights(ctx, found) : undefined;
    if (!view || !(this.isManager(ctx) || view.canManage)) {
      throw new AppError('FORBIDDEN', 'the board is managed by other roles', { boardId: id });
    }
    return row;
  }

  private async stage(executor: Db | Tx, id: number): Promise<StageRow> {
    const [row] = await executor.select().from(salesStages).where(eq(salesStages.id, id));
    if (!row) throw notFound('stage', id);
    return row;
  }

  private async writeStageRoles(
    tx: Tx,
    stageId: number,
    roles: Record<StageRight, readonly number[]>,
  ): Promise<void> {
    const rows = (['VIEW', 'EDIT', 'MOVE'] as const).flatMap((right) =>
      [...new Set(roles[right])].map((roleId) => ({ stageId, roleId, right })),
    );
    if (rows.length > 0) await insertRoles(() => tx.insert(salesStageRoles).values(rows));
  }

  private async views(rows: readonly BoardRow[], executor: Db | Tx): Promise<BoardView[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const boardRoles = await executor
      .select()
      .from(salesBoardRoles)
      .where(idIn(salesBoardRoles.boardId, ids));
    const stages = await executor
      .select()
      .from(salesStages)
      .where(idIn(salesStages.boardId, ids))
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
      const roles: Record<BoardRight, number[]> = { VIEW: [], MANAGE: [] };
      for (const entry of boardRoles) {
        if (entry.boardId === row.id) roles[entry.right].push(entry.roleId);
      }
      return {
        id: row.id,
        name: row.name,
        branchId: row.branchId,
        position: row.position,
        archivedAt: row.archivedAt,
        roles,
        canManage: false,
        stages: stages
          .filter((stage) => stage.boardId === row.id)
          .map((stage) => {
            const own: Record<StageRight, number[]> = { VIEW: [], EDIT: [], MOVE: [] };
            for (const entry of stageRoles) {
              if (entry.stageId === stage.id) own[entry.right].push(entry.roleId);
            }
            return {
              id: stage.id,
              boardId: stage.boardId,
              name: stage.name,
              position: stage.position,
              action: stage.action,
              printPickList: stage.printPickList,
              printDeliveryNote: stage.printDeliveryNote,
              archivedAt: stage.archivedAt,
              roles: own,
            };
          }),
      };
    });
  }
}

/** A right open to the roles listed, or, with none listed, to every holder of the permission. */
function allowed(roleIds: readonly number[], ctx: AuthContext, permission: string): boolean {
  if (roleIds.length === 0) return ctx.permissions.has(permission as never);
  return roleIds.some((id) => ctx.roleIds.includes(id));
}

function checkedName(value: string): string {
  const name = value.trim();
  if (name === '' || name.length > BOARD_LIMITS.maxName) {
    throw invalid('name', 'length', `1 to ${BOARD_LIMITS.maxName} characters`);
  }
  return name;
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
