import { Inject, Injectable } from '@nestjs/common';
import { ownRange, type RangedCategory, rangeConflict } from '@tugeel/shared/catalog';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { categories, products } from '../schema';
import { invalid, notFound } from './support';

export type Category = typeof categories.$inferSelect;
export type CategoryView = Category & { productCount: number; childCount: number };

export interface CategoryInput {
  parentId?: number | null;
  name: string;
  defaultClassificationCode?: string | null;
  /** The category's block of product codes, both ends or neither (ADR-0044 #1). */
  skuFrom?: string | null;
  skuTo?: string | null;
}

export type CategoryPatch = Partial<CategoryInput>;

/** Deepest allowed level of the tree (root = 1). */
export const MAX_CATEGORY_DEPTH = 8;

/** pg_advisory_xact_lock key serialising tree moves, so two moves cannot form a cycle together. */
const CATEGORY_TREE_LOCK = 72_026_104;

/**
 * The category tree (SPEC §5.2): moves never create a cycle; only empty categories are deleted.
 * Code ranges stay laminar (ADR-0044 #1): two ranges that meet are nested, the outer one an
 * ancestor's; a range change or a move is checked against every range under the tree lock.
 */
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** The whole tree as a flat list (a few hundred rows); clients nest it by parentId. */
  async list(): Promise<CategoryView[]> {
    const rows = await this.db
      .select({
        category: categories,
        // Raw, fully qualified subqueries: Drizzle renders single-table columns unqualified.
        productCount: sql<number>`(SELECT count(*)::int FROM products p WHERE p.category_id = categories.id)`,
        childCount: sql<number>`(SELECT count(*)::int FROM categories child WHERE child.parent_id = categories.id)`,
      })
      .from(categories)
      .orderBy(asc(categories.name), asc(categories.id));
    return rows.map((row) => ({
      ...row.category,
      productCount: row.productCount,
      childCount: row.childCount,
    }));
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<Category> {
    const [row] = await executor.select().from(categories).where(eq(categories.id, id));
    if (!row) throw notFound('category', id);
    return row;
  }

  /** The ids of a category and every category below it. */
  async subtreeIds(id: number, executor: Db | Tx = this.db): Promise<number[]> {
    const result = await executor.execute<{ id: string | number }>(sql`
      WITH RECURSIVE down(id) AS (
        SELECT id FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id FROM categories c JOIN down ON c.parent_id = down.id
      )
      SELECT id FROM down`);
    return result.rows.map((row) => Number.parseInt(String(row.id), 10));
  }

  create(actor: Actor, input: CategoryInput): Promise<Category> {
    return inTransaction(this.db, async (tx) => {
      const parentId = input.parentId ?? null;
      const range = rangeOf(input);
      if (parentId !== null) {
        await this.get(parentId, tx);
        if ((await this.depthOf(tx, parentId)) + 1 > MAX_CATEGORY_DEPTH) {
          throw invalid(
            'parentId',
            'maxDepth',
            `categories nest at most ${MAX_CATEGORY_DEPTH} levels`,
          );
        }
      }
      const name = normalizeName(input.name);
      const [row] = await tx
        .insert(categories)
        .values({
          parentId,
          name,
          nameKey: nameKey(name),
          defaultClassificationCode: input.defaultClassificationCode ?? null,
          skuFrom: range.skuFrom,
          skuTo: range.skuTo,
        })
        .returning();
      if (!row) throw new Error('category insert returned no row');
      if (range.skuFrom !== null) await this.assertRanges(tx, row.id);
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'categories',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  update(actor: Actor, id: number, patch: CategoryPatch): Promise<Category> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const moving = patch.parentId !== undefined && patch.parentId !== before.parentId;
      if (moving) await this.assertMove(tx, id, patch.parentId ?? null);
      const ranging = patch.skuFrom !== undefined || patch.skuTo !== undefined;
      const range = ranging
        ? rangeOf({ skuFrom: patch.skuFrom ?? null, skuTo: patch.skuTo ?? null })
        : null;
      const name = patch.name === undefined ? undefined : normalizeName(patch.name);
      const [row] = await tx
        .update(categories)
        .set({
          ...(name === undefined ? {} : { name, nameKey: nameKey(name) }),
          ...(moving ? { parentId: patch.parentId ?? null } : {}),
          ...(patch.defaultClassificationCode === undefined
            ? {}
            : { defaultClassificationCode: patch.defaultClassificationCode }),
          ...(range ? { skuFrom: range.skuFrom, skuTo: range.skuTo } : {}),
          updatedAt: sql`now()`,
        })
        .where(eq(categories.id, id))
        .returning();
      if (!row) throw notFound('category', id);
      if (moving || (range && range.skuFrom !== null)) await this.assertRanges(tx, id);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'categories',
        entityId: id,
        before,
        after: row,
      });
      return row;
    });
  }

  remove(actor: Actor, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const before = await this.get(id, tx);
      const [child] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.parentId, id))
        .limit(1);
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(eq(products.categoryId, id))
        .limit(1);
      if (child || product) {
        throw new AppError('CATEGORY_NOT_EMPTY', `category ${id} has children or products`, { id });
      }
      await tx.delete(categories).where(eq(categories.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'categories',
        entityId: id,
        before,
      });
    });
  }

  /**
   * The tree's ranges after a change of `changedId` (its range, or a move of its subtree) must
   * stay laminar; SKU_RANGE_OVERLAP names the category it collides with. Runs after the write,
   * inside the transaction, under the tree lock.
   */
  private async assertRanges(tx: Tx, changedId: number): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CATEGORY_TREE_LOCK})`);
    const all: RangedCategory[] = await tx
      .select({
        id: categories.id,
        parentId: categories.parentId,
        name: categories.name,
        skuFrom: categories.skuFrom,
        skuTo: categories.skuTo,
      })
      .from(categories);
    const conflict = rangeConflict(all);
    if (!conflict) return;
    const other = conflict.category.id === changedId ? conflict.other : conflict.category;
    const otherRange = ownRange(other);
    throw new AppError('SKU_RANGE_OVERLAP', `the code range meets category ${other.id}`, {
      category: other.name,
      from: otherRange?.from.toString() ?? '',
      to: otherRange?.to.toString() ?? '',
    });
  }

  /** Refuses a move under the category itself or its descendants, or deeper than the limit. */
  private async assertMove(tx: Tx, id: number, parentId: number | null): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${CATEGORY_TREE_LOCK})`);
    if (parentId === null) return;
    await this.get(parentId, tx);
    const subtree = await this.subtreeIds(id, tx);
    if (subtree.includes(parentId)) {
      throw new AppError('CATEGORY_CYCLE', `category ${parentId} is inside ${id}`, {
        id,
        parentId,
      });
    }
    const height = await this.heightOf(tx, id);
    if ((await this.depthOf(tx, parentId)) + height > MAX_CATEGORY_DEPTH) {
      throw invalid('parentId', 'maxDepth', `categories nest at most ${MAX_CATEGORY_DEPTH} levels`);
    }
  }

  /** Level of a category, the root being 1. */
  private async depthOf(tx: Tx, id: number): Promise<number> {
    const result = await tx.execute<{ depth: number }>(sql`
      WITH RECURSIVE up(id, parent_id, depth) AS (
        SELECT id, parent_id, 1 FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, c.parent_id, up.depth + 1 FROM categories c JOIN up ON c.id = up.parent_id
        WHERE up.depth < ${MAX_CATEGORY_DEPTH + 1}
      )
      SELECT max(depth)::int AS depth FROM up`);
    return result.rows[0]?.depth ?? 0;
  }

  /** Levels of the subtree below and including a category. */
  private async heightOf(tx: Tx, id: number): Promise<number> {
    const result = await tx.execute<{ height: number }>(sql`
      WITH RECURSIVE down(id, height) AS (
        SELECT id, 1 FROM categories WHERE id = ${id}
        UNION ALL
        SELECT c.id, down.height + 1 FROM categories c JOIN down ON c.parent_id = down.id
        WHERE down.height < ${MAX_CATEGORY_DEPTH + 1}
      )
      SELECT max(height)::int AS height FROM down`);
    return result.rows[0]?.height ?? 1;
  }
}

/** Both ends or neither, the first not above the last (the DTOs check the digit format). */
function rangeOf(input: { skuFrom?: string | null; skuTo?: string | null }): {
  skuFrom: string | null;
  skuTo: string | null;
} {
  const from = input.skuFrom ?? null;
  const to = input.skuTo ?? null;
  if ((from === null) !== (to === null)) {
    throw invalid(from === null ? 'skuFrom' : 'skuTo', 'pair', 'a code range needs both ends');
  }
  if (from !== null && to !== null && BigInt(from) > BigInt(to)) {
    throw invalid('skuTo', 'order', 'the first code of a range is above the last');
  }
  return {
    skuFrom: from === null ? null : BigInt(from).toString(),
    skuTo: to === null ? null : BigInt(to).toString(),
  };
}
