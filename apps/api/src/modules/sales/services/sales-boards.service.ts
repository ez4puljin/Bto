import { Inject, Injectable } from '@nestjs/common';
import { BOARD_LIMITS, type PipelineVisibility } from '@tugeel/shared/sales';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import {
  type AuthContext,
  actorUserId,
  AuditService,
  OrgService,
  UserNamesService,
} from '../../identity';
import { salesBoards, salesPipelines } from '../schema';
import { MANAGE, SalesAccessService } from './sales-access.service';

/** A pipeline as the board tree lists it. */
export interface PipelineSummary {
  id: number;
  boardId: number;
  name: string;
  position: number;
  visibility: PipelineVisibility;
  ownOrdersOnly: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  /** The caller may configure it. */
  canManage: boolean;
}

/** A board with the pipelines the caller sees (ADR-0057 #1). */
export interface BoardNode {
  id: number;
  name: string;
  branchId: number | null;
  position: number;
  archivedAt: Date | null;
  pipelines: PipelineSummary[];
}

export function checkedName(value: string, field = 'name'): string {
  const name = value.trim();
  if (name === '' || name.length > BOARD_LIMITS.maxName) {
    throw invalid(field, 'length', `1 to ${BOARD_LIMITS.maxName} characters`);
  }
  return name;
}

export function assertManager(ctx: AuthContext): void {
  if (!ctx.permissions.has(MANAGE)) {
    throw new AppError('FORBIDDEN', 'configuring boards needs sales.boards.manage', {
      permission: MANAGE,
    });
  }
}

/**
 * Boards (ADR-0057 #1): groups of pipelines, such as a place or a branch. They carry no roles of
 * their own: a board shows when one of its pipelines does. Managers (`sales.boards.manage`)
 * create, rename and archive them.
 */
@Injectable()
export class SalesBoardsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly names: UserNamesService,
    private readonly access: SalesAccessService,
  ) {}

  /**
   * The boards with the pipelines the caller sees, by position. Managers also see boards without
   * pipelines, and with `withArchived` the archived boards and pipelines.
   */
  async tree(ctx: AuthContext, withArchived = false): Promise<BoardNode[]> {
    const access = await this.access.load(ctx);
    const manager = ctx.permissions.has(MANAGE);
    const archived = withArchived && manager;
    const boards = await this.db
      .select()
      .from(salesBoards)
      .where(archived ? undefined : isNull(salesBoards.archivedAt))
      .orderBy(asc(salesBoards.position), asc(salesBoards.id));
    const names = await this.names.namesOf(
      access.pipelines.flatMap((pipeline) =>
        pipeline.createdBy === null ? [] : [pipeline.createdBy],
      ),
    );
    return boards.flatMap((board) => {
      const pipelines = access.pipelines
        .filter(
          (pipeline) =>
            pipeline.boardId === board.id &&
            (archived || pipeline.archivedAt === null) &&
            access.pipelineRights(pipeline).view,
        )
        .map((pipeline) => ({
          id: pipeline.id,
          boardId: pipeline.boardId,
          name: pipeline.name,
          position: pipeline.position,
          visibility: pipeline.visibility,
          ownOrdersOnly: pipeline.ownOrdersOnly,
          archivedAt: pipeline.archivedAt,
          createdAt: pipeline.createdAt,
          createdByName:
            pipeline.createdBy === null ? null : (names.get(pipeline.createdBy) ?? null),
          canManage: access.pipelineRights(pipeline).manage,
        }));
      if (pipelines.length === 0 && !manager) return [];
      return [
        {
          id: board.id,
          name: board.name,
          branchId: board.branchId,
          position: board.position,
          archivedAt: board.archivedAt,
          pipelines,
        },
      ];
    });
  }

  async create(
    ctx: AuthContext,
    input: { name: string; branchId: number | null },
  ): Promise<number> {
    assertManager(ctx);
    const name = checkedName(input.name);
    if (input.branchId !== null) await this.org.getBranch(input.branchId);
    return inTransaction(this.db, async (tx) => {
      const [counted] = await tx
        .select({
          live: sql<string>`count(*) FILTER (WHERE archived_at IS NULL)`,
          next: sql<string>`coalesce(max(position), -1) + 1`,
        })
        .from(salesBoards);
      if (Number.parseInt(counted?.live ?? '0', 10) >= BOARD_LIMITS.maxBoards) {
        throw invalid('name', 'maxBoards', `at most ${BOARD_LIMITS.maxBoards} boards`);
      }
      const [row] = await tx
        .insert(salesBoards)
        .values({
          name,
          branchId: input.branchId,
          position: Number.parseInt(counted?.next ?? '0', 10),
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
  }

  async update(
    ctx: AuthContext,
    id: number,
    input: { name: string; branchId: number | null },
  ): Promise<void> {
    assertManager(ctx);
    const name = checkedName(input.name);
    if (input.branchId !== null) await this.org.getBranch(input.branchId);
    await inTransaction(this.db, async (tx) => {
      const [board] = await tx
        .select()
        .from(salesBoards)
        .where(eq(salesBoards.id, id))
        .for('update');
      if (!board) throw notFound('board', id);
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
  }

  /** Archives a board; refused while it holds a live pipeline (`BOARD_NOT_EMPTY`). */
  async archive(ctx: AuthContext, id: number): Promise<void> {
    assertManager(ctx);
    await inTransaction(this.db, async (tx) => {
      const [board] = await tx
        .select()
        .from(salesBoards)
        .where(eq(salesBoards.id, id))
        .for('update');
      if (!board) throw notFound('board', id);
      if (board.archivedAt) return;
      const live = await tx
        .select({ id: salesPipelines.id })
        .from(salesPipelines)
        .where(and(eq(salesPipelines.boardId, id), isNull(salesPipelines.archivedAt)))
        .for('share');
      if (live.length > 0) {
        throw new AppError('BOARD_NOT_EMPTY', 'archive the pipelines of the board first', {
          count: live.length,
        });
      }
      await tx
        .update(salesBoards)
        .set({ archivedAt: sql`now()`, updatedAt: sql`now()` })
        .where(eq(salesBoards.id, id));
      await this.audit.record(tx, ctx, { action: 'ARCHIVE', entity: 'sales_boards', entityId: id });
    });
  }

  async unarchive(ctx: AuthContext, id: number): Promise<void> {
    assertManager(ctx);
    await inTransaction(this.db, async (tx) => {
      const [board] = await tx
        .select()
        .from(salesBoards)
        .where(eq(salesBoards.id, id))
        .for('update');
      if (!board) throw notFound('board', id);
      if (!board.archivedAt) return;
      await tx
        .update(salesBoards)
        .set({ archivedAt: null, updatedAt: sql`now()` })
        .where(eq(salesBoards.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UNARCHIVE',
        entity: 'sales_boards',
        entityId: id,
      });
    });
  }
}
