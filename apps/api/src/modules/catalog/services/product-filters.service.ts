import { Inject, Injectable } from '@nestjs/common';
import { PRODUCT_STAGES, type ProductStage } from '@tugeel/shared/catalog';
import {
  conditionDays,
  PRODUCT_MISSING,
  type ProductMissing,
  type SegmentCondition,
} from '@tugeel/shared/segments';
import { businessDate } from '@tugeel/shared/time';
import { asc, or, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { idIn, onBusinessDays } from '../../../common/db/days';
import { categories, products } from '../schema';
import { GAP_CONDITIONS } from './ebarimt-readiness.service';
import { productSearch } from './products.service';

const STAGES: Record<ProductStage, SQL> = {
  ACTIVE: sql`${products.status} = 'ACTIVE' AND ${products.saleReadyAt} IS NOT NULL`,
  PENDING: sql`${products.status} = 'ACTIVE' AND ${products.saleReadyAt} IS NULL`,
  INACTIVE: sql`${products.status} = 'INACTIVE'`,
};

/** A barcode on a current unit of the product: the base unit's, or any unit's. */
const barcodeOn = (baseOnly: boolean) => sql`EXISTS (
  SELECT 1 FROM product_units u JOIN product_barcodes b ON b.product_unit_id = u.id
   WHERE u.product_id = products.id AND u.superseded_at IS NULL${baseOnly ? sql` AND u.is_base` : sql``})`;

const MISSING: Record<ProductMissing, SQL> = {
  BASE_BARCODE: sql`NOT ${barcodeOn(true)}`,
  ANY_BARCODE: sql`NOT ${barcodeOn(false)}`,
  PHOTO: sql`NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = products.id)`,
  WEIGHT: sql`${products.weightKg} IS NULL`,
  EBARIMT: sql`(${sql.join(Object.values(GAP_CONDITIONS), sql` OR `)})`,
};

const isStage = (value: string): value is ProductStage =>
  PRODUCT_STAGES.some((stage) => stage === value);
const isMissing = (value: string): value is ProductMissing =>
  PRODUCT_MISSING.some((kind) => kind === value);

/**
 * The catalog's answers to segment conditions (ADR-0049 #3): the ascending ids of the products
 * that match one positive condition on catalog data (`search`, `category` with its subtree,
 * `stage`, `createdAt`, `updatedAt`, `missing`). The segments module combines them with the other
 * owners' answers; inactive products are included unless the stage narrows them.
 */
@Injectable()
export class ProductFiltersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Every product: the universe a negative condition subtracts from. */
  allIds(executor: Db | Tx = this.db): Promise<number[]> {
    return this.ids(sql`true`, executor);
  }

  /** The products a catalog condition keeps; an unknown field or operator keeps none. */
  idsWhere(condition: SegmentCondition, executor: Db | Tx = this.db): Promise<number[]> {
    const where = this.where(condition);
    return where ? this.ids(where, executor) : Promise.resolve([]);
  }

  private where(condition: SegmentCondition): SQL | null {
    switch (condition.field) {
      case 'search':
        return condition.text ? (productSearch(condition.text)?.match ?? null) : null;
      case 'category':
        return condition.ids?.length
          ? sql`${products.categoryId} IN (
              WITH RECURSIVE down(id) AS (
                SELECT id FROM ${categories} WHERE ${idIn(categories.id, condition.ids)}
                UNION ALL
                SELECT c.id FROM ${categories} c JOIN down ON c.parent_id = down.id
              )
              SELECT id FROM down)`
          : null;
      case 'stage':
        return (
          or(...(condition.values ?? []).filter(isStage).map((stage) => STAGES[stage])) ?? null
        );
      case 'createdAt':
        return onBusinessDays(products.createdAt, conditionDays(condition, businessDate()));
      case 'updatedAt':
        return onBusinessDays(products.updatedAt, conditionDays(condition, businessDate()));
      case 'missing': {
        const kind = condition.values?.[0];
        return kind !== undefined && isMissing(kind) ? MISSING[kind] : null;
      }
      default:
        return null;
    }
  }

  private async ids(where: SQL, executor: Db | Tx): Promise<number[]> {
    const rows = await executor
      .select({ id: products.id })
      .from(products)
      .where(where)
      .orderBy(asc(products.id));
    return rows.map((row) => row.id);
  }
}
