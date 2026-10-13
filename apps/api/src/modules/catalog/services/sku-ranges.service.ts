import { Inject, Injectable } from '@nestjs/common';
import {
  checkSku,
  holesOf,
  lowestFree,
  nextAfter,
  ownRange,
  type RangedCategory,
  rangeOwner,
  SKU_MAX,
  type SkuRange,
} from '@tugeel/shared/catalog';
import { and, asc, ne, sql, type SQL } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError } from '../../../common/errors/app-error';
import { categories, products } from '../schema';

/** Two-key pg_advisory_xact_lock (this, hashtext of the number): one check of a number at a time. */
export const SKU_NUMBER_LOCK = 72_026_105;

/** The codes of every product, as numbers, inside a range and outside its holes. */
function codesIn(range: SkuRange, holes: readonly SkuRange[]): SQL {
  const value = sql`${products.sku}::numeric`;
  const inside = sql`${value} BETWEEN ${range.from.toString()}::numeric AND ${range.to.toString()}::numeric`;
  if (holes.length === 0) return inside;
  const inHoles = sql.join(
    holes.map(
      (hole) =>
        sql`${value} BETWEEN ${hole.from.toString()}::numeric AND ${hole.to.toString()}::numeric`,
    ),
    sql` OR `,
  );
  return sql`(${inside} AND NOT (${inHoles}))`;
}

/**
 * Product codes and category code ranges (ADR-0044 #1): the next code to suggest for a category,
 * and the check a typed code passes at registration, `POST /products` and a code change. Imports
 * keep the owner's codes as they are and never ask.
 */
@Injectable()
export class SkuRangesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Every category with its range (a few hundred rows). */
  async categories(executor: Db | Tx = this.db): Promise<RangedCategory[]> {
    return executor
      .select({
        id: categories.id,
        parentId: categories.parentId,
        name: categories.name,
        skuFrom: categories.skuFrom,
        skuTo: categories.skuTo,
      })
      .from(categories)
      .orderBy(asc(categories.id));
  }

  /**
   * The code to suggest for a new product of the category: past the largest code of its range
   * (its own or its nearest ancestor's), skipping subcategories' ranges, else the lowest free one;
   * without a range, past the largest code outside every range. SKU_RANGE_FULL when none is left.
   */
  async suggest(categoryId: number | undefined, executor: Db | Tx = this.db): Promise<string> {
    const all = await this.categories(executor);
    const owner = categoryId === undefined ? null : rangeOwner(all, categoryId);
    const range = (owner && ownRange(owner)) ?? { from: 1n, to: SKU_MAX };
    const holes = owner
      ? holesOf(all, range)
      : all.flatMap((category) => {
          const own = ownRange(category);
          return own ? [own] : [];
        });
    const [top] = await executor
      .select({ max: sql<string | null>`max(${products.sku}::numeric)::text` })
      .from(products)
      .where(codesIn(range, holes));
    const quick = nextAfter(range, holes, top?.max ? BigInt(top.max) : null);
    if (quick !== null) return quick.toString();
    const rows = await executor
      .select({ code: sql<string>`(${products.sku}::numeric)::text` })
      .from(products)
      .where(codesIn(range, holes));
    const free = lowestFree(range, holes, new Set(rows.map((row) => BigInt(row.code))));
    if (free === null) {
      throw new AppError('SKU_RANGE_FULL', 'no free code left in the range', {
        from: range.from.toString(),
        to: range.to.toString(),
      });
    }
    return free.toString();
  }

  /**
   * A typed code for a product of the category: inside the category's range and not in another
   * category's (SKU_OUT_OF_RANGE, SKU_RESERVED), and no other product has the same number (a
   * leading zero makes no new code: DUPLICATE_VALUE like the unique key).
   */
  async assertAllowed(tx: Tx, categoryId: number, sku: string, selfId?: number): Promise<void> {
    const verdict = checkSku(await this.categories(tx), categoryId, sku);
    if (!verdict.ok) {
      throw new AppError(
        verdict.problem === 'OUT_OF_RANGE' ? 'SKU_OUT_OF_RANGE' : 'SKU_RESERVED',
        `code ${sku} does not belong to category ${categoryId}`,
        {
          category: verdict.owner.name,
          from: verdict.range.from.toString(),
          to: verdict.range.to.toString(),
        },
      );
    }
    // "10000" and "010000" registered at once would both pass the check below: the number's lock
    // makes the second wait for the first and then see it.
    const number = BigInt(sku).toString();
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${SKU_NUMBER_LOCK}::int, hashtext(${number}))`,
    );
    const [twin] = await tx
      .select({ id: products.id })
      .from(products)
      .where(
        and(
          sql`${products.sku}::numeric = ${number}::numeric`,
          ...(selfId === undefined ? [] : [ne(products.id, selfId)]),
        ),
      )
      .limit(1);
    if (twin) {
      throw new AppError('DUPLICATE_VALUE', `code ${sku} is taken`, {
        constraint: 'products_sku_key',
      });
    }
  }
}
