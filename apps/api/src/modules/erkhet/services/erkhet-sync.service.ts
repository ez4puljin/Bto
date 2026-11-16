import { Inject, Injectable } from '@nestjs/common';
import {
  ERKHET_LIMITS,
  type ErkhetFailure,
  type ErkhetResolution,
  type ErkhetRunStatus,
  type ErkhetSyncIssue,
  type ErkhetSyncKind,
} from '@tugeel/shared/erkhet';
import type { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import { and, desc, eq, gt, ilike, inArray, isNull, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { databaseErrorOf } from '../../../common/errors/problem-details';
import { JobsService } from '../../../common/jobs/jobs.service';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  invalidCursor,
  toPage,
} from '../../../common/pagination/page';
import { type Actor, actorUserId, UserNamesService } from '../../identity';
import {
  type ErkhetCustomerPlan,
  type ErkhetRunSummary,
  type ErkhetRunTrigger,
  erkhetSyncItems,
  erkhetSyncRuns,
} from '../schema';
import { ErkhetSettingsFlowService } from './erkhet-settings-flow.service';

type RunRow = typeof erkhetSyncRuns.$inferSelect;
type ItemRow = typeof erkhetSyncItems.$inferSelect;

export interface ErkhetRun {
  id: number;
  status: ErkhetRunStatus;
  trigger: ErkhetRunTrigger;
  startedBy: string | null;
  createdAt: Date;
  finishedAt: Date | null;
  failure: ErkhetFailure | null;
  summary: ErkhetRunSummary | null;
  /** Rows of this check that are still kept. */
  itemCount: number;
}

export interface ErkhetOverview {
  /** A complete sign-in is saved. */
  configured: boolean;
  nightly: boolean;
  /** The check waiting or running now. */
  active: ErkhetRun | null;
  /** The latest finished check: its rows are what the page lists. */
  latest: ErkhetRun | null;
  /** The latest check, when it failed after `latest`. */
  failed: ErkhetRun | null;
}

export interface ErkhetItem {
  id: number;
  kind: ErkhetSyncKind;
  issue: ErkhetSyncIssue;
  erkhetCode: string | null;
  erkhetName: string | null;
  erkhetGroup: string | null;
  erkhetBarcodes: string | null;
  erkhetPrice: Decimal | null;
  btoId: number | null;
  btoCode: string | null;
  btoName: string | null;
  btoPrice: Decimal | null;
  plan: ErkhetCustomerPlan | null;
  resolution: ErkhetResolution | null;
  resolvedAt: Date | null;
}

export interface ErkhetItemsQuery {
  kind: ErkhetSyncKind;
  issue?: ErkhetSyncIssue;
  q?: string;
  /** true: only rows «Bto-д тааруулах» has not looked at. */
  open?: boolean;
  cursor?: string;
  limit?: number;
}

const ACTIVE: ErkhetRunStatus[] = ['QUEUED', 'RUNNING'];

/**
 * The checks of Erkhet's lists against Bto's (ADR-0203): starting one, and reading what the latest
 * found. A check is a row and a job: the worker does the work (`ErkhetRunFlowService`), so the
 * request that starts it returns at once and the page asks again until it ends.
 */
@Injectable()
export class ErkhetSyncService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly jobs: JobsService,
    private readonly settings: ErkhetSettingsFlowService,
    private readonly names: UserNamesService,
  ) {}

  /**
   * Starts a check. Only one waits or runs at a time (`erkhet_sync_runs_one_active`); one that
   * outlived its time was interrupted and is closed first. 409 ERKHET_NOT_CONFIGURED without a
   * complete sign-in, 409 ERKHET_SYNC_RUNNING while another is under way.
   */
  async start(actor: Actor, trigger: ErkhetRunTrigger): Promise<ErkhetRun> {
    const saved = await this.settings.saved();
    if (saved.account === null) {
      throw new AppError('ERKHET_NOT_CONFIGURED', "Erkhet's sign-in is not saved", {
        reason: saved.failure,
      });
    }
    try {
      const row = await inTransaction(this.db, async (tx) => {
        await this.closeInterrupted(tx);
        const [created] = await tx
          .insert(erkhetSyncRuns)
          .values({
            trigger,
            businessDay: businessDate(),
            activeSlot: 1,
            startedBy: actorUserId(actor),
          })
          .returning();
        if (!created) throw new Error('run insert returned no row');
        await this.jobs.enqueue(
          tx,
          'erkhet.sync',
          { runId: created.id },
          { singletonKey: `erkhet-${created.id}` },
        );
        return created;
      });
      return (await this.views([row]))[0] as ErkhetRun;
    } catch (error: unknown) {
      const database = databaseErrorOf(error);
      if (database?.code === '23505' && database.constraint === 'erkhet_sync_runs_one_active') {
        throw new AppError('ERKHET_SYNC_RUNNING', 'a check is already under way');
      }
      throw error;
    }
  }

  /**
   * The night's check: once a day (`erkhet_sync_runs_nightly_day`), only with a complete sign-in
   * and the switch on. Says why it did not start instead of throwing: a schedule has nobody to tell.
   */
  async startNightly(actor: Actor): Promise<{ started: boolean; reason?: string; runId?: number }> {
    const saved = await this.settings.saved();
    if (saved.account === null) return { started: false, reason: saved.failure };
    if (!saved.nightly) return { started: false, reason: 'SWITCHED_OFF' };
    try {
      const run = await this.start(actor, 'NIGHTLY');
      return { started: true, runId: run.id };
    } catch (error: unknown) {
      if (error instanceof AppError && error.code === 'ERKHET_SYNC_RUNNING') {
        return { started: false, reason: error.code };
      }
      const database = databaseErrorOf(error);
      if (database?.code === '23505' && database.constraint === 'erkhet_sync_runs_nightly_day') {
        return { started: false, reason: 'ALREADY_TODAY' };
      }
      throw error;
    }
  }

  async overview(): Promise<ErkhetOverview> {
    const saved = await this.settings.saved();
    const [newest] = await this.db
      .select()
      .from(erkhetSyncRuns)
      .orderBy(desc(erkhetSyncRuns.id))
      .limit(1);
    const done = await this.latestDone();
    const rows = [newest, done].filter((row): row is RunRow => row !== undefined && row !== null);
    const views = new Map((await this.views(rows)).map((run) => [run.id, run]));
    const view = (row: RunRow | null | undefined) => (row ? (views.get(row.id) ?? null) : null);
    const stale = newest ? isInterrupted(newest) : false;
    return {
      configured: saved.account !== null,
      nightly: saved.nightly,
      active: newest && ACTIVE.includes(newest.status) && !stale ? view(newest) : null,
      latest: view(done),
      failed:
        newest && (newest.status === 'FAILED' || stale) && (!done || newest.id > done.id)
          ? {
              ...(view(newest) as ErkhetRun),
              ...(stale ? { status: 'FAILED' as const, failure: 'INTERRUPTED' as const } : {}),
            }
          : null,
    };
  }

  /** The latest finished check; its rows are the ones «Bto-д тааруулах» may act on. */
  async latestDone(executor: Db | Tx = this.db): Promise<RunRow | null> {
    const [row] = await executor
      .select()
      .from(erkhetSyncRuns)
      .where(eq(erkhetSyncRuns.status, 'DONE'))
      .orderBy(desc(erkhetSyncRuns.id))
      .limit(1);
    return row ?? null;
  }

  /** Rows of the latest finished check, by id. */
  async items(query: ErkhetItemsQuery): Promise<{ data: ErkhetItem[]; nextCursor: string | null }> {
    const run = await this.latestDone();
    if (!run) return { data: [], nextCursor: null };
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: (SQL | undefined)[] = [
      eq(erkhetSyncItems.runId, run.id),
      eq(erkhetSyncItems.kind, query.kind),
    ];
    if (query.issue) filters.push(eq(erkhetSyncItems.issue, query.issue));
    if (query.open) filters.push(isNull(erkhetSyncItems.resolution));
    const q = query.q?.trim();
    if (q) {
      const pattern = `%${escapeLike(q)}%`;
      filters.push(
        or(
          ilike(erkhetSyncItems.erkhetCode, pattern),
          ilike(erkhetSyncItems.erkhetName, pattern),
          ilike(erkhetSyncItems.erkhetBarcodes, pattern),
          ilike(erkhetSyncItems.btoCode, pattern),
          ilike(erkhetSyncItems.btoName, pattern),
        ),
      );
    }
    const cursor = decodeCursor(query.cursor);
    if (cursor) {
      if (typeof cursor.id !== 'number' || !Number.isSafeInteger(cursor.id)) throw invalidCursor();
      filters.push(gt(erkhetSyncItems.id, cursor.id));
    }
    const rows = await this.db
      .select()
      .from(erkhetSyncItems)
      .where(and(...filters))
      .orderBy(erkhetSyncItems.id)
      .limit(limit + 1);
    return toPage(rows.map(itemView), limit, (row) => ({ id: row.id }));
  }

  /** Rows by id, as stored (the apply service decides what to do with each). */
  async itemsByIds(ids: readonly number[], executor: Db | Tx = this.db): Promise<ItemRow[]> {
    if (ids.length === 0) return [];
    return executor
      .select()
      .from(erkhetSyncItems)
      .where(inArray(erkhetSyncItems.id, [...new Set(ids)]))
      .orderBy(erkhetSyncItems.id);
  }

  /** The open rows of one issue of a check, oldest first, at most what one apply takes. */
  async openItems(
    runId: number,
    kind: ErkhetSyncKind,
    issue: ErkhetSyncIssue,
    executor: Db | Tx = this.db,
  ): Promise<ItemRow[]> {
    return executor
      .select()
      .from(erkhetSyncItems)
      .where(
        and(
          eq(erkhetSyncItems.runId, runId),
          eq(erkhetSyncItems.kind, kind),
          eq(erkhetSyncItems.issue, issue),
          isNull(erkhetSyncItems.resolution),
        ),
      )
      .orderBy(erkhetSyncItems.id)
      .limit(ERKHET_LIMITS.maxApply);
  }

  /** Closes a check that waited or ran past its time: its worker died with it. */
  private async closeInterrupted(tx: Tx): Promise<void> {
    await tx
      .update(erkhetSyncRuns)
      .set({
        status: 'FAILED',
        failure: 'INTERRUPTED',
        activeSlot: null,
        finishedAt: sql`now()`,
      })
      .where(
        and(
          inArray(erkhetSyncRuns.status, ACTIVE),
          sql`${erkhetSyncRuns.createdAt} < now() - make_interval(mins => ${ERKHET_LIMITS.staleMinutes})`,
        ),
      );
  }

  private async views(rows: readonly RunRow[]): Promise<ErkhetRun[]> {
    const names = await this.names.namesOf(
      rows.map((row) => row.startedBy).filter((id): id is number => id !== null),
    );
    return rows.map((row) => ({
      id: row.id,
      status: row.status,
      trigger: row.trigger,
      startedBy: row.startedBy === null ? null : (names.get(row.startedBy) ?? null),
      createdAt: row.createdAt,
      finishedAt: row.finishedAt,
      failure: row.failure,
      summary: row.summary,
      itemCount: row.itemCount,
    }));
  }
}

function isInterrupted(row: RunRow): boolean {
  return (
    ACTIVE.includes(row.status) &&
    Date.now() - row.createdAt.getTime() > ERKHET_LIMITS.staleMinutes * 60_000
  );
}

export function itemView(row: ItemRow): ErkhetItem {
  return {
    id: row.id,
    kind: row.kind,
    issue: row.issue,
    erkhetCode: row.erkhetCode,
    erkhetName: row.erkhetName,
    erkhetGroup: row.erkhetGroup,
    erkhetBarcodes: row.erkhetBarcodes,
    erkhetPrice: row.erkhetPrice,
    btoId: row.btoId,
    btoCode: row.btoCode,
    btoName: row.btoName,
    btoPrice: row.btoPrice,
    plan: row.plan,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt,
  };
}
