import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { type ErxesClient, ErxesError } from '../erxes.client';
import {
  DEAL_DETAIL,
  DEAL_FIELDS,
  DEAL_PAGE,
  dateOf,
  type ErxesDealFacts,
  type ErxesPerson,
  fieldLabelsOf,
  personName,
  productIdsOf,
  PRODUCTS,
  readDeal,
  textOf,
} from '../erxes-wire';
import { erxesDeals, erxesPipelines, type ErxesPullFailure } from '../schema';
import { ErxesCopyService } from './erxes-copy.service';
import { ErxesDirectoryFlowService } from './erxes-directory-flow.service';
import { ErxesSettingsFlowService } from './erxes-settings-flow.service';

type PipelineRow = typeof erxesPipelines.$inferSelect;

export interface ErxesPullSummary {
  /** erxes was reached and every ticked pipeline read. */
  ok: boolean;
  failure: ErxesPullFailure | null;
  /** Ticked pipelines read. */
  pipelines: number;
  /** Deals seen for the first time. */
  seen: number;
  /** Deals that became orders in this pull, new and waiting ones. */
  copied: number;
  /** Deals still waiting after it. */
  waiting: number;
  /** What erxes said when it failed, in English; never a secret. */
  detail: string | null;
}

/** A deal as erxes holds it: the answer, its products, what Bto reads of it, its field labels. */
export interface WholeDeal {
  raw: unknown;
  products: unknown[];
  facts: ErxesDealFacts;
  fieldLabels: Record<string, string>;
}

const PAGE = 50;
/** A pull reads at most this many pages of one pipeline; the next pull carries on. */
const MAX_PAGES = 20;
/** Deals this much older than the newest one seen are read again, should clocks or saves lag. */
const OVERLAP_MS = 10 * 60_000;
/** Waiting deals tried again in one pull. */
const RETRY_LIMIT = 200;
/** How much of the first answers goes to the log. */
const LOG_CHARS = 20_000;

/**
 * The pull (ADR-0218 #8): for every ticked pipeline, erxes's deals newest first down to the last
 * one seen; each new deal is read whole, kept as it came and tried as an order; then every waiting
 * deal is tried again. A flow service: erxes is called between transactions, and each deal is its
 * own transaction in `ErxesCopyService`. Running twice at once is safe: `erxes_deals.erxes_id` is
 * unique and a copy locks its row.
 */
@Injectable()
export class ErxesPullFlowService {
  private readonly logger = new Logger(ErxesPullFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: ErxesSettingsFlowService,
    private readonly directory: ErxesDirectoryFlowService,
    private readonly copy: ErxesCopyService,
  ) {}

  /** The every-minute run: nothing happens while the switch is off. */
  async scheduled(): Promise<ErxesPullSummary | { skipped: true }> {
    const saved = await this.settings.saved();
    if (!saved.enabled) return { skipped: true };
    return this.pull();
  }

  /** One pull now, whatever the switch says («Одоо татах»). */
  async pull(): Promise<ErxesPullSummary> {
    const summary: ErxesPullSummary = {
      ok: false,
      failure: null,
      pipelines: 0,
      seen: 0,
      copied: 0,
      waiting: 0,
      detail: null,
    };
    let detail: string | null = null;
    const tried = new Set<number>();
    const opened = await this.settings.client();
    if (opened.client === null) {
      summary.failure = opened.failure;
    } else {
      try {
        const labels = new FieldLabels(opened.client);
        for (const pipeline of await this.directory.enabledPipelines()) {
          const result = await this.pullPipeline(opened.client, pipeline, labels);
          summary.pipelines += 1;
          summary.seen += result.dealIds.length;
          for (const dealId of result.dealIds) {
            tried.add(dealId);
            if (await this.tryCopy(dealId)) summary.copied += 1;
          }
        }
        summary.ok = true;
      } catch (error: unknown) {
        if (error instanceof ErxesError) {
          summary.failure = error.reason;
          detail = error.message;
        } else {
          summary.failure = 'INTERNAL';
          detail = error instanceof Error ? error.message : 'unknown error';
          this.logger.error(error instanceof Error ? (error.stack ?? error.message) : detail);
        }
      }
      opened.keep();
      if (opened.client.cuts.length > 0) {
        this.logger.warn(`erxes refused fields: ${[...new Set(opened.client.cuts)].join(', ')}`);
      }
    }
    // The waiting deals need nothing from erxes: they are tried even when it could not be reached.
    for (const dealId of await this.copy.waitingIds(RETRY_LIMIT)) {
      if (tried.has(dealId)) continue;
      if (await this.tryCopy(dealId)) summary.copied += 1;
    }
    const [count] = await this.db
      .select({ waiting: sql<number>`count(*)::int` })
      .from(erxesDeals)
      .where(eq(erxesDeals.status, 'WAITING'));
    summary.waiting = count?.waiting ?? 0;
    summary.detail = detail === null ? null : detail.slice(0, 500);
    await this.settings.recordPull(summary.failure, detail);
    return summary;
  }

  /** True when this try made the order; a deal that fails alone does not stop the others. */
  private async tryCopy(dealId: number): Promise<boolean> {
    try {
      return (await this.copy.tryCopy(dealId, null)).copiedNow;
    } catch (error: unknown) {
      this.logger.error(
        `erxes deal row ${dealId} could not be tried: ${error instanceof Error ? (error.stack ?? error.message) : 'unknown error'}`,
      );
      return false;
    }
  }

  /** Reads one pipeline's new deals and keeps them; returns the rows made, oldest first. */
  private async pullPipeline(
    client: ErxesClient,
    pipeline: PipelineRow,
    labels: FieldLabels,
  ): Promise<{ dealIds: number[] }> {
    const since = pipeline.enabledAt ?? new Date();
    const stopAt = new Date(
      Math.max(since.getTime(), (pipeline.lastSeenCreatedAt?.getTime() ?? 0) - OVERLAP_MS),
    );
    const fresh: { erxesId: string; createdAt: Date | null }[] = [];
    let newest = pipeline.lastSeenCreatedAt;
    let sample: unknown = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const answer = await client.read(DEAL_PAGE, {
        pipelineId: pipeline.erxesId,
        limit: PAGE,
        skip: page * PAGE,
      });
      const rows = Array.isArray(answer) ? (answer as Record<string, unknown>[]) : [];
      if (page === 0) sample = rows.slice(0, 3);
      let older = 0;
      for (const row of rows) {
        const erxesId = textOf(row?._id);
        if (!erxesId) continue;
        const createdAt = dateOf(row.createdAt);
        if (createdAt && createdAt < stopAt) older += 1;
        // Only deals created after the pipeline was ticked are copied (ADR-0218 #3).
        if (createdAt && createdAt < since) continue;
        if (createdAt && (newest === null || createdAt > newest)) newest = createdAt;
        fresh.push({ erxesId, createdAt });
      }
      // Newest first: a page with nothing new enough, or the last page, ends the reading.
      if (rows.length < PAGE || older === rows.length) break;
    }
    const known =
      fresh.length === 0
        ? []
        : await this.db
            .select({ erxesId: erxesDeals.erxesId })
            .from(erxesDeals)
            .where(
              inArray(
                erxesDeals.erxesId,
                fresh.map((deal) => deal.erxesId),
              ),
            );
    const seen = new Set(known.map((row) => row.erxesId));
    const dealIds: number[] = [];
    let firstDetail: unknown = null;
    // Oldest first, so the orders are numbered in the order the deals were made.
    for (const deal of fresh.filter((entry) => !seen.has(entry.erxesId)).reverse()) {
      if (seen.has(deal.erxesId)) continue;
      seen.add(deal.erxesId);
      const kept = await this.keepDeal(
        client,
        deal.erxesId,
        pipeline.erxesId,
        labels,
        deal.createdAt,
      );
      firstDetail ??= kept.answer;
      // No row: another pull kept it a moment ago, and tries it itself.
      if (kept.dealId !== null) dealIds.push(kept.dealId);
    }
    await this.db
      .update(erxesPipelines)
      .set({
        lastSeenCreatedAt: newest,
        lastPullAt: sql`now()`,
        ...this.firstPull(pipeline, sample, firstDetail, client),
      })
      .where(eq(erxesPipelines.id, pipeline.id));
    return { dealIds };
  }

  /**
   * Reads one deal whole (`dealDetail`, its products, and the labels of its custom fields when it
   * has some), remembers its people and keeps it as a waiting row, as it came. `dealId` is null
   * when the deal was kept already. erxes is called before the insert, never inside a transaction.
   */
  async keepDeal(
    client: ErxesClient,
    erxesId: string,
    pipelineErxesId: string,
    labels: FieldLabels,
    listedCreatedAt: Date | null,
  ): Promise<{ dealId: number | null; answer: unknown }> {
    const whole = await this.fetchDeal(client, erxesId, labels);
    return {
      dealId: await this.storeDeal(whole, pipelineErxesId, listedCreatedAt),
      answer: { deal: whole.raw, products: whole.products },
    };
  }

  /**
   * One deal as erxes holds it, read whole; nothing is written. The minute pull and the range copy
   * (ADR-0220) read a deal only this way; an answer without a deal is `UNEXPECTED_ANSWER`.
   */
  async fetchDeal(client: ErxesClient, erxesId: string, labels: FieldLabels): Promise<WholeDeal> {
    const raw = await client.read(DEAL_DETAIL, { id: erxesId });
    const productIds = productIdsOf(raw);
    const products =
      productIds.length === 0
        ? []
        : await client
            .read(PRODUCTS, { ids: productIds, perPage: productIds.length })
            .catch((error: unknown) => {
              // Some erxes versions carry the product inside the line: the deal says enough.
              if (error instanceof ErxesError && error.reason === 'UNEXPECTED_ANSWER') return [];
              throw error;
            });
    const productList = Array.isArray(products) ? (products as unknown[]) : [];
    const facts = readDeal(raw, productList);
    if (!facts) throw new ErxesError('UNEXPECTED_ANSWER', `erxes gave no deal ${erxesId}`);
    const fieldLabels = facts.customFields.length > 0 ? await labels.get() : {};
    return { raw, products: productList, facts, fieldLabels };
  }

  /**
   * Keeps a deal read whole as a waiting row and remembers its people; null when the deal was
   * kept already (by an earlier pull or one running now, which then tries it itself).
   */
  async storeDeal(
    whole: WholeDeal,
    pipelineErxesId: string,
    listedCreatedAt: Date | null,
  ): Promise<number | null> {
    const { facts } = whole;
    const people = [facts.creator, ...facts.assigned].filter(
      (person): person is ErxesPerson => person !== null,
    );
    await this.directory.rememberUsers(this.db, people);
    const [row] = await this.db
      .insert(erxesDeals)
      .values({
        erxesId: facts.erxesId,
        pipelineErxesId,
        name: facts.name,
        number: facts.number,
        erxesCreatedAt: facts.createdAt ?? listedCreatedAt,
        creatorErxesId: facts.creatorId,
        creatorName: personName(facts.creator),
        raw: whole.raw,
        products: whole.products,
        fieldLabels: whole.fieldLabels,
      })
      .onConflictDoNothing({ target: erxesDeals.erxesId })
      .returning({ id: erxesDeals.id });
    return row?.id ?? null;
  }

  /**
   * The first answers of a pipeline, logged and kept once (ADR-0218 #8): the first page, and the
   * first whole deal when one comes. They are laid beside `erxes-wire.fixture.ts` by hand.
   */
  private firstPull(
    pipeline: PipelineRow,
    page: unknown,
    detail: unknown,
    client: ErxesClient,
  ): { firstPull?: unknown } {
    const kept =
      typeof pipeline.firstPull === 'object' && pipeline.firstPull !== null
        ? (pipeline.firstPull as { page?: unknown; detail?: unknown })
        : {};
    const hasPage = Array.isArray(page) && page.length > 0;
    const addPage = kept.page === undefined && hasPage;
    const addDetail = kept.detail === undefined && detail !== null;
    if (!addPage && !addDetail) return {};
    const next = {
      ...kept,
      ...(addPage ? { page } : {}),
      ...(addDetail ? { detail } : {}),
      refused: [...new Set(client.cuts)],
      at: new Date().toISOString(),
    };
    this.logger.log(
      `erxes first answers of pipeline «${pipeline.name}» (${pipeline.erxesId}): ${JSON.stringify({
        ...(addPage ? { page } : {}),
        ...(addDetail ? { detail } : {}),
      }).slice(0, LOG_CHARS)}`,
    );
    return { firstPull: next };
  }
}

/** The labels of the deals' custom fields, asked once in a pull and only when a deal has some. */
export class FieldLabels {
  private labels: Promise<Record<string, string>> | null = null;

  constructor(private readonly client: ErxesClient) {}

  get(): Promise<Record<string, string>> {
    this.labels ??= this.client
      .read(DEAL_FIELDS)
      .then((fields) => fieldLabelsOf(Array.isArray(fields) ? (fields as unknown[]) : []))
      .catch((error: unknown) => {
        // Labels are a comfort: without them the panel shows the fields' ids.
        if (error instanceof ErxesError && error.reason === 'UNEXPECTED_ANSWER') return {};
        throw error;
      });
    return this.labels;
  }
}
