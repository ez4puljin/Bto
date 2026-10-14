import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { idIn } from '../../../common/db/days';
import { inTransaction } from '../../../common/db/transaction';
import { notFound } from '../../../common/errors/app-error';
import { type Actor, AuditService } from '../../identity';
import { categories, products } from '../schema';
import type { ProductStatus } from './products.service';

/** What a bulk change did (ADR-0051 #1). */
export interface BulkChange {
  changed: number[];
  unchanged: number[];
}

type LockedRow = { id: number; status: ProductStatus; categoryId: number };

/**
 * Bulk changes of ticked products that catalog owns (ADR-0051 #1): the status and the category.
 * The products are locked in id order, as every writer of several products locks them
 * (architecture §5.3); an unknown id refuses the whole request; each changed product gets one
 * audit row, and products that already were so are reported, not touched.
 */
@Injectable()
export class ProductBulkService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /**
   * «Идэвхгүй болгох / Идэвхжүүлэх»: the product form's meaning, so a reactivated product that still
   * waits for its prices keeps waiting (ADR-0044).
   */
  setStatus(
    actor: Actor,
    productIds: readonly number[],
    status: ProductStatus,
  ): Promise<BulkChange> {
    return inTransaction(this.db, async (tx) => {
      const rows = await this.lockRows(tx, productIds);
      return this.apply(
        tx,
        actor,
        rows,
        (row) => row.status === status,
        { status },
        (row) => ({
          status: row.status,
        }),
      );
    });
  }

  /** Moves products to another category; their codes stay (ADR-0044 #1). */
  setCategory(
    actor: Actor,
    productIds: readonly number[],
    categoryId: number,
  ): Promise<BulkChange> {
    return inTransaction(this.db, async (tx) => {
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.id, categoryId));
      if (!category) throw notFound('category', categoryId);
      const rows = await this.lockRows(tx, productIds);
      return this.apply(
        tx,
        actor,
        rows,
        (row) => row.categoryId === categoryId,
        { categoryId },
        (row) => ({ categoryId: row.categoryId }),
      );
    });
  }

  /** The products under FOR UPDATE in id order; 404 for the first unknown id. */
  private async lockRows(tx: Tx, productIds: readonly number[]): Promise<LockedRow[]> {
    const ids = [...new Set(productIds)].sort((a, b) => a - b);
    const rows = await tx
      .select({ id: products.id, status: products.status, categoryId: products.categoryId })
      .from(products)
      .where(idIn(products.id, ids))
      .orderBy(asc(products.id))
      .for('update');
    const found = new Set(rows.map((row) => row.id));
    const missing = ids.find((id) => !found.has(id));
    if (missing !== undefined) throw notFound('product', missing);
    return rows;
  }

  private async apply(
    tx: Tx,
    actor: Actor,
    rows: readonly LockedRow[],
    already: (row: LockedRow) => boolean,
    change: { status: ProductStatus } | { categoryId: number },
    before: (row: LockedRow) => Record<string, unknown>,
  ): Promise<BulkChange> {
    const changing = rows.filter((row) => !already(row));
    if (changing.length > 0) {
      await tx
        .update(products)
        .set({ ...change, updatedAt: sql`now()` })
        .where(
          idIn(
            products.id,
            changing.map((row) => row.id),
          ),
        );
      await this.audit.recordMany(
        tx,
        actor,
        changing.map((row) => ({
          action: 'UPDATE',
          entity: 'products',
          entityId: row.id,
          before: before(row),
          after: change,
        })),
      );
    }
    return {
      changed: changing.map((row) => row.id),
      unchanged: rows.filter(already).map((row) => row.id),
    };
  }
}
