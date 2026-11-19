import { Inject, Injectable, Logger } from '@nestjs/common';
import { addDays, businessInstant, isIsoDate } from '@tugeel/shared/time';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { invalid } from '../../../common/errors/app-error';
import { AuditService, type AuthContext } from '../../identity';
import { type ErxesClient, ErxesError } from '../erxes.client';
import {
  dateOf,
  DEAL_RANGE,
  dealTotal,
  isBlockedBoard,
  personName,
  readDeal,
  textOf,
} from '../erxes-wire';
import {
  type ErxesDealStatus,
  erxesDeals,
  erxesPipelines,
  type ErxesPullFailure,
  erxesUsers,
  type ErxesWaitIssue,
} from '../schema';
import { ErxesCopyService } from './erxes-copy.service';
import { ErxesPullFlowService, FieldLabels } from './erxes-pull-flow.service';
import { ErxesSettingsFlowService } from './erxes-settings-flow.service';

type PipelineRow = typeof erxesPipelines.$inferSelect;

/** A range is whole Ulaanbaatar days, at most this many (ADR-0220). */
export const RANGE_MAX_DAYS = 31;
/** A range reads at most this many deals; more asks the person to narrow it. */
export const RANGE_MAX_DEALS = 1000;
/** Deals one copy request takes; the page sends the ticked ones in parts and shows the progress. */
export const RANGE_COPY_MAX = 50;
/** Deals of one `deals` page. */
const RANGE_PAGE = 100;

export interface ErxesRangeInput {
  /** The first day, `YYYY-MM-DD` in Ulaanbaatar. */
  from: string;
  /** The last day, `YYYY-MM-DD` in Ulaanbaatar, whole. */
  to: string;
  /** erxes_pipelines.id of the pipelines to read. */
  pipelineIds: number[];
}

export interface ErxesRangeCopyInput extends ErxesRangeInput {
  deals: { erxesId: string; pipelineId: number }[];
}

/** A pipeline a range may read: not blocked, still in erxes, and with its Bto place chosen. */
export interface ErxesRangePipeline {
  id: number;
  erxesId: string;
  name: string;
  boardName: string | null;
  /** Ticked for the minute pull: chosen by default. */
  enabled: boolean;
}

/** A deal of the range as erxes lists it, and what Bto already holds of it. */
export interface ErxesRangeDeal {
  erxesId: string;
  pipelineId: number;
  pipelineName: string;
  number: string | null;
  name: string | null;
  createdAt: Date | null;
  creatorName: string | null;
  stageName: string | null;
  customerName: string | null;
  /** Lines of the deal; null when erxes did not list them. */
  lines: number | null;
  total: string | null;
  /** The deal's row in Bto: copied, waiting or set aside; null when Bto has not seen it. */
  known: { id: number; status: ErxesDealStatus; orderId: number | null } | null;
}

export interface ErxesRangePreview {
  ok: boolean;
  failure: ErxesPullFailure | null;
  detail: string | null;
  /** More than RANGE_MAX_DEALS deals: the first ones read are listed, the range is to be narrowed. */
  tooMany: boolean;
  deals: ErxesRangeDeal[];
}

export const RANGE_OUTCOMES = ['COPIED', 'WAITING', 'SKIPPED', 'FAILED'] as const;
export type ErxesRangeOutcome = (typeof RANGE_OUTCOMES)[number];
/**
 * Why a deal was skipped: Bto holds it already, erxes says it is of another pipeline or created
 * outside the range.
 */
export const RANGE_SKIPS = ['KNOWN', 'OTHER_PIPELINE', 'OUT_OF_RANGE'] as const;
export type ErxesRangeSkip = (typeof RANGE_SKIPS)[number];

export interface ErxesRangeResult {
  erxesId: string;
  outcome: ErxesRangeOutcome;
  /** The deal's row in Bto, when there is one. */
  dealId: number | null;
  orderId: number | null;
  /** WAITING: why. */
  issues: ErxesWaitIssue[];
  skip: ErxesRangeSkip | null;
  /** FAILED: what went wrong, in English. */
  failure: ErxesPullFailure | null;
  detail: string | null;
}

export interface ErxesRangeCopy {
  /** erxes answered every deal it was asked for. */
  ok: boolean;
  failure: ErxesPullFailure | null;
  detail: string | null;
  copied: number;
  waiting: number;
  skipped: number;
  failed: number;
  results: ErxesRangeResult[];
}

/** The first and the last instant of a range of whole Ulaanbaatar days, checked. */
export function rangeOf(from: string, to: string): { start: Date; end: Date } {
  if (!isIsoDate(from)) throw invalid('from', 'date', 'a date YYYY-MM-DD');
  if (!isIsoDate(to)) throw invalid('to', 'date', 'a date YYYY-MM-DD');
  if (to < from) throw invalid('to', 'afterFrom', 'the last day is not before the first');
  if (addDays(from, RANGE_MAX_DAYS - 1) < to) {
    throw invalid('to', 'maxDays', `at most ${RANGE_MAX_DAYS} days`);
  }
  const start = businessInstant(`${from} 00:00:00`);
  const end = new Date(businessInstant(`${addDays(to, 1)} 00:00:00`).getTime() - 1);
  return { start, end };
}

const failureOf = (error: unknown): { failure: ErxesPullFailure; detail: string } =>
  error instanceof ErxesError
    ? { failure: error.reason, detail: error.message.slice(0, 500) }
    : {
        failure: 'INTERNAL',
        detail: (error instanceof Error ? error.message : 'unknown error').slice(0, 500),
      };

/**
 * The range copy (ADR-0220): the deals of chosen erxes pipelines created within whole days a
 * person picks, listed with what Bto already holds of each, and the ticked ones copied by exactly
 * the rules of the minute pull (`ErxesPullFlowService.fetchDeal`/`storeDeal`, then
 * `ErxesCopyService.tryCopy`). A flow service: erxes is called between transactions, and each
 * deal is copied in its own transaction, so one deal that fails stops none of the others. A deal
 * is still one row and one order (`erxes_deals.erxes_id` unique), whoever reads it.
 */
@Injectable()
export class ErxesRangeFlowService {
  private readonly logger = new Logger(ErxesRangeFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: ErxesSettingsFlowService,
    private readonly puller: ErxesPullFlowService,
    private readonly copier: ErxesCopyService,
    private readonly audit: AuditService,
  ) {}

  /** The pipelines a range may read: any that is not blocked and has its Bto place chosen. */
  async pipelines(): Promise<ErxesRangePipeline[]> {
    const rows = await this.usable();
    return rows.map((row) => ({
      id: row.id,
      erxesId: row.erxesId,
      name: row.name,
      boardName: row.boardName,
      enabled: row.enabled,
    }));
  }

  /** «Харах»: the range's deals, newest first, each with its row in Bto when there is one. */
  async preview(input: ErxesRangeInput): Promise<ErxesRangePreview> {
    const { start, end } = rangeOf(input.from, input.to);
    const chosen = await this.chosen(input.pipelineIds);
    const opened = await this.settings.client();
    if (opened.client === null) {
      return { ok: false, failure: opened.failure, detail: null, tooMany: false, deals: [] };
    }
    const listed: { row: Record<string, unknown>; pipeline: PipelineRow }[] = [];
    let tooMany = false;
    try {
      const seen = new Set<string>();
      for (const pipeline of chosen) {
        if (tooMany) break;
        tooMany = await this.readRange(opened.client, pipeline, start, end, (row) => {
          const erxesId = textOf(row._id);
          if (erxesId === null || seen.has(erxesId)) return 'old';
          seen.add(erxesId);
          if (listed.length >= RANGE_MAX_DEALS) return 'full';
          listed.push({ row, pipeline });
          return 'new';
        });
      }
      opened.keep();
    } catch (error: unknown) {
      opened.keep();
      const failed = failureOf(error);
      if (!(error instanceof ErxesError)) throw error;
      await this.settings.recordPull(failed.failure, failed.detail);
      return { ok: false, ...failed, tooMany: false, deals: [] };
    }

    const ids = listed.flatMap(({ row }) => textOf(row._id) ?? []);
    const known = new Map(
      (ids.length === 0
        ? []
        : await this.db
            .select({
              id: erxesDeals.id,
              erxesId: erxesDeals.erxesId,
              status: erxesDeals.status,
              orderId: erxesDeals.orderId,
            })
            .from(erxesDeals)
            .where(inArray(erxesDeals.erxesId, ids))
      ).map((row) => [row.erxesId, row]),
    );
    const facts = listed.map(({ row, pipeline }) => ({ facts: readDeal(row), row, pipeline }));
    const creatorIds = [
      ...new Set(facts.flatMap((entry) => (entry.facts?.creatorId ? [entry.facts.creatorId] : []))),
    ];
    const people = new Map(
      (creatorIds.length === 0
        ? []
        : await this.db
            .select({
              erxesId: erxesUsers.erxesId,
              fullName: erxesUsers.fullName,
              username: erxesUsers.username,
              email: erxesUsers.email,
            })
            .from(erxesUsers)
            .where(inArray(erxesUsers.erxesId, creatorIds))
      ).map((row) => [row.erxesId, row.fullName ?? row.username ?? row.email]),
    );
    const deals = facts.flatMap(({ facts: deal, row, pipeline }): ErxesRangeDeal[] => {
      if (!deal) return [];
      const kept = known.get(deal.erxesId);
      const listedLines = Array.isArray(row.productsData) || Array.isArray(row.products);
      return [
        {
          erxesId: deal.erxesId,
          pipelineId: pipeline.id,
          pipelineName: pipeline.name,
          number: deal.number,
          name: deal.name,
          createdAt: deal.createdAt,
          creatorName:
            personName(deal.creator) ??
            (deal.creatorId ? (people.get(deal.creatorId) ?? null) : null),
          stageName: deal.stageName,
          customerName: deal.parties.find((party) => party.name !== null)?.name ?? null,
          lines: listedLines ? deal.lines.length : null,
          total: dealTotal(row),
          known: kept ? { id: kept.id, status: kept.status, orderId: kept.orderId } : null,
        },
      ];
    });
    deals.sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
    return { ok: true, failure: null, detail: null, tooMany, deals };
  }

  /**
   * «Bto руу хуулах»: copies the ticked deals of a range, each read whole from erxes, kept as it
   * came and tried as a draft order, as the minute pull does. A deal Bto holds already, or one
   * erxes now places in another pipeline or outside the range, is skipped. An answer erxes gives
   * wrong for one deal fails that deal alone; erxes that cannot be reached or signed in to fails
   * the rest. The audit keeps who ran it, the range and what it came to.
   */
  async copy(ctx: AuthContext, input: ErxesRangeCopyInput): Promise<ErxesRangeCopy> {
    const { start, end } = rangeOf(input.from, input.to);
    const chosen = new Map((await this.chosen(input.pipelineIds)).map((row) => [row.id, row]));
    for (const deal of input.deals) {
      if (!chosen.has(deal.pipelineId)) {
        throw invalid('deals', 'pipeline', 'a deal of a chosen pipeline');
      }
    }
    const requested = [...new Map(input.deals.map((deal) => [deal.erxesId, deal])).values()];
    const known = new Map(
      (requested.length === 0
        ? []
        : await this.db
            .select({ id: erxesDeals.id, erxesId: erxesDeals.erxesId, orderId: erxesDeals.orderId })
            .from(erxesDeals)
            .where(
              inArray(
                erxesDeals.erxesId,
                requested.map((deal) => deal.erxesId),
              ),
            )
      ).map((row) => [row.erxesId, row]),
    );
    const results: ErxesRangeResult[] = [];
    const result = (erxesId: string, rest: Partial<ErxesRangeResult>): ErxesRangeResult => ({
      erxesId,
      outcome: 'FAILED',
      dealId: null,
      orderId: null,
      issues: [],
      skip: null,
      failure: null,
      detail: null,
      ...rest,
    });
    let stop: { failure: ErxesPullFailure; detail: string | null } | null = null;
    const opened = await this.settings.client();
    if (opened.client === null) stop = { failure: opened.failure, detail: null };
    const labels = opened.client ? new FieldLabels(opened.client) : null;

    for (const deal of requested) {
      const kept = known.get(deal.erxesId);
      if (kept) {
        results.push(
          result(deal.erxesId, {
            outcome: 'SKIPPED',
            skip: 'KNOWN',
            dealId: kept.id,
            orderId: kept.orderId,
          }),
        );
        continue;
      }
      if (stop !== null || opened.client === null || labels === null) {
        results.push(result(deal.erxesId, { outcome: 'FAILED', ...stop }));
        continue;
      }
      const pipeline = chosen.get(deal.pipelineId);
      if (!pipeline) continue;
      try {
        results.push(
          await this.copyOne(ctx, opened.client, labels, deal.erxesId, pipeline, start, end),
        );
      } catch (error: unknown) {
        const failed = failureOf(error);
        if (error instanceof ErxesError && error.reason !== 'UNEXPECTED_ANSWER') {
          // erxes cannot be reached or signed in to: the rest would fail the same way, slowly.
          stop = failed;
        } else if (!(error instanceof ErxesError)) {
          this.logger.error(
            `erxes deal ${deal.erxesId} of a range could not be copied: ${error instanceof Error ? (error.stack ?? error.message) : 'unknown error'}`,
          );
        }
        results.push(result(deal.erxesId, { outcome: 'FAILED', ...failed }));
      }
    }
    if (opened.client !== null) opened.keep();
    if (stop !== null) await this.settings.recordPull(stop.failure, stop.detail);

    const count = (outcome: ErxesRangeOutcome) =>
      results.filter((entry) => entry.outcome === outcome).length;
    const summary = {
      ok: stop === null,
      failure: stop?.failure ?? null,
      detail: stop?.detail ?? null,
      copied: count('COPIED'),
      waiting: count('WAITING'),
      skipped: count('SKIPPED'),
      failed: count('FAILED'),
    };
    await inTransaction(this.db, (tx) =>
      this.audit.record(tx, ctx, {
        action: 'RANGE_COPY',
        entity: 'erxes_deals',
        entityId: 0,
        after: {
          from: input.from,
          to: input.to,
          pipelines: [...chosen.values()].map((row) => row.erxesId),
          requested: requested.length,
          ...summary,
        },
      }),
    );
    return { ...summary, results };
  }

  /** One deal of a range: read whole, checked against the range, kept and tried. */
  private async copyOne(
    ctx: AuthContext,
    client: ErxesClient,
    labels: FieldLabels,
    erxesId: string,
    pipeline: PipelineRow,
    start: Date,
    end: Date,
  ): Promise<ErxesRangeResult> {
    const base = {
      erxesId,
      dealId: null,
      orderId: null,
      issues: [],
      skip: null,
      failure: null,
      detail: null,
    };
    const whole = await this.puller.fetchDeal(client, erxesId, labels);
    const { facts } = whole;
    if (facts.pipelineId !== null && facts.pipelineId !== pipeline.erxesId) {
      return { ...base, outcome: 'SKIPPED', skip: 'OTHER_PIPELINE' };
    }
    if (facts.createdAt !== null && (facts.createdAt < start || facts.createdAt > end)) {
      return { ...base, outcome: 'SKIPPED', skip: 'OUT_OF_RANGE' };
    }
    const dealId = await this.puller.storeDeal(whole, pipeline.erxesId, null);
    if (dealId === null) {
      // A pull kept it a moment ago and copies it itself.
      const [row] = await this.db
        .select({ id: erxesDeals.id, orderId: erxesDeals.orderId })
        .from(erxesDeals)
        .where(eq(erxesDeals.erxesId, erxesId));
      return {
        ...base,
        outcome: 'SKIPPED',
        skip: 'KNOWN',
        dealId: row?.id ?? null,
        orderId: row?.orderId ?? null,
      };
    }
    const outcome = await this.copier.tryCopy(dealId, ctx);
    return {
      ...base,
      dealId,
      orderId: outcome.orderId,
      outcome: outcome.status === 'COPIED' ? 'COPIED' : 'WAITING',
      issues: outcome.status === 'COPIED' ? [] : outcome.issues,
    };
  }

  /**
   * Reads a pipeline's deals of the range page by page, newest first, handing each to `take`;
   * true when `take` said the range holds more than a range may read.
   */
  private async readRange(
    client: ErxesClient,
    pipeline: PipelineRow,
    start: Date,
    end: Date,
    take: (row: Record<string, unknown>) => 'new' | 'old' | 'full',
  ): Promise<boolean> {
    for (let page = 0; page <= RANGE_MAX_DEALS / RANGE_PAGE; page += 1) {
      const answer = await client.read(DEAL_RANGE, {
        pipelineId: pipeline.erxesId,
        limit: RANGE_PAGE,
        skip: page * RANGE_PAGE,
        createdStartDate: start.toISOString(),
        createdEndDate: end.toISOString(),
      });
      if (!Array.isArray(answer)) {
        throw new ErxesError('UNEXPECTED_ANSWER', `erxes answered «deals» without a list`);
      }
      const rows = (answer as unknown[]).filter(
        (row): row is Record<string, unknown> => typeof row === 'object' && row !== null,
      );
      let added = 0;
      let pastStart = false;
      for (const row of rows) {
        const createdAt = dateOf(row.createdAt);
        // erxes filters by the range; Bto checks it again, and stops once it reads past it.
        if (createdAt !== null && createdAt < start) {
          pastStart = true;
          continue;
        }
        if (createdAt !== null && createdAt > end) continue;
        const taken = take(row);
        if (taken === 'full') return true;
        if (taken === 'new') added += 1;
      }
      if (rows.length < RANGE_PAGE || pastStart || added === 0) return false;
    }
    return false;
  }

  /** The chosen pipelines, each one a range may read; 422 otherwise. */
  private async chosen(ids: readonly number[]): Promise<PipelineRow[]> {
    const usable = new Map((await this.usable()).map((row) => [row.id, row]));
    const unique = [...new Set(ids)];
    if (unique.length === 0) throw invalid('pipelineIds', 'required', 'at least one pipeline');
    return unique.map((id) => {
      const row = usable.get(id);
      if (!row)
        throw invalid('pipelineIds', 'usable', 'a pipeline with its Bto place, not blocked');
      return row;
    });
  }

  private async usable(): Promise<PipelineRow[]> {
    const rows = await this.db
      .select()
      .from(erxesPipelines)
      .where(
        and(
          eq(erxesPipelines.blocked, false),
          eq(erxesPipelines.gone, false),
          isNotNull(erxesPipelines.btoPipelineId),
          isNotNull(erxesPipelines.btoStageId),
        ),
      )
      .orderBy(asc(erxesPipelines.boardName), asc(erxesPipelines.name), asc(erxesPipelines.id));
    // Kharkhorin is never read, whatever the row says (ADR-0218 #3).
    return rows.filter((row) => !isBlockedBoard(row.boardName));
  }
}
