import { Inject, Injectable } from '@nestjs/common';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { eq, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { supplierCategories, suppliers } from '../schema';

export const SUPPLIER_CATEGORY_NAME_MAX = 80;

type CategoryRow = typeof supplierCategories.$inferSelect;

/** A category as the screens read it: in tree order, with where it sits and what it holds. */
export interface SupplierCategory {
  id: number;
  parentId: number | null;
  name: string;
  /** «Хүнс / Сүүн бүтээгдэхүүн», from the top. */
  path: string;
  /** 0 at the top. */
  depth: number;
  active: boolean;
  sortOrder: number;
  /** Suppliers in it and in everything below it. */
  supplierCount: number;
}

export interface SupplierCategoryInput {
  name: string;
  parentId?: number | null;
  sortOrder?: number;
}

export type SupplierCategoryPatch = Partial<SupplierCategoryInput> & { active?: boolean };

function checkedName(text: string): string {
  const name = normalizeName(text);
  if (name.length === 0 || name.length > SUPPLIER_CATEGORY_NAME_MAX) {
    throw invalid('name', 'length', `1–${SUPPLIER_CATEGORY_NAME_MAX} characters`);
  }
  return name;
}

/**
 * Supplier categories (ADR-0161): a tree the owner keeps (`partners.suppliers.manage`), a name
 * unique among its siblings. Never deleted (suppliers name them); a retired one stays on its
 * suppliers and leaves the pickers, and it retires only once nothing active sits below it.
 */
@Injectable()
export class SupplierCategoriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Every category, retired ones too, parents before their children, siblings in their order. */
  async list(executor: Db | Tx = this.db): Promise<SupplierCategory[]> {
    const rows = await executor.select().from(supplierCategories);
    const counted = await executor
      .select({ categoryId: suppliers.categoryId, count: sql<number>`count(*)::int` })
      .from(suppliers)
      .groupBy(suppliers.categoryId);
    const own = new Map(counted.map((row) => [row.categoryId, row.count]));
    const children = new Map<number | null, CategoryRow[]>();
    for (const row of rows) {
      children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
    }
    const ordered: SupplierCategory[] = [];
    const walk = (parentId: number | null, prefix: string, depth: number): number => {
      const siblings = [...(children.get(parentId) ?? [])].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id - b.id,
      );
      let total = 0;
      for (const row of siblings) {
        const path = prefix ? `${prefix} / ${row.name}` : row.name;
        const entry: SupplierCategory = {
          id: row.id,
          parentId: row.parentId,
          name: row.name,
          path,
          depth,
          active: row.active,
          sortOrder: row.sortOrder,
          supplierCount: 0,
        };
        ordered.push(entry);
        entry.supplierCount = (own.get(row.id) ?? 0) + walk(row.id, path, depth + 1);
        total += entry.supplierCount;
      }
      return total;
    };
    walk(null, '', 0);
    return ordered;
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<SupplierCategory> {
    const found = (await this.list(executor)).find((category) => category.id === id);
    if (!found) throw notFound('supplier_category', id);
    return found;
  }

  /** Each category's path, for rows that name one. */
  async pathsOf(executor: Db | Tx = this.db): Promise<Map<number, string>> {
    return new Map((await this.list(executor)).map((category) => [category.id, category.path]));
  }

  /**
   * An active category, share-locked so it cannot be retired while something takes it: 422 at
   * `field` for an unknown one, 409 SUPPLIER_CATEGORY_INACTIVE for a retired one.
   */
  async assertActive(tx: Tx, id: number, field = 'categoryId'): Promise<void> {
    const [row] = await tx
      .select({ active: supplierCategories.active })
      .from(supplierCategories)
      .where(eq(supplierCategories.id, id))
      .for('share');
    if (!row) throw invalid(field, 'exists', `supplier category ${id} does not exist`);
    if (!row.active) {
      throw new AppError('SUPPLIER_CATEGORY_INACTIVE', `supplier category ${id} is retired`, {
        id,
      });
    }
  }

  create(actor: Actor, input: SupplierCategoryInput): Promise<SupplierCategory> {
    const name = checkedName(input.name);
    const parentId = input.parentId ?? null;
    return inTransaction(this.db, async (tx) => {
      if (parentId !== null) await this.assertActive(tx, parentId, 'parentId');
      const [row] = await tx
        .insert(supplierCategories)
        .values({
          name,
          nameKey: nameKey(name),
          parentId,
          sortOrder: input.sortOrder ?? (await this.nextOrder(tx, parentId)),
        })
        .returning();
      if (!row) throw new Error('supplier category insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'supplier_categories',
        entityId: row.id,
        after: row,
      });
      return this.get(row.id, tx);
    });
  }

  update(actor: Actor, id: number, patch: SupplierCategoryPatch): Promise<SupplierCategory> {
    const name = patch.name === undefined ? undefined : checkedName(patch.name);
    return inTransaction(this.db, async (tx) => {
      // The whole tree is locked: a move and a move at once could otherwise close a circle.
      const rows = await tx.select().from(supplierCategories).for('update');
      const before = rows.find((row) => row.id === id);
      if (!before) throw notFound('supplier_category', id);
      const parentId = patch.parentId === undefined ? before.parentId : patch.parentId;
      if (parentId !== before.parentId) this.assertNoCircle(rows, id, parentId);
      const active = patch.active ?? before.active;
      if (!active && before.active) {
        if (rows.some((row) => row.parentId === id && row.active)) {
          throw new AppError(
            'SUPPLIER_CATEGORY_HAS_CHILDREN',
            `supplier category ${id} has active categories below it`,
            { id },
          );
        }
      }
      // A category moved or brought back needs a live parent; one already there keeps it.
      if (parentId !== null && active && (parentId !== before.parentId || !before.active)) {
        await this.assertActive(tx, parentId, 'parentId');
      }
      const [after] = await tx
        .update(supplierCategories)
        .set({
          ...(name === undefined ? {} : { name, nameKey: nameKey(name) }),
          ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
          parentId,
          active,
          updatedAt: sql`now()`,
        })
        .where(eq(supplierCategories.id, id))
        .returning();
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'supplier_categories',
        entityId: id,
        before,
        after,
      });
      return this.get(id, tx);
    });
  }

  /** The new parent must not be the category itself or anything below it. */
  private assertNoCircle(rows: readonly CategoryRow[], id: number, parentId: number | null): void {
    const parents = new Map(rows.map((row) => [row.id, row.parentId]));
    let at = parentId;
    while (at !== null) {
      if (at === id) throw invalid('parentId', 'circle', 'a category cannot sit below itself');
      at = parents.get(at) ?? null;
    }
  }

  private async nextOrder(tx: Tx, parentId: number | null): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${supplierCategories.sortOrder})` })
      .from(supplierCategories)
      .where(
        parentId === null
          ? isNull(supplierCategories.parentId)
          : eq(supplierCategories.parentId, parentId),
      );
    return (row?.max ?? 0) + 10;
  }
}
