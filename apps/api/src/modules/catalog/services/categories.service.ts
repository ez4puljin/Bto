import { Inject, Injectable } from '@nestjs/common';
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
}

export type CategoryPatch = Partial<CategoryInput>;

/** Deepest allowed level of the tree (root = 1). */
export const MAX_CATEGORY_DEPTH = 8;

/** pg_advisory_xact_lock key serialising tree moves, so two moves cannot form a cycle together. */
const CATEGORY_TREE_LOCK = 72_026_104;

/** The category tree (SPEC §5.2): moves never create a cycle; only empty categories are deleted. */
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
        })
        .returning();
      if (!row) throw new Error('category insert returned no row');
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
      const name = patch.name === undefined ? undefined : normalizeName(patch.name);
      const [row] = await tx
        .update(categories)
        .set({
          ...(name === undefined ? {} : { name, nameKey: nameKey(name) }),
          ...(moving ? { parentId: patch.parentId ?? null } : {}),
          ...(patch.defaultClassificationCode === undefined
            ? {}
            : { defaultClassificationCode: patch.defaultClassificationCode }),
          updatedAt: sql`now()`,
        })
        .where(eq(categories.id, id))
        .returning();
      if (!row) throw notFound('category', id);
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
