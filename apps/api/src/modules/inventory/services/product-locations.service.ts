import { Inject, Injectable } from '@nestjs/common';
import { USER_BIN_TYPES } from '@tugeel/shared/inventory';
import type { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, gt, inArray, ne, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService } from '../../catalog';
import { type AuthContext, AuditService, OrgService, ScopeService } from '../../identity';
import { bins, productLocations } from '../schema';
import { advisoryLock, LOCKS } from './support';

type LocationRow = typeof productLocations.$inferSelect;

export interface ProductLocation extends LocationRow {
  /** Code of the fixed bin, for display and scanning. */
  defaultBinCode: string | null;
}

export interface LocationInput {
  warehouseId: number;
  productId: number;
  defaultBinId?: number | null;
  minQty?: Decimal | null;
  maxQty?: Decimal | null;
}

/**
 * Where products live (owner, 2026-10-11): one home warehouse per product — the only wholesale
 * warehouse it may be received into (ADR-0033) — and its fixed shelf and low-stock levels per
 * warehouse. Warehouse staff set fixed shelves (`inventory.locations.manage`); the home warehouse is
 * set up by an admin or the import (`inventory.setup.manage`).
 */
@Injectable()
export class ProductLocationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
  ) {}

  async ofProduct(productId: number, executor: Db | Tx = this.db): Promise<ProductLocation[]> {
    return this.select(executor, eq(productLocations.productId, productId), [
      asc(productLocations.warehouseId),
    ]);
  }

  async ofWarehouse(query: {
    warehouseId: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: ProductLocation[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(productLocations.warehouseId, query.warehouseId)];
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(gt(productLocations.id, after.id));
    const rows = await this.select(this.db, and(...filters), [asc(productLocations.id)], limit + 1);
    return toPage(rows, limit, (row) => ({ id: row.id }));
  }

  /** productId → home warehouse id, for the products that have one. */
  async homeOf(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({ productId: productLocations.productId, warehouseId: productLocations.warehouseId })
      .from(productLocations)
      .where(
        and(
          inArray(productLocations.productId, [...productIds]),
          eq(productLocations.isHome, true),
        ),
      );
    return new Map(rows.map((row) => [row.productId, row.warehouseId]));
  }

  /** productId → fixed bin in a warehouse, for the products that have one there. */
  async defaultBinOf(
    warehouseId: number,
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Map<number, number>> {
    if (productIds.length === 0) return new Map();
    const rows = await executor
      .select({ productId: productLocations.productId, binId: productLocations.defaultBinId })
      .from(productLocations)
      .where(
        and(
          eq(productLocations.warehouseId, warehouseId),
          inArray(productLocations.productId, [...productIds]),
        ),
      );
    return new Map(
      rows.flatMap((row) => (row.binId === null ? [] : [[row.productId, row.binId] as const])),
    );
  }

  /**
   * PRODUCT_NOT_IN_WAREHOUSE when a product with a home warehouse is brought into another WHOLESALE
   * warehouse (ADR-0033 #2). Stores, vehicles and TRANSIT are never restricted.
   */
  async assertMayReceive(
    tx: Db | Tx,
    warehouseId: number,
    productIds: readonly number[],
  ): Promise<void> {
    const warehouse = await this.org.getWarehouse(warehouseId, tx);
    if (warehouse.kind !== 'WHOLESALE') return;
    const homes = await this.homeOf(productIds, tx);
    for (const [productId, home] of homes) {
      if (home === warehouseId) continue;
      const homeWarehouse = await this.org.getWarehouse(home, tx);
      throw new AppError(
        'PRODUCT_NOT_IN_WAREHOUSE',
        `product ${productId} lives in ${homeWarehouse.code}`,
        {
          productId,
          warehouse: homeWarehouse.name,
        },
      );
    }
  }

  /** The fixed shelf and levels of a product in one warehouse (created on first use). */
  async set(ctx: AuthContext, input: LocationInput): Promise<ProductLocation> {
    this.scope.assertCanWriteWarehouse(ctx, input.warehouseId);
    return inTransaction(this.db, async (tx) => {
      await this.assertProduct(input.productId, tx);
      await this.assertMayReceive(tx, input.warehouseId, [input.productId]);
      if (input.defaultBinId !== undefined && input.defaultBinId !== null) {
        await this.assertShelf(tx, input.warehouseId, input.defaultBinId);
      }
      if (input.minQty && input.maxQty && input.minQty.gt(input.maxQty)) {
        throw invalid('maxQty', 'range', 'the maximum is below the minimum');
      }
      const before = await this.find(tx, input.warehouseId, input.productId);
      const values = {
        ...(input.defaultBinId === undefined ? {} : { defaultBinId: input.defaultBinId }),
        ...(input.minQty === undefined ? {} : { minQty: input.minQty }),
        ...(input.maxQty === undefined ? {} : { maxQty: input.maxQty }),
      };
      await tx
        .insert(productLocations)
        .values({ warehouseId: input.warehouseId, productId: input.productId, ...values })
        .onConflictDoUpdate({
          target: [productLocations.warehouseId, productLocations.productId],
          set: { ...values, updatedAt: sql`now()` },
        });
      const after = await this.find(tx, input.warehouseId, input.productId);
      if (!after) throw new Error('product location upsert returned no row');
      await this.audit.record(tx, ctx, {
        action: before ? 'UPDATE' : 'CREATE',
        entity: 'product_locations',
        entityId: after.id,
        before,
        after,
      });
      return after;
    });
  }

  /** Makes a WHOLESALE warehouse the product's home (null: no home); one home per product. */
  async setHome(
    ctx: AuthContext,
    productId: number,
    warehouseId: number | null,
  ): Promise<ProductLocation[]> {
    if (warehouseId !== null) this.scope.assertCanWriteWarehouse(ctx, warehouseId);
    return inTransaction(this.db, async (tx) => {
      await this.assertProduct(productId, tx);
      await advisoryLock(tx, LOCKS.productHome, productId);
      if (warehouseId !== null) {
        const warehouse = await this.org.getWarehouse(warehouseId, tx);
        if (warehouse.kind !== 'WHOLESALE') {
          throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'a home warehouse is a wholesale one', {
            kind: warehouse.kind,
          });
        }
      }
      const before = await this.ofProduct(productId, tx);
      await tx
        .update(productLocations)
        .set({ isHome: false, updatedAt: sql`now()` })
        .where(
          and(
            eq(productLocations.productId, productId),
            eq(productLocations.isHome, true),
            ...(warehouseId === null ? [] : [ne(productLocations.warehouseId, warehouseId)]),
          ),
        );
      if (warehouseId !== null) {
        await tx
          .insert(productLocations)
          .values({ warehouseId, productId, isHome: true })
          .onConflictDoUpdate({
            target: [productLocations.warehouseId, productLocations.productId],
            set: { isHome: true, updatedAt: sql`now()` },
          });
      }
      const after = await this.ofProduct(productId, tx);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'product_locations',
        entityId: productId,
        before: { productId, home: before.find((row) => row.isHome)?.warehouseId ?? null },
        after: { productId, home: warehouseId },
      });
      return after;
    });
  }

  remove(ctx: AuthContext, id: number): Promise<void> {
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx
        .select()
        .from(productLocations)
        .where(eq(productLocations.id, id))
        .for('update');
      if (!before) throw notFound('product location', id);
      this.scope.assertCanWriteWarehouse(ctx, before.warehouseId);
      await tx.delete(productLocations).where(eq(productLocations.id, id));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'product_locations',
        entityId: id,
        before,
      });
    });
  }

  private async find(tx: Tx, warehouseId: number, productId: number) {
    const [row] = await this.select(
      tx,
      and(eq(productLocations.warehouseId, warehouseId), eq(productLocations.productId, productId)),
      [],
    );
    return row ?? null;
  }

  private async select(
    executor: Db | Tx,
    where: SQL | undefined,
    order: SQL[],
    limit?: number,
  ): Promise<ProductLocation[]> {
    const query = executor
      .select({ location: productLocations, defaultBinCode: bins.code })
      .from(productLocations)
      .leftJoin(bins, eq(bins.id, productLocations.defaultBinId))
      .where(where)
      .orderBy(...order);
    const rows = limit === undefined ? await query : await query.limit(limit);
    return rows.map((row) => ({ ...row.location, defaultBinCode: row.defaultBinCode }));
  }

  private async assertProduct(productId: number, executor: Db | Tx): Promise<void> {
    const [product] = await this.catalog.getMany([productId], executor);
    if (!product) throw notFound('product', productId);
  }

  /** A fixed bin is an active shelf of the same warehouse. */
  private async assertShelf(tx: Tx, warehouseId: number, binId: number): Promise<void> {
    const [bin] = await tx.select().from(bins).where(eq(bins.id, binId));
    if (!bin || bin.warehouseId !== warehouseId) {
      throw invalid('defaultBinId', 'warehouse', 'a bin of the same warehouse');
    }
    if (!(USER_BIN_TYPES as readonly string[]).includes(bin.type)) {
      throw invalid('defaultBinId', 'type', 'a storage or picking shelf');
    }
    if (bin.archivedAt)
      throw new AppError('BIN_ARCHIVED', `bin ${binId} is archived`, { code: bin.code });
  }
}
