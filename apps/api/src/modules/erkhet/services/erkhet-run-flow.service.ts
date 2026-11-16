import { Inject, Injectable, Logger } from '@nestjs/common';
import { ERKHET_LIMITS, ERKHET_LIST_PATHS, type ErkhetFailure } from '@tugeel/shared/erkhet';
import { nameKey } from '@tugeel/shared/text';
import { businessDate } from '@tugeel/shared/time';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { ErkhetError, ErkhetGateway } from '../../../integrations/erkhet';
import { CatalogImportService } from '../../catalog';
import { CustomerCategoriesService, CustomersService } from '../../partners';
import { ProductPricesService } from '../../pricing';
import { type ErkhetRunSummary, erkhetSyncItems, erkhetSyncRuns } from '../schema';
import {
  compareCustomers,
  compareProducts,
  type FoundItem,
  itemLookupKeys,
} from './erkhet-compare';
import { ErkhetSettingsFlowService } from './erkhet-settings-flow.service';
import { ErkhetFileError, readErkhetCustomers, readErkhetItems } from './erkhet-sheets';

const INSERT_CHUNK = 500;

/**
 * One check, in the worker (ADR-0203 #5): signs in to Erkhet and downloads its two lists with no
 * transaction open, reads Bto's side through the owning modules, compares, and writes the rows
 * that differ in one transaction. Nothing is written to Erkhet and nothing in Bto changes here.
 *
 * pg-boss delivers at least once: a check that already ended is left alone, and one found RUNNING
 * (its worker died) simply runs again, since it writes nothing before its last transaction.
 */
@Injectable()
export class ErkhetRunFlowService {
  private readonly logger = new Logger('Erkhet');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly gateway: ErkhetGateway,
    private readonly settings: ErkhetSettingsFlowService,
    private readonly customers: CustomersService,
    private readonly categories: CustomerCategoriesService,
    private readonly catalog: CatalogImportService,
    private readonly prices: ProductPricesService,
  ) {}

  async execute(runId: number): Promise<{ status: string; failure?: ErkhetFailure }> {
    const [claimed] = await this.db
      .update(erkhetSyncRuns)
      .set({ status: 'RUNNING', startedAt: sql`now()` })
      .where(
        and(eq(erkhetSyncRuns.id, runId), inArray(erkhetSyncRuns.status, ['QUEUED', 'RUNNING'])),
      )
      .returning({ id: erkhetSyncRuns.id });
    if (!claimed) return { status: 'SKIPPED' };
    try {
      const found = await this.compare();
      if ('failure' in found) return await this.fail(runId, found.failure);
      await this.finish(runId, found.items, found.summary);
      return { status: 'DONE' };
    } catch (error: unknown) {
      this.logger.error({ runId, err: error }, 'the Erkhet check failed');
      return this.fail(runId, 'INTERNAL');
    }
  }

  private async compare(): Promise<
    { items: FoundItem[]; summary: ErkhetRunSummary } | { failure: ErkhetFailure }
  > {
    const saved = await this.settings.saved();
    if (saved.account === null) return { failure: saved.failure };

    let itemFile: Buffer;
    let customerFile: Buffer;
    try {
      const client = this.gateway.clientFor(saved.account);
      await client.signIn();
      itemFile = (await client.list(ERKHET_LIST_PATHS.items)).data;
      customerFile = (await client.list(ERKHET_LIST_PATHS.customers)).data;
    } catch (error: unknown) {
      if (!(error instanceof ErkhetError)) throw error;
      this.logger.warn({ reason: error.reason, status: error.status }, error.message);
      return { failure: error.reason };
    }

    let erkhetItems: Awaited<ReturnType<typeof readErkhetItems>>;
    let erkhetCustomers: Awaited<ReturnType<typeof readErkhetCustomers>>;
    try {
      erkhetItems = await readErkhetItems(itemFile);
      erkhetCustomers = await readErkhetCustomers(customerFile);
    } catch (error: unknown) {
      if (!(error instanceof ErkhetFileError)) throw error;
      this.logger.warn(error.message);
      return { failure: 'UNEXPECTED_FILE' };
    }

    const btoCustomers = await this.customers.directory();
    const categories = await this.categories.findByNames(
      erkhetCustomers.map((row) => row.groupName).filter(Boolean),
    );
    const categoryByKey = new Map(categories.map((category) => [category.nameKey, category]));
    const customers = compareCustomers(erkhetCustomers, btoCustomers, (groupName) => {
      const category = categoryByKey.get(nameKey(groupName));
      return category ? { id: category.id, active: category.active } : null;
    });

    const btoProducts = await this.catalog.directory();
    const owners = await this.catalog.barcodeOwners(itemLookupKeys(erkhetItems));
    const terms = await this.prices.inForce(
      btoProducts.map((product) => product.id),
      businessDate(),
    );
    const products = compareProducts(
      erkhetItems,
      btoProducts,
      new Map([...owners].map(([key, owner]) => [key, owner.productId])),
      new Map([...terms].map(([productId, term]) => [productId, term.warehousePrice])),
    );

    return {
      items: [...customers.items, ...products.items],
      summary: { customers: customers.summary, products: products.summary },
    };
  }

  private async finish(runId: number, items: FoundItem[], summary: ErkhetRunSummary) {
    await inTransaction(this.db, async (tx) => {
      // A second delivery of the job finds the first one's rows: they are written once.
      await tx.delete(erkhetSyncItems).where(eq(erkhetSyncItems.runId, runId));
      for (let start = 0; start < items.length; start += INSERT_CHUNK) {
        await tx
          .insert(erkhetSyncItems)
          .values(items.slice(start, start + INSERT_CHUNK).map((item) => ({ runId, ...item })));
      }
      await tx
        .update(erkhetSyncRuns)
        .set({
          status: 'DONE',
          activeSlot: null,
          finishedAt: sql`now()`,
          summary,
          itemCount: items.length,
        })
        .where(eq(erkhetSyncRuns.id, runId));
      // Only the last few checks keep their rows; older ones keep their counts.
      const kept = await tx
        .select({ id: erkhetSyncRuns.id })
        .from(erkhetSyncRuns)
        .where(eq(erkhetSyncRuns.status, 'DONE'))
        .orderBy(sql`${erkhetSyncRuns.id} DESC`)
        .limit(ERKHET_LIMITS.keptRuns);
      const oldest = kept[kept.length - 1]?.id;
      if (kept.length === ERKHET_LIMITS.keptRuns && oldest !== undefined) {
        await tx.delete(erkhetSyncItems).where(lt(erkhetSyncItems.runId, oldest));
        await tx
          .update(erkhetSyncRuns)
          .set({ itemCount: 0 })
          .where(and(lt(erkhetSyncRuns.id, oldest), sql`${erkhetSyncRuns.itemCount} > 0`));
      }
    });
  }

  private async fail(runId: number, failure: ErkhetFailure) {
    await this.db
      .update(erkhetSyncRuns)
      .set({ status: 'FAILED', failure, activeSlot: null, finishedAt: sql`now()` })
      .where(and(eq(erkhetSyncRuns.id, runId), eq(erkhetSyncRuns.status, 'RUNNING')));
    return { status: 'FAILED', failure };
  }
}
