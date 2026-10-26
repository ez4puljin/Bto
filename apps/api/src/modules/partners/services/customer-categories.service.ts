import { Inject, Injectable } from '@nestjs/common';
import { nameKey, normalizeName } from '@tugeel/shared/text';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { customerCategories } from '../schema';

export const CUSTOMER_CATEGORY_NAME_MAX = 80;

export interface CustomerCategory {
  id: number;
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface CustomerCategoryInput {
  name: string;
  sortOrder?: number;
}

export type CustomerCategoryPatch = Partial<CustomerCategoryInput> & { active?: boolean };

const COLUMNS = {
  id: customerCategories.id,
  name: customerCategories.name,
  active: customerCategories.active,
  sortOrder: customerCategories.sortOrder,
};

function checkedName(text: string): string {
  const name = normalizeName(text);
  if (name.length === 0 || name.length > CUSTOMER_CATEGORY_NAME_MAX) {
    throw invalid('name', 'length', `1–${CUSTOMER_CATEGORY_NAME_MAX} characters`);
  }
  return name;
}

/**
 * Customer categories (ADR-0107): a flat list the office keeps (`partners.customers.manage`), the
 * Erkhet groups at the migration. Never deleted (customers name them); a retired one stays on its
 * customers and leaves the pickers. A taken name is DUPLICATE_VALUE `customer_categories_name_key_key`.
 */
@Injectable()
export class CustomerCategoriesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Every category, retired ones too, in the office's order. */
  list(executor: Db | Tx = this.db): Promise<CustomerCategory[]> {
    return executor
      .select(COLUMNS)
      .from(customerCategories)
      .orderBy(
        asc(customerCategories.sortOrder),
        asc(customerCategories.name),
        asc(customerCategories.id),
      );
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<CustomerCategory> {
    const [row] = await executor
      .select(COLUMNS)
      .from(customerCategories)
      .where(eq(customerCategories.id, id));
    if (!row) throw notFound('customer_category', id);
    return row;
  }

  /** Categories by name, compared by their search key (the import's «Ангилал» column). */
  async findByNames(names: readonly string[], executor: Db | Tx = this.db) {
    const keys = [...new Set(names.map((name) => nameKey(normalizeName(name))))].filter(Boolean);
    if (keys.length === 0) return [];
    return executor
      .select({ ...COLUMNS, nameKey: customerCategories.nameKey })
      .from(customerCategories)
      .where(inArray(customerCategories.nameKey, keys));
  }

  /**
   * An active category, share-locked so it cannot be retired while a customer takes it:
   * 422 at `field` for an unknown one, 409 CUSTOMER_CATEGORY_INACTIVE for a retired one.
   */
  async assertActive(tx: Tx, id: number, field = 'categoryId'): Promise<void> {
    const [row] = await tx
      .select({ active: customerCategories.active })
      .from(customerCategories)
      .where(eq(customerCategories.id, id))
      .for('share');
    if (!row) throw invalid(field, 'exists', `customer category ${id} does not exist`);
    if (!row.active) {
      throw new AppError('CUSTOMER_CATEGORY_INACTIVE', `customer category ${id} is retired`, {
        id,
      });
    }
  }

  create(actor: Actor, input: CustomerCategoryInput): Promise<CustomerCategory> {
    const name = checkedName(input.name);
    return inTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(customerCategories)
        .values({
          name,
          nameKey: nameKey(name),
          sortOrder: input.sortOrder ?? (await this.nextOrder(tx)),
        })
        .returning();
      if (!row) throw new Error('customer category insert returned no row');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'customer_categories',
        entityId: row.id,
        after: row,
      });
      return this.get(row.id, tx);
    });
  }

  update(actor: Actor, id: number, patch: CustomerCategoryPatch): Promise<CustomerCategory> {
    const name = patch.name === undefined ? undefined : checkedName(patch.name);
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(customerCategories)
        .where(eq(customerCategories.id, id))
        .for('update');
      if (!before) throw notFound('customer_category', id);
      const [after] = await tx
        .update(customerCategories)
        .set({
          ...(name === undefined ? {} : { name, nameKey: nameKey(name) }),
          ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
          ...(patch.active === undefined ? {} : { active: patch.active }),
          updatedAt: sql`now()`,
        })
        .where(eq(customerCategories.id, id))
        .returning();
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'customer_categories',
        entityId: id,
        before,
        after,
      });
      return this.get(id, tx);
    });
  }

  private async nextOrder(tx: Tx): Promise<number> {
    const [row] = await tx
      .select({ max: sql<number | null>`max(${customerCategories.sortOrder})` })
      .from(customerCategories);
    return (row?.max ?? 0) + 10;
  }
}
