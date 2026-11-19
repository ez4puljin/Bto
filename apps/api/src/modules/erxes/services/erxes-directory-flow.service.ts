import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, notInArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { type PipelineView, SalesAccessService, SalesBoardsService } from '../../sales';
import { ErxesError } from '../erxes.client';
import { BOARDS, type ErxesPerson, isBlockedBoard, readUser, textOf, USERS } from '../erxes-wire';
import { erxesPipelines, erxesUsers } from '../schema';
import { matchStaff, type StaffEntry } from './erxes-copy.service';
import { type ErxesCheck, ErxesSettingsFlowService } from './erxes-settings-flow.service';

type PipelineRow = typeof erxesPipelines.$inferSelect;
type UserRow = typeof erxesUsers.$inferSelect;

export interface ErxesPipelineView {
  id: number;
  erxesId: string;
  name: string;
  boardName: string | null;
  /** A board that is never copied. */
  blocked: boolean;
  /** erxes no longer lists it. */
  gone: boolean;
  enabled: boolean;
  enabledAt: Date | null;
  btoPipelineId: number | null;
  btoStageId: number | null;
  /** «Board · pipeline» and the stage in Bto; null when none is chosen or it is gone. */
  btoPipelineName: string | null;
  btoStageName: string | null;
  /** The chosen stage is live and takes new orders. */
  placeOk: boolean;
  lastPullAt: Date | null;
  lastSeenCreatedAt: Date | null;
}

export interface ErxesUserView {
  id: number;
  erxesId: string;
  email: string | null;
  fullName: string | null;
  /** The Bto user a person chose. */
  btoUserId: number | null;
  btoUserName: string | null;
  /** The Bto user the phone or the name finds, when nobody chose. */
  matchedUserId: number | null;
  matchedUserName: string | null;
}

export interface ErxesPipelineInput {
  enabled?: boolean;
  btoPipelineId?: number | null;
  btoStageId?: number | null;
}

/** A pipeline's name as two systems' names are compared: lower case, no spaces. */
const nameKey = (name: string): string => name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');

/** The first live stage of a pipeline that takes new orders. */
function landingStage(pipeline: PipelineView): number | null {
  const stage = pipeline.stages.find((entry) => !entry.archivedAt && entry.action === 'NONE');
  return stage?.id ?? null;
}

/**
 * erxes's pipelines and users beside Bto's (ADR-0218 #3, #5): «Шинэчлэх» reads them from erxes,
 * the owner ticks the pipelines to copy and picks where each lands, and names the Bto user of an
 * erxes user whose name does not say it. A flow service because the refresh calls erxes, between
 * transactions.
 */
@Injectable()
export class ErxesDirectoryFlowService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: ErxesSettingsFlowService,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly access: SalesAccessService,
    private readonly boards: SalesBoardsService,
  ) {}

  /**
   * Reads the boards, their pipelines and the users from erxes and brings our lists to them.
   * A new pipeline takes the Bto pipeline of the same name and its first stage; nothing is ticked
   * by a refresh, and no choice a person made is changed.
   */
  async refresh(ctx: AuthContext): Promise<ErxesCheck> {
    const opened = await this.settings.client();
    if (opened.client === null) {
      return { ok: false, reason: opened.failure, status: null, detail: null };
    }
    let boards: unknown;
    let users: unknown;
    try {
      boards = await opened.client.read(BOARDS);
      // The users are a help for the mapping, not a need: deals bring their own creators.
      users = await opened.client.read(USERS, { perPage: 500 }).catch((error: unknown) => {
        if (error instanceof ErxesError && error.reason === 'UNEXPECTED_ANSWER') return [];
        throw error;
      });
      opened.keep();
    } catch (error: unknown) {
      if (!(error instanceof ErxesError)) throw error;
      return this.failed(error.reason, error.message, error.status);
    }
    const listed: {
      erxesId: string;
      name: string;
      boardErxesId: string | null;
      boardName: string | null;
    }[] = [];
    for (const board of Array.isArray(boards) ? (boards as Record<string, unknown>[]) : []) {
      const boardName = textOf(board?.name);
      for (const pipeline of Array.isArray(board?.pipelines)
        ? (board.pipelines as Record<string, unknown>[])
        : []) {
        const erxesId = textOf(pipeline?._id);
        const name = textOf(pipeline?.name);
        if (erxesId && name) {
          listed.push({ erxesId, name, boardErxesId: textOf(board._id), boardName });
        }
      }
    }
    // An answer without a single pipeline is never taken as «erxes has none» (ADR-0220): the
    // erxes user sees no board, or erxes answered something else than boards.
    if (listed.length === 0) {
      return this.failed(
        'UNEXPECTED_ANSWER',
        `erxes listed no pipeline (${Array.isArray(boards) ? `${boards.length} boards` : 'no list'}): is the erxes user a member of the boards?`,
      );
    }
    const people = (Array.isArray(users) ? users : [])
      .map(readUser)
      .filter((user): user is ErxesPerson => user !== null);
    const bto = (await this.access.load(ctx)).pipelines.filter((pipeline) => !pipeline.archivedAt);
    await inTransaction(this.db, async (tx) => {
      for (const pipeline of listed) {
        const blocked = isBlockedBoard(pipeline.boardName);
        const twins = bto.filter((entry) => nameKey(entry.name) === nameKey(pipeline.name));
        const twin = twins.length === 1 ? twins[0] : undefined;
        const stageId = twin ? landingStage(twin) : null;
        const place =
          twin && stageId !== null ? { btoPipelineId: twin.id, btoStageId: stageId } : {};
        await tx
          .insert(erxesPipelines)
          .values({ ...pipeline, blocked, ...place })
          .onConflictDoUpdate({
            target: erxesPipelines.erxesId,
            set: {
              name: pipeline.name,
              boardErxesId: pipeline.boardErxesId,
              boardName: pipeline.boardName,
              blocked,
              gone: false,
              // A blocked board's pipeline is never left ticked.
              ...(blocked ? { enabled: false } : {}),
              updatedAt: sql`now()`,
            },
          });
      }
      const ids = listed.map((pipeline) => pipeline.erxesId);
      if (ids.length > 0) {
        await tx
          .update(erxesPipelines)
          .set({ gone: true, updatedAt: sql`now()` })
          .where(notInArray(erxesPipelines.erxesId, ids));
      }
      await this.rememberUsers(tx, people);
      await this.audit.record(tx, ctx, {
        action: 'REFRESH',
        entity: 'erxes_pipelines',
        entityId: 0,
        after: { pipelines: listed.length, users: people.length },
      });
    });
    return { ok: true, reason: null, status: null, detail: null };
  }

  /** A refresh that failed: written where the page shows the last failure, and answered. */
  private async failed(
    reason: ErxesError['reason'],
    detail: string,
    status?: number,
  ): Promise<ErxesCheck> {
    await this.settings.recordPull(reason, detail);
    return { ok: false, reason, status: status ?? null, detail: detail.slice(0, 500) };
  }

  /** Keeps what erxes says of its users; a person's choice of the Bto user stays. */
  async rememberUsers(tx: Db | Tx, people: readonly ErxesPerson[]): Promise<void> {
    for (const person of people) {
      await tx
        .insert(erxesUsers)
        .values(person)
        .onConflictDoUpdate({
          target: erxesUsers.erxesId,
          set: {
            // A deal's embedded user may say less than the users list: what is known stays.
            email: sql`coalesce(excluded.email, ${erxesUsers.email})`,
            username: sql`coalesce(excluded.username, ${erxesUsers.username})`,
            fullName: sql`coalesce(excluded.full_name, ${erxesUsers.fullName})`,
            phone: sql`coalesce(excluded.phone, ${erxesUsers.phone})`,
            updatedAt: sql`now()`,
          },
        });
    }
  }

  async pipelines(ctx: AuthContext): Promise<ErxesPipelineView[]> {
    const rows = await this.db
      .select()
      .from(erxesPipelines)
      .orderBy(asc(erxesPipelines.boardName), asc(erxesPipelines.name), asc(erxesPipelines.id));
    const access = await this.access.load(ctx);
    const boardNames = new Map(
      (await this.boards.tree(ctx, true)).map((board) => [board.id, board.name]),
    );
    return rows.map((row) => {
      const found = row.btoStageId === null ? undefined : access.stage(row.btoStageId);
      const fits = found !== undefined && found.pipeline.id === row.btoPipelineId;
      const board = fits ? boardNames.get(found.pipeline.boardId) : undefined;
      return {
        id: row.id,
        erxesId: row.erxesId,
        name: row.name,
        boardName: row.boardName,
        blocked: row.blocked,
        gone: row.gone,
        enabled: row.enabled,
        enabledAt: row.enabledAt,
        btoPipelineId: row.btoPipelineId,
        btoStageId: row.btoStageId,
        btoPipelineName: fits ? [board, found.pipeline.name].filter(Boolean).join(' · ') : null,
        btoStageName: fits ? found.stage.name : null,
        placeOk:
          fits &&
          found.pipeline.archivedAt === null &&
          found.stage.archivedAt === null &&
          found.stage.action === 'NONE',
        lastPullAt: row.lastPullAt,
        lastSeenCreatedAt: row.lastSeenCreatedAt,
      };
    });
  }

  /**
   * Ticks or unticks a pipeline and sets where its copies land. Ticking stamps the moment: only
   * deals created after it are copied (ADR-0218 #3). A ticked pipeline needs a live Bto stage that
   * takes new orders.
   */
  async updatePipeline(ctx: AuthContext, id: number, input: ErxesPipelineInput): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(erxesPipelines)
        .where(eq(erxesPipelines.id, id))
        .for('update');
      if (!before) throw notFound('erxes pipeline', id);
      const btoPipelineId =
        input.btoPipelineId === undefined ? before.btoPipelineId : input.btoPipelineId;
      let btoStageId = input.btoStageId === undefined ? before.btoStageId : input.btoStageId;
      const access = await this.access.load(ctx, tx);
      if (btoPipelineId === null) {
        btoStageId = null;
      } else {
        const pipeline = access.pipeline(btoPipelineId);
        if (!pipeline || pipeline.archivedAt) {
          throw invalid('btoPipelineId', 'live', 'a live pipeline of Bto');
        }
        // Another pipeline without a stage named: its first stage that takes new orders.
        if (input.btoPipelineId !== undefined && input.btoStageId === undefined) {
          btoStageId = landingStage(pipeline);
        }
        const stage = pipeline.stages.find((entry) => entry.id === btoStageId);
        if (!stage || stage.archivedAt || stage.action !== 'NONE') {
          throw invalid('btoStageId', 'noAction', 'a live stage of the pipeline without an action');
        }
      }
      const enabled = input.enabled ?? before.enabled;
      if (enabled && before.blocked) {
        throw invalid('enabled', 'blocked', 'this board is never copied');
      }
      if (enabled && btoStageId === null) {
        throw invalid('btoStageId', 'required', 'a ticked pipeline needs its Bto stage');
      }
      const ticked = enabled && !before.enabled;
      await tx
        .update(erxesPipelines)
        .set({
          enabled,
          btoPipelineId,
          btoStageId,
          ...(ticked
            ? {
                enabledAt: sql`now()`,
                enabledBy: ctx.userId,
                // The pull starts from the moment of the tick, not from where it once stopped.
                lastSeenCreatedAt: null,
              }
            : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(erxesPipelines.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'erxes_pipelines',
        entityId: id,
        before: placeFacts(before),
        after: { erxesId: before.erxesId, name: before.name, enabled, btoPipelineId, btoStageId },
      });
    });
  }

  async users(): Promise<ErxesUserView[]> {
    const rows = await this.db
      .select()
      .from(erxesUsers)
      .orderBy(asc(erxesUsers.fullName), asc(erxesUsers.id));
    const staff: StaffEntry[] = await this.names.allStaff();
    const nameOf = new Map(staff.map((entry) => [entry.id, entry.fullName]));
    return rows.map((row) => {
      const matched = row.btoUserId === null ? matchStaff(personOf(row), staff) : null;
      return {
        id: row.id,
        erxesId: row.erxesId,
        email: row.email,
        fullName: row.fullName ?? row.username,
        btoUserId: row.btoUserId,
        btoUserName: row.btoUserId === null ? null : (nameOf.get(row.btoUserId) ?? null),
        matchedUserId: matched,
        matchedUserName: matched === null ? null : (nameOf.get(matched) ?? null),
      };
    });
  }

  /** Names the Bto user of an erxes user; null goes back to matching by phone and name. */
  async mapUser(ctx: AuthContext, id: number, btoUserId: number | null): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(erxesUsers)
        .where(eq(erxesUsers.id, id))
        .for('update');
      if (!before) throw notFound('erxes user', id);
      if (btoUserId !== null && !(await this.names.namesOf([btoUserId], tx)).has(btoUserId)) {
        throw invalid('btoUserId', 'exists', 'a user of Bto');
      }
      await tx
        .update(erxesUsers)
        .set({
          btoUserId,
          mappedBy: btoUserId === null ? null : ctx.userId,
          mappedAt: btoUserId === null ? null : sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(erxesUsers.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'erxes_users',
        entityId: id,
        before: { erxesId: before.erxesId, btoUserId: before.btoUserId },
        after: { erxesId: before.erxesId, btoUserId },
      });
    });
  }

  /** The ticked pipelines a pull reads. */
  enabledPipelines(): Promise<PipelineRow[]> {
    return this.db
      .select()
      .from(erxesPipelines)
      .where(eq(erxesPipelines.enabled, true))
      .orderBy(asc(erxesPipelines.id));
  }
}

function personOf(row: UserRow): ErxesPerson {
  return {
    erxesId: row.erxesId,
    email: row.email,
    username: row.username,
    fullName: row.fullName,
    phone: row.phone,
  };
}

function placeFacts(row: PipelineRow) {
  return {
    erxesId: row.erxesId,
    name: row.name,
    enabled: row.enabled,
    btoPipelineId: row.btoPipelineId,
    btoStageId: row.btoStageId,
  };
}
