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
import {
  type Actor,
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
} from '../../identity';
import { bins, productLocations } from '../schema';
import { advisoryLock, LOCKS } from './support';

type LocationRow = typeof productLocations.$inferSelect;

/** Rows per multi-row statement. */
const CHUNK = 1_000;

/** A product's location change in a bulk call; omitted fields stay as they are. */
export interface LocationChange {
  productId: number;
  /** A WHOLESALE warehouse as the product's home, or null for none. */
  homeWarehouseId?: number | null;
  /** The product's fixed shelf in a warehouse (null clears it). */
  fixedBin?: { warehouseId: number; binId: number | null };
}

/** Where a product lived before a bulk change. */
export interface LocationState {
  productId: number;
  homeWarehouseId: number | null;
  fixedBins: { warehouseId: number; binId: number }[];
}

const stateOf = (productId: number, fixedBins: LocationState['fixedBins']): LocationState => ({
  productId,
  homeWarehouseId: null,
  fixedBins,
});

/** Low-stock levels of a product in one warehouse in a bulk call; a null level stays as it is. */
export interface LevelChange {
  warehouseId: number;
  productId: number;
  minQty: Decimal | null;
  maxQty: Decimal | null;
}

/** A product's levels in a warehouse (null: none, or no location row). */
export interface LevelState {
  warehouseId: number;
  productId: number;
  minQty: Decimal | null;
  maxQty: Decimal | null;
}

/** Levels to put back where a bulk change left them untouched since (an import revert). */
export interface LevelRestore {
  warehouseId: number;
  productId: number;
  /** What the change set: a row whose levels differ now was edited since and stays. */
  expected: { minQty: Decimal | null; maxQty: Decimal | null };
  restore: { minQty: Decimal | null; maxQty: Decimal | null };
}

const levelKey = (warehouseId: number, productId: number) => `${warehouseId}:${productId}`;

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
    return this.ofProductIds([productId], executor);
  }

  /** The locations of several products with their shelf codes (the product list, ADR-0037). */
  async ofProductIds(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<ProductLocation[]> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return [];
    return this.select(executor, inArray(productLocations.productId, ids), [
      asc(productLocations.productId),
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

  /** Every location row of these products (home flags and fixed shelves). */
  async ofProducts(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<LocationRow[]> {
    const rows: LocationRow[] = [];
    const unique = [...new Set(productIds)];
    for (let start = 0; start < unique.length; start += CHUNK) {
      rows.push(
        ...(await executor
          .select()
          .from(productLocations)
          .where(inArray(productLocations.productId, unique.slice(start, start + CHUNK)))),
      );
    }
    return rows;
  }

  /**
   * Home warehouses and fixed shelves of many products in the caller's transaction (the product
   * import, ADR-0036 #3): the table is locked against concurrent location changes instead of one
   * advisory lock per product. Returns what each product had before, for a revert.
   */
  async setManyInTx(
    tx: Tx,
    actor: Actor,
    changes: readonly LocationChange[],
  ): Promise<Map<number, LocationState>> {
    const before = new Map<number, LocationState>();
    if (changes.length === 0) return before;
    await tx.execute(sql`LOCK TABLE product_locations IN SHARE ROW EXCLUSIVE MODE`);
    const productIds = [...new Set(changes.map((change) => change.productId))];
    for (const row of await this.ofProducts(productIds, tx)) {
      const state = before.get(row.productId) ?? stateOf(row.productId, []);
      if (row.isHome) state.homeWarehouseId = row.warehouseId;
      if (row.defaultBinId !== null) {
        state.fixedBins.push({ warehouseId: row.warehouseId, binId: row.defaultBinId });
      }
      before.set(row.productId, state);
    }
    for (const id of productIds) if (!before.has(id)) before.set(id, stateOf(id, []));

    const homes = changes.flatMap((change) =>
      change.homeWarehouseId === undefined
        ? []
        : [{ productId: change.productId, warehouseId: change.homeWarehouseId }],
    );
    const fixed = changes.flatMap((change) =>
      change.fixedBin === undefined ? [] : [{ productId: change.productId, ...change.fixedBin }],
    );
    await this.assertHomes(tx, homes);
    await this.assertShelves(tx, fixed);

    for (let start = 0; start < homes.length; start += CHUNK) {
      const part = homes.slice(start, start + CHUNK);
      // Clear old homes first: one home per product (partial unique index).
      await tx.execute(sql`
        UPDATE product_locations pl SET is_home = false, updated_at = now()
          FROM (VALUES ${sql.join(
            part.map((home) => sql`(${home.productId}::bigint, ${home.warehouseId}::bigint)`),
            sql`, `,
          )}) AS v (product_id, warehouse_id)
         WHERE pl.product_id = v.product_id AND pl.is_home
           AND pl.warehouse_id IS DISTINCT FROM v.warehouse_id`);
      const set = part.filter(
        (home): home is { productId: number; warehouseId: number } => home.warehouseId !== null,
      );
      if (set.length > 0) {
        await tx.execute(sql`
          INSERT INTO product_locations (warehouse_id, product_id, is_home)
          SELECT * FROM (VALUES ${sql.join(
            set.map((home) => sql`(${home.warehouseId}::bigint, ${home.productId}::bigint, true)`),
            sql`, `,
          )}) AS v (warehouse_id, product_id, is_home)
          ON CONFLICT (warehouse_id, product_id) DO UPDATE SET is_home = true, updated_at = now()`);
      }
    }
    for (let start = 0; start < fixed.length; start += CHUNK) {
      await tx.execute(sql`
        INSERT INTO product_locations (warehouse_id, product_id, default_bin_id)
        SELECT * FROM (VALUES ${sql.join(
          fixed
            .slice(start, start + CHUNK)
            .map(
              (entry) =>
                sql`(${entry.warehouseId}::bigint, ${entry.productId}::bigint, ${entry.binId}::bigint)`,
            ),
          sql`, `,
        )}) AS v (warehouse_id, product_id, default_bin_id)
        ON CONFLICT (warehouse_id, product_id)
          DO UPDATE SET default_bin_id = excluded.default_bin_id, updated_at = now()`);
    }
    await this.audit.recordMany(
      tx,
      actor,
      productIds.map((productId) => ({
        action: 'UPDATE',
        entity: 'product_locations',
        entityId: productId,
        before: before.get(productId),
        after: {
          home: homes.find((home) => home.productId === productId)?.warehouseId,
          fixedBins: fixed.filter((entry) => entry.productId === productId),
        },
      })),
    );
    return before;
  }

  /**
   * Low-stock levels of many products in the caller's transaction (the levels import, ADR-0039):
   * locked like `setManyInTx`; a null level keeps the stored one, so an import never clears a
   * level. The caller has checked the products, the home rule and min ≤ max (the table's CHECK
   * stays the last word). Returns the levels before, keyed `warehouseId:productId`.
   */
  async setLevelsManyInTx(
    tx: Tx,
    actor: Actor,
    changes: readonly LevelChange[],
  ): Promise<Map<string, LevelState>> {
    const before = new Map<string, LevelState>();
    if (changes.length === 0) return before;
    await tx.execute(sql`LOCK TABLE product_locations IN SHARE ROW EXCLUSIVE MODE`);
    for (const change of changes) {
      before.set(levelKey(change.warehouseId, change.productId), {
        warehouseId: change.warehouseId,
        productId: change.productId,
        minQty: null,
        maxQty: null,
      });
    }
    const productIds = [...new Set(changes.map((change) => change.productId))];
    for (const row of await this.ofProducts(productIds, tx)) {
      const state = before.get(levelKey(row.warehouseId, row.productId));
      if (state) Object.assign(state, { minQty: row.minQty, maxQty: row.maxQty });
    }
    for (let start = 0; start < changes.length; start += CHUNK) {
      await tx.execute(sql`
        INSERT INTO product_locations (warehouse_id, product_id, min_qty, max_qty)
        SELECT * FROM (VALUES ${sql.join(
          changes
            .slice(start, start + CHUNK)
            .map(
              (change) =>
                sql`(${change.warehouseId}::bigint, ${change.productId}::bigint, ${
                  change.minQty?.toFixed() ?? null
                }::numeric, ${change.maxQty?.toFixed() ?? null}::numeric)`,
            ),
          sql`, `,
        )}) AS v (warehouse_id, product_id, min_qty, max_qty)
        ON CONFLICT (warehouse_id, product_id) DO UPDATE SET
          min_qty = COALESCE(excluded.min_qty, product_locations.min_qty),
          max_qty = COALESCE(excluded.max_qty, product_locations.max_qty),
          updated_at = now()`);
    }
    await this.audit.recordMany(
      tx,
      actor,
      changes.map((change) => ({
        action: 'UPDATE',
        entity: 'product_locations',
        entityId: change.productId,
        before: before.get(levelKey(change.warehouseId, change.productId)),
        after: change,
      })),
    );
    return before;
  }

  /**
   * Puts levels back after a bulk change (an import revert): only where the row still holds what
   * the change set; a row left without home, shelf or levels is removed.
   */
  async restoreLevelsInTx(tx: Tx, actor: Actor, entries: readonly LevelRestore[]): Promise<void> {
    if (entries.length === 0) return;
    await tx.execute(sql`LOCK TABLE product_locations IN SHARE ROW EXCLUSIVE MODE`);
    const rows = new Map(
      (await this.ofProducts([...new Set(entries.map((entry) => entry.productId))], tx)).map(
        (row) => [levelKey(row.warehouseId, row.productId), row],
      ),
    );
    const same = (a: Decimal | null, b: Decimal | null) =>
      a === null || b === null ? a === b : a.equals(b);
    const restored: LevelRestore[] = [];
    for (const entry of entries) {
      const row = rows.get(levelKey(entry.warehouseId, entry.productId));
      if (!row) continue;
      if (!same(row.minQty, entry.expected.minQty) || !same(row.maxQty, entry.expected.maxQty)) {
        continue;
      }
      await tx
        .update(productLocations)
        .set({
          minQty: entry.restore.minQty,
          maxQty: entry.restore.maxQty,
          updatedAt: sql`now()`,
        })
        .where(eq(productLocations.id, row.id));
      if (
        !row.isHome &&
        row.defaultBinId === null &&
        entry.restore.minQty === null &&
        entry.restore.maxQty === null
      ) {
        await tx.delete(productLocations).where(eq(productLocations.id, row.id));
      }
      restored.push(entry);
    }
    await this.audit.recordMany(
      tx,
      actor,
      restored.map((entry) => ({
        action: 'UPDATE',
        entity: 'product_locations',
        entityId: entry.productId,
        before: { warehouseId: entry.warehouseId, ...entry.expected },
        after: { warehouseId: entry.warehouseId, ...entry.restore },
      })),
    );
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

  /** Home warehouses are wholesale ones (WAREHOUSE_KIND_NOT_ALLOWED otherwise). */
  private async assertHomes(
    tx: Tx,
    homes: readonly { warehouseId: number | null }[],
  ): Promise<void> {
    const ids = [
      ...new Set(homes.flatMap((home) => (home.warehouseId === null ? [] : [home.warehouseId]))),
    ];
    for (const id of ids) {
      const warehouse = await this.org.getWarehouse(id, tx);
      if (warehouse.kind !== 'WHOLESALE') {
        throw new AppError('WAREHOUSE_KIND_NOT_ALLOWED', 'a home warehouse is a wholesale one', {
          kind: warehouse.kind,
        });
      }
    }
  }

  /** Fixed shelves are active storage or picking shelves of their warehouse. */
  private async assertShelves(
    tx: Tx,
    entries: readonly { warehouseId: number; binId: number | null }[],
  ): Promise<void> {
    const ids = [
      ...new Set(entries.flatMap((entry) => (entry.binId === null ? [] : [entry.binId]))),
    ];
    const found = new Map<number, typeof bins.$inferSelect>();
    for (let start = 0; start < ids.length; start += CHUNK) {
      for (const bin of await tx
        .select()
        .from(bins)
        .where(inArray(bins.id, ids.slice(start, start + CHUNK)))) {
        found.set(bin.id, bin);
      }
    }
    for (const entry of entries) {
      if (entry.binId === null) continue;
      const bin = found.get(entry.binId);
      if (!bin || bin.warehouseId !== entry.warehouseId) {
        throw invalid('defaultBinId', 'warehouse', 'a bin of the same warehouse');
      }
      if (!(USER_BIN_TYPES as readonly string[]).includes(bin.type)) {
        throw invalid('defaultBinId', 'type', 'a storage or picking shelf');
      }
      if (bin.archivedAt) {
        throw new AppError('BIN_ARCHIVED', `bin ${bin.id} is archived`, { code: bin.code });
      }
    }
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
