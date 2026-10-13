import { Inject, Injectable } from '@nestjs/common';
import type { Decimal } from '@tugeel/shared/money';
import { PRICE_LISTS, type PriceList } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { ProductLifecycleService, UnitConversionService } from '../../catalog';
import type { Actor } from '../../identity';
import { UnitPricesService } from './unit-prices.service';

export const MAX_SALE_READY = 200;

export interface SaleReadyResult {
  /** Products completed by this call. */
  completed: number[];
  /** Products that were complete already (another clerk, or a retried request). */
  alreadyComplete: number[];
}

/**
 * The price clerk completes registered products (ADR-0044 #3): each must be active and its base
 * unit must have a wholesale and a supermarket price in force today (Ulaanbaatar). All or none: a
 * product that fails stops the call, listed in `errors`. A base unit's price can never be removed
 * or superseded, so nothing changes between the check and the update.
 */
@Injectable()
export class SaleReadinessService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly lifecycle: ProductLifecycleService,
    private readonly units: UnitConversionService,
    private readonly prices: UnitPricesService,
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
      const bases = await this.units.baseUnits(
        waiting.map((row) => row.id),
        tx,
      );
      const baseIds = [...bases.values()].map((unit) => unit.unitId);
      const today = businessDate();
      const inForce = new Map<PriceList, Map<number, Decimal>>();
      for (const list of PRICE_LISTS) {
        inForce.set(list, await this.prices.inForce(list, baseIds, today, tx));
      }
      const unpriced = waiting.filter((row) => {
        const base = bases.get(row.id);
        return !base || PRICE_LISTS.some((list) => !inForce.get(list)?.has(base.unitId));
      });
      if (unpriced.length > 0) {
        throw new AppError(
          'PRICE_MISSING',
          'the base unit needs a wholesale and a supermarket price in force today',
          { count: unpriced.length },
          unpriced.map((row) => ({
            path: `productIds.${ids.indexOf(row.id)}`,
            constraint: 'priced',
            message: row.sku,
          })),
        );
      }
      const checked = new Map(
        waiting.map((row) => {
          const base = bases.get(row.id);
          const prices = Object.fromEntries(
            PRICE_LISTS.map((list) => [
              list,
              base ? (inForce.get(list)?.get(base.unitId)?.toFixed(0) ?? null) : null,
            ]),
          );
          return [row.id, { prices, date: today }] as const;
        }),
      );
      const completed = await this.lifecycle.markSaleReadyInTx(
        tx,
        actor,
        waiting.map((row) => row.id),
        checked,
      );
      const done = new Set(completed);
      return { completed, alreadyComplete: ids.filter((id) => !done.has(id)) };
    });
  }
}
