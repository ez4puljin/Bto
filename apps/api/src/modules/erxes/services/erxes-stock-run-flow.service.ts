import { Inject, Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { ErxesError, type ErxesClient } from '../erxes.client';
import {
  ERKHET_LOCATION_NAMES,
  ERKHET_REMAINDERS,
  type ErxesProduct,
  PRODUCT_PAGE,
  planRemainders,
  readProduct,
  readRemainderConfig,
  readRemainders,
  REMAINDER_BATCH,
  REMAINDER_CONFIG,
  type RemainderStep,
} from '../erxes-wire';
import {
  type ErxesStockFailure,
  erxesStockBalances,
  erxesStockLocations,
  erxesStockProducts,
  erxesStockRuns,
} from '../schema';
import { ErxesProductMatchService } from './erxes-product-match.service';
import { ErxesSettingsFlowService } from './erxes-settings-flow.service';

/**
 * How gently a run reads (ADR-0221): Erkhet answers behind erxes and a tight loop would load it.
 * Tests give a faster pace.
 */
export interface ErxesStockPace {
  /** Calls of `erkhetRemainders` at once; never more than 2. */
  concurrency: number;
  /** The pause of each caller after each call, in ms. */
  gapMs: number;
  /** erxes's products a page. */
  productPage: number;
  /** Products a call of `erkhetRemainders`; never more than 50. */
  batch: number;
}

export const ERXES_STOCK_PACE = Symbol('ERXES_STOCK_PACE');
export const DEFAULT_STOCK_PACE: ErxesStockPace = {
  concurrency: 2,
  gapMs: 300,
  productPage: 500,
  batch: REMAINDER_BATCH,
};

/** Pages of products a run reads at most (13,000 active products are 26 pages of 500). */
const MAX_PRODUCT_PAGES = 200;
/** Refused calls in a row after which erxes is taken to be down and the run stops. */
const MAX_FAILURES_IN_A_ROW = 10;
/** Products matched and stored together. */
const STORE_CHUNK = 500;

/** One call of a run: a batch of products asked through one pipeline. */
interface RemainderCall {
  ids: string[];
  step: RemainderStep;
}

/** The calls of a run: every batch of products through every step of the plan. */
export function remainderCalls(
  ids: readonly string[],
  plan: readonly RemainderStep[],
  batch = REMAINDER_BATCH,
): RemainderCall[] {
  const calls: RemainderCall[] = [];
  for (let start = 0; start < ids.length; start += batch) {
    const chunk = ids.slice(start, start + batch);
    for (const step of plan) calls.push({ ids: chunk, step });
  }
  return calls;
}

class RunStopped extends Error {
  constructor(
    readonly failure: ErxesStockFailure,
    message: string,
  ) {
    super(message);
  }
}

const pause = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

/**
 * A read of Erkhet's balances through erxes (ADR-0221), done by the worker: the plan from
 * `remainderConfig`, erxes's active products page by page, each matched to a Bto product by the
 * deal copy's rule, then `erkhetRemainders` for 50 products at a time through each pipeline of the
 * plan, two calls at once at most, with a pause after each. A refused call is counted and its
 * products marked unread; the run goes on. erxes is never called inside a transaction, and nothing
 * here writes stock or erxes.
 */
@Injectable()
export class ErxesStockRunFlowService {
  private readonly logger = new Logger(ErxesStockRunFlowService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ERXES_STOCK_PACE) private readonly pace: ErxesStockPace,
    private readonly settings: ErxesSettingsFlowService,
    private readonly matcher: ErxesProductMatchService,
  ) {}

  /** Does one queued run to its end; a run that is not queued is left alone. */
  async execute(runId: number): Promise<{ status: 'DONE' | 'FAILED' | 'SKIPPED' }> {
    const [taken] = await this.db
      .update(erxesStockRuns)
      .set({ status: 'RUNNING', startedAt: sql`now()`, heartbeatAt: sql`now()` })
      .where(and(eq(erxesStockRuns.id, runId), eq(erxesStockRuns.status, 'QUEUED')))
      .returning({ id: erxesStockRuns.id });
    if (!taken) return { status: 'SKIPPED' };
    try {
      const opened = await this.settings.client();
      if (opened.client === null) throw new RunStopped(opened.failure, 'erxes sign-in not saved');
      await this.read(runId, opened.client);
      opened.keep();
      await this.finish(runId);
      return { status: 'DONE' };
    } catch (error: unknown) {
      const failure: ErxesStockFailure =
        error instanceof RunStopped
          ? error.failure
          : error instanceof ErxesError
            ? error.reason
            : 'INTERNAL';
      const detail = error instanceof Error ? error.message : String(error);
      if (failure === 'INTERNAL') this.logger.error(`erxes stock run ${runId} failed`, error);
      await this.fail(runId, failure, detail);
      return { status: 'FAILED' };
    }
  }

  private async read(runId: number, client: ErxesClient): Promise<void> {
    const plan = planRemainders(readRemainderConfig(await client.read(REMAINDER_CONFIG)));
    if (plan.length === 0) {
      throw new RunStopped('NO_PLAN', 'remainderConfig names no pipeline of account 150101');
    }
    await this.db.update(erxesStockRuns).set({ plan }).where(eq(erxesStockRuns.id, runId));

    const products = await this.products(runId, client);
    for (let start = 0; start < products.length; start += STORE_CHUNK) {
      const chunk = products.slice(start, start + STORE_CHUNK);
      const matches = await this.matcher.matchMany(chunk);
      await this.db.insert(erxesStockProducts).values(
        chunk.map((product, at) => {
          const match = matches[at];
          return {
            runId,
            erxesId: product.erxesId,
            code: product.code,
            name: product.name,
            uom: product.uom,
            productId: match?.productId ?? null,
            matchReason: match ? match.reason : ('PRODUCT_NOT_FOUND' as const),
          };
        }),
      );
      await this.beat(runId);
    }

    const calls = remainderCalls(
      products.map((product) => product.erxesId),
      plan,
      Math.min(REMAINDER_BATCH, Math.max(1, this.pace.batch)),
    );
    await this.db
      .update(erxesStockRuns)
      .set({ products: products.length, batchesTotal: calls.length, heartbeatAt: sql`now()` })
      .where(eq(erxesStockRuns.id, runId));

    let next = 0;
    let failuresInARow = 0;
    const halt: { error: Error | null } = { error: null };
    const worker = async () => {
      while (halt.error === null) {
        const call = calls[next];
        next += 1;
        if (!call) return;
        try {
          await this.call(runId, client, call);
          failuresInARow = 0;
        } catch (error: unknown) {
          if (error instanceof ErxesError && error.reason === 'LOGIN_FAILED') {
            halt.error = error;
            return;
          }
          failuresInARow += 1;
          this.logger.warn(
            `erxes stock run ${runId}: erkhetRemainders refused through ${call.step.pipelineId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          await this.refused(runId, call);
          if (failuresInARow >= MAX_FAILURES_IN_A_ROW) {
            halt.error =
              error instanceof ErxesError
                ? error
                : new RunStopped('UNEXPECTED_ANSWER', 'too many refused calls');
            return;
          }
        }
        await pause(this.pace.gapMs);
      }
    };
    const workers = Math.min(2, Math.max(1, this.pace.concurrency));
    await Promise.all(Array.from({ length: workers }, worker));
    if (halt.error !== null) throw halt.error;
  }

  /** erxes's active products, page by page, each once. */
  private async products(runId: number, client: ErxesClient): Promise<ErxesProduct[]> {
    const seen = new Map<string, ErxesProduct>();
    const perPage = this.pace.productPage;
    for (let page = 1; page <= MAX_PRODUCT_PAGES; page += 1) {
      const answer = await client.read(PRODUCT_PAGE, { perPage, page });
      const rows = Array.isArray(answer) ? answer : [];
      for (const row of rows) {
        const product = readProduct(row);
        if (product && !seen.has(product.erxesId)) seen.set(product.erxesId, product);
      }
      await this.beat(runId);
      if (rows.length < perPage) break;
      await pause(this.pace.gapMs);
    }
    return [...seen.values()];
  }

  /** One call: its balances kept (zeros left out), the run's progress moved. */
  private async call(runId: number, client: ErxesClient, call: RemainderCall): Promise<void> {
    const answer = await client.read(ERKHET_REMAINDERS, {
      productIds: call.ids,
      pipelineId: call.step.pipelineId,
    });
    const asked = new Set(call.ids);
    const taken = new Set(call.step.locations);
    const rows = readRemainders(answer).flatMap((row) =>
      asked.has(row.erxesId)
        ? [...row.byLocation]
            .filter(
              ([location, quantity]) => taken.has(location) && !new Decimal(quantity).isZero(),
            )
            .map(([location, quantity]) => ({
              runId,
              erxesId: row.erxesId,
              location,
              quantity: new Decimal(quantity),
            }))
        : [],
    );
    if (rows.length > 0) {
      await this.db
        .insert(erxesStockBalances)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            erxesStockBalances.runId,
            erxesStockBalances.location,
            erxesStockBalances.erxesId,
          ],
          set: { quantity: sql`excluded.quantity` },
        });
    }
    await this.db
      .update(erxesStockRuns)
      .set({ batchesDone: sql`${erxesStockRuns.batchesDone} + 1`, heartbeatAt: sql`now()` })
      .where(eq(erxesStockRuns.id, runId));
  }

  /** A refused call: its products' Erkhet quantities are unknown, never zero. */
  private async refused(runId: number, call: RemainderCall): Promise<void> {
    await this.db
      .update(erxesStockProducts)
      .set({ readOk: false })
      .where(
        and(eq(erxesStockProducts.runId, runId), inArray(erxesStockProducts.erxesId, call.ids)),
      );
    await this.db
      .update(erxesStockRuns)
      .set({
        batchesDone: sql`${erxesStockRuns.batchesDone} + 1`,
        batchesFailed: sql`${erxesStockRuns.batchesFailed} + 1`,
        heartbeatAt: sql`now()`,
      })
      .where(eq(erxesStockRuns.id, runId));
  }

  private async beat(runId: number): Promise<void> {
    await this.db
      .update(erxesStockRuns)
      .set({ heartbeatAt: sql`now()` })
      .where(eq(erxesStockRuns.id, runId));
  }

  /**
   * The run is done: it becomes the one the page compares, the rows of older runs go, and the
   * locations its plan read are listed for linking.
   */
  private async finish(runId: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const [run] = await tx
        .update(erxesStockRuns)
        .set({ status: 'DONE', activeSlot: null, finishedAt: sql`now()`, heartbeatAt: sql`now()` })
        .where(and(eq(erxesStockRuns.id, runId), eq(erxesStockRuns.status, 'RUNNING')))
        .returning({ plan: erxesStockRuns.plan });
      if (!run) return;
      await tx.delete(erxesStockBalances).where(ne(erxesStockBalances.runId, runId));
      await tx.delete(erxesStockProducts).where(ne(erxesStockProducts.runId, runId));
      const codes = [...new Set((run.plan ?? []).flatMap((step) => step.locations))];
      if (codes.length > 0) {
        await tx
          .insert(erxesStockLocations)
          .values(codes.map((code) => ({ code, name: ERKHET_LOCATION_NAMES[code] ?? null })))
          .onConflictDoNothing();
      }
    });
  }

  /** The run ended without its rows: they are dropped, the newest finished run stays. */
  private async fail(runId: number, failure: ErxesStockFailure, detail: string): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      await tx
        .update(erxesStockRuns)
        .set({
          status: 'FAILED',
          activeSlot: null,
          failure,
          failureDetail: detail.slice(0, 500),
          finishedAt: sql`now()`,
        })
        .where(
          and(eq(erxesStockRuns.id, runId), inArray(erxesStockRuns.status, ['QUEUED', 'RUNNING'])),
        );
      await tx.delete(erxesStockBalances).where(eq(erxesStockBalances.runId, runId));
      await tx.delete(erxesStockProducts).where(eq(erxesStockProducts.runId, runId));
    });
  }
}
