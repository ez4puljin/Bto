import { Inject, Injectable } from '@nestjs/common';
import { wholeUnitProblem } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import { sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, ProductLifecycleService, UnitConversionService } from '../../catalog';
import type { Actor } from '../../identity';
import { PriceProfilesService } from './price-profiles.service';
import { packUnitsOf, ProductPricesService } from './product-prices.service';

export const MAX_SALE_READY = 200;

export interface SaleReadyResult {
  /** Products completed by this call. */
  completed: number[];
  /** Products that were complete already (another clerk, or a retried request). */
  alreadyComplete: number[];
}

/**
 * The price clerk completes registered products (ADR-0044 #3, ADR-0048 #5): each must be active,
 * with price terms and a profile version in force today (Ulaanbaatar) and a whole unit that
 * resolves. All or none: a product that fails stops the call, listed in `errors` (constraint
 * `priced` or `wholeUnit`). Terms are never removed, only replaced from a day on, so nothing changes
 * between the check and the update.
 */
@Injectable()
export class SaleReadinessService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lifecycle: ProductLifecycleService,
    private readonly units: UnitConversionService,
    private readonly prices: ProductPricesService,
    private readonly profiles: PriceProfilesService,
    private readonly catalog: CatalogService,
  ) {}

  complete(actor: Actor, productIds: readonly number[]): Promise<SaleReadyResult> {
    const ids = [...new Set(productIds)].sort((a, b) => a - b);
    if (ids.length === 0 || ids.length > MAX_SALE_READY) {
      throw invalid('productIds', 'count', `1 to ${MAX_SALE_READY} products at a time`);
    }
    return inTransaction(this.db, async (tx) => {
      const rows = await this.lifecycle.lockForSaleReadyInTx(tx, ids);
      const found = new Set(rows.map((row) => row.id));
      const missing = ids.find((id) => !found.has(id));
      if (missing !== undefined) throw notFound('product', missing);
      const inactive = rows.filter((row) => row.status !== 'ACTIVE');
      if (inactive.length > 0) {
        throw new AppError(
          'PRODUCT_INACTIVE',
          'only active products can be completed',
          { count: inactive.length },
          inactive.map((row) => ({
            path: `productIds.${ids.indexOf(row.id)}`,
            constraint: 'active',
            message: row.sku,
          })),
        );
      }
      const waiting = rows.filter((row) => row.saleReadyAt === null);
      const waitingIds = waiting.map((row) => row.id);
      const today = businessDate();
      const terms = await this.prices.inForce(waitingIds, today, tx);
      const versions = await this.profiles.versionsInForce(
        [...terms.values()].map((own) => own.profileId),
        today,
        tx,
      );
      const units = await this.units.currentUnits(waitingIds, tx);
      const refused = waiting.flatMap((row) => {
        const own = terms.get(row.id);
        if (!own || !versions.has(own.profileId)) return [{ row, constraint: 'priced' }];
        return wholeUnitProblem(packUnitsOf(units.get(row.id) ?? []), own.wholeUomId)
          ? [{ row, constraint: 'wholeUnit' }]
          : [];
      });
      if (refused.length > 0) {
        throw new AppError(
          'PRICE_MISSING',
          'a product needs its warehouse price and price profile in force today',
          { count: refused.length },
          refused.map(({ row, constraint }) => ({
            path: `productIds.${ids.indexOf(row.id)}`,
            constraint,
            message: row.sku,
          })),
        );
      }
      const checked = new Map(
        waiting.map((row) => {
          const own = terms.get(row.id);
          return [
            row.id,
            {
              warehousePrice: own?.warehousePrice.toFixed(0) ?? null,
              profileId: own?.profileId ?? null,
              wholeUomId: own?.wholeUomId ?? null,
              date: today,
            },
          ] as const;
        }),
      );
      const completed = await this.lifecycle.markSaleReadyInTx(tx, actor, waitingIds, checked);
      const done = new Set(completed);
      return { completed, alreadyComplete: ids.filter((id) => !done.has(id)) };
    });
  }

  /**
   * Completes, inside the caller's transaction, those of the products that are waiting and can be
   * priced today by `complete`'s checks (the price sheet import, ADR-0054 #5); the others are left
   * as they are, with no limit on the count. Returns the completed products and the moment they
   * were marked (the transaction's), which the import's revert needs.
   */
  async completeManyInTx(
    tx: Tx,
    actor: Actor,
    productIds: readonly number[],
  ): Promise<{ completed: number[]; at: Date | null }> {
    const ids = [...new Set(productIds)].sort((a, b) => a - b);
    if (ids.length === 0) return { completed: [], at: null };
    const waiting = (await this.lifecycle.lockForSaleReadyInTx(tx, ids)).filter(
      (row) => row.status === 'ACTIVE' && row.saleReadyAt === null,
    );
    const waitingIds = waiting.map((row) => row.id);
    const today = businessDate();
    const terms = await this.prices.inForce(waitingIds, today, tx);
    const versions = await this.profiles.versionsInForce(
      [...terms.values()].map((own) => own.profileId),
      today,
      tx,
    );
    const units = await this.units.currentUnits(waitingIds, tx);
    const checked = new Map<number, Record<string, unknown>>();
    for (const id of waitingIds) {
      const own = terms.get(id);
      if (!own || !versions.has(own.profileId)) continue;
      if (wholeUnitProblem(packUnitsOf(units.get(id) ?? []), own.wholeUomId)) continue;
      checked.set(id, {
        warehousePrice: own.warehousePrice.toFixed(0),
        profileId: own.profileId,
        wholeUomId: own.wholeUomId,
        date: today,
      });
    }
    const completed = await this.lifecycle.markSaleReadyInTx(
      tx,
      actor,
      [...checked.keys()],
      checked,
    );
    if (completed.length === 0) return { completed, at: null };
    const { rows } = await tx.execute<{ at: string }>(
      sql`SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at`,
    );
    return { completed, at: rows[0] ? new Date(rows[0].at) : null };
  }

  /** Products the price clerk still has to complete, up to `cap` (the home tile, ADR-0047 #7). */
  waitingCount(cap: number): Promise<number> {
    return this.catalog.countWaitingForPrices(cap);
  }
}
