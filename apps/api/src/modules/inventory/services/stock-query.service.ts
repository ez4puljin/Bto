import type { SegmentCondition } from '@tugeel/shared/segments';
import { Inject, Injectable } from '@nestjs/common';
import { COST_SCALE, valueOf } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { and, desc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import { idIn } from '../../../common/db/days';
import { OrgService } from '../../identity';
import type { Db, Tx } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import {
  DEFAULT_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  toPage,
} from '../../../common/pagination/page';
import { CatalogService, type ProductSummary, UnitConversionService } from '../../catalog';
import {
  binStock,
  bins,
  RECONCILIATION_STATUSES,
  reconciliationRuns,
  warehouseStock,
} from '../schema';
import { type Bin, BinsService } from './bins.service';
import {
  type LedgerMovement,
  type MovementQuery,
  type ReconciliationDiff,
  StockPostingService,
} from './stock-posting.service';

const ZERO = new Decimal(0);
/** Reads of one low-stock page at most: inactive products in a row cannot stall a page forever. */
const LOW_STOCK_ROUNDS = 5;

export interface StockQuery {
  q?: string;
  categoryId?: number;
  /** The quantities shown are this warehouse's (default: all warehouses). */
  warehouseId?: number;
  /** Without a search: only products with stock, by product id. */
  inStock?: boolean;
  cursor?: string;
  limit?: number;
}

/** A product's balance in one warehouse (lots summed). Costs are for cost holders only. */
export interface WarehouseBalance {
  warehouseId: number;
  onHand: Decimal;
  sellableOnHand: Decimal;
  reserved: Decimal;
  /** sellable − reserved, never below 0. */
  available: Decimal;
  avgCost: Decimal;
  value: Decimal;
}

export interface ProductStock {
  product: ProductSummary;
  onHand: Decimal;
  available: Decimal;
  value: Decimal;
  warehouses: WarehouseBalance[];
}

export interface BinBalance {
  binId: number;
  binCode: string;
  binType: string;
  sellable: boolean;
  lotId: number | null;
  onHand: Decimal;
}

export interface ProductStockDetail extends ProductStock {
  bins: (BinBalance & { warehouseId: number })[];
}

export interface BinContent {
  bin: Bin;
  lines: { product: ProductSummary; lotId: number | null; onHand: Decimal }[];
}

/** A movement with its product and the name of the unit it was entered in. */
export interface StockMovement extends LedgerMovement {
  product: ProductSummary;
  unitName: string;
}

/** Why a product is on the low-stock list (ADR-0039): out of stock, or at or below its minimum. */
export type LowStockStatus = 'OUT' | 'LOW';

/** A row of the low-stock list of one warehouse. */
export interface LowStockRow {
  product: ProductSummary;
  status: LowStockStatus;
  onHand: Decimal;
  minQty: Decimal | null;
  maxQty: Decimal | null;
  /** Up to the maximum (else the minimum); null when there is no level or nothing to add. */
  suggestedQty: Decimal | null;
  /** The product's home (wholesale) warehouse, where a store asks for it. */
  homeWarehouseId: number | null;
}

export interface ReconciliationSummary {
  id: number;
  status: (typeof RECONCILIATION_STATUSES)[number];
  diffCount: number;
  diffs: ReconciliationDiff[];
  startedAt: Date;
  triggeredBy: string;
}

/**
 * Stock reads for the screens (SPEC §5.4): balances by product, warehouse and bin, and the last
 * reconciliation. Products come from the catalog's search, so a stock search finds what the
 * catalog finds (names, SKUs, barcodes).
 */
/** Warehouses whose stock a segment's «any warehouse» counts: not transit, not vehicles. */
const SELLING_KINDS: readonly string[] = ['WHOLESALE', 'STORE'];

@Injectable()
export class StockQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bins: BinsService,
    private readonly catalog: CatalogService,
    private readonly posting: StockPostingService,
    private readonly units: UnitConversionService,
    private readonly org: OrgService,
  ) {}

  async overview(query: StockQuery): Promise<{ data: ProductStock[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const q = query.q?.trim();
    if (query.inStock && !q) return this.inStock(query, limit);
    const page = await this.catalog.search({
      ...(q ? { q } : {}),
      ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      limit,
    });
    const balances = await this.balances(
      page.data.map((product) => product.id),
      query.warehouseId,
    );
    return {
      data: page.data.map((product) => withTotals(product, balances.get(product.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async ofProduct(productId: number): Promise<ProductStockDetail> {
    const [product] = await this.catalog.getMany([productId]);
    if (!product) throw notFound('product', productId);
    const balances = (await this.balances([productId])).get(productId) ?? [];
    const rows = await this.db
      .select({
        warehouseId: binStock.warehouseId,
        binId: binStock.binId,
        binCode: bins.code,
        binType: bins.type,
        sellable: bins.sellable,
        lotId: binStock.lotId,
        onHand: binStock.onHand,
      })
      .from(binStock)
      .innerJoin(bins, eq(bins.id, binStock.binId))
      .where(and(eq(binStock.productId, productId), gt(binStock.onHand, ZERO)))
      .orderBy(binStock.warehouseId, bins.code, binStock.lotId);
    return { ...withTotals(product, balances), bins: rows };
  }

  /**
   * The on-hand base quantity of these products on one bin, lots summed, the rows locked FOR UPDATE
   * so two documents cannot both see the last units (the POS shortfall rule, ADR-0063 #5). A product
   * without a row is at 0.
   */
  async lockOnHandInBin(
    tx: Tx,
    binId: number,
    productIds: readonly number[],
  ): Promise<Map<number, Decimal>> {
    const result = new Map<number, Decimal>();
    if (productIds.length === 0) return result;
    const rows = await tx
      .select({ productId: binStock.productId, onHand: binStock.onHand })
      .from(binStock)
      .where(and(eq(binStock.binId, binId), idIn(binStock.productId, productIds)))
      .orderBy(binStock.productId, binStock.id)
      .for('update');
    for (const row of rows) {
      result.set(row.productId, (result.get(row.productId) ?? ZERO).plus(row.onHand));
    }
    return result;
  }

  async ofBin(binId: number): Promise<BinContent> {
    const bin = await this.bins.get(binId);
    const rows = await this.db
      .select({ productId: binStock.productId, lotId: binStock.lotId, onHand: binStock.onHand })
      .from(binStock)
      .where(and(eq(binStock.binId, binId), gt(binStock.onHand, ZERO)));
    const products = new Map(
      (await this.catalog.getMany([...new Set(rows.map((row) => row.productId))])).map(
        (product) => [product.id, product],
      ),
    );
    const lines = rows.flatMap((row) => {
      const product = products.get(row.productId);
      return product ? [{ product, lotId: row.lotId, onHand: row.onHand }] : [];
    });
    lines.sort((a, b) => a.product.name.localeCompare(b.product.name, 'mn'));
    return { bin, lines };
  }

  /**
   * The low-stock list of a warehouse (SPEC §8.2 #4, ADR-0039): products at or below their minimum
   * there, and products the warehouse held that are now out of stock even without a minimum. Out of
   * stock first, then by product. Inactive products are left out; a page is filled past them with
   * a few more reads.
   */
  async lowStock(query: {
    warehouseId: number;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: LowStockRow[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const start = decodeCursor(query.cursor);
    let after =
      typeof start?.rank === 'number' && typeof start.id === 'number'
        ? { rank: start.rank, id: start.id }
        : null;
    const data: LowStockRow[] = [];
    for (let round = 0; round < LOW_STOCK_ROUNDS; round += 1) {
      const need = limit - data.length;
      const rows = await this.lowStockRows(query.warehouseId, after, need + 1);
      const taken = rows.slice(0, need);
      data.push(...(await this.toLowStock(taken)));
      const last = taken.at(-1);
      if (!last || rows.length <= need) return { data, nextCursor: null };
      after = { rank: last.rank, id: Number.parseInt(last.product_id, 10) };
      if (data.length >= limit) break;
    }
    return { data, nextCursor: after ? encodeCursor(after) : null };
  }

  /** How many lines the low-stock list of a warehouse has, up to `cap` (the home tile). */
  async lowStockCount(warehouseId: number, cap: number): Promise<number> {
    return (await this.lowStock({ warehouseId, limit: cap })).data.length;
  }

  /** Rows of the low-stock list after a keyset position, raw. */
  private async lowStockRows(
    warehouseId: number,
    after: { rank: number; id: number } | null,
    take: number,
  ) {
    const keyset = after
      ? sql`WHERE (x.rank, x.product_id) > (${after.rank}::int, ${after.id}::bigint)`
      : sql``;
    const result = await this.db.execute<{
      product_id: string;
      on_hand: string;
      min_qty: string | null;
      max_qty: string | null;
      home_warehouse_id: string | null;
      rank: number;
    }>(sql`
      SELECT x.* FROM (
        SELECT p.product_id,
               COALESCE(s.on_hand, 0) AS on_hand,
               l.min_qty,
               l.max_qty,
               (SELECT h.warehouse_id FROM product_locations h
                 WHERE h.product_id = p.product_id AND h.is_home) AS home_warehouse_id,
               CASE WHEN COALESCE(s.on_hand, 0) = 0 THEN 0 ELSE 1 END AS rank
          FROM (SELECT pl.product_id FROM product_locations pl
                 WHERE pl.warehouse_id = ${warehouseId} AND pl.min_qty IS NOT NULL
                UNION
                SELECT ws.product_id FROM warehouse_stock ws
                 WHERE ws.warehouse_id = ${warehouseId}) p
          LEFT JOIN product_locations l
            ON l.warehouse_id = ${warehouseId} AND l.product_id = p.product_id
          LEFT JOIN (SELECT ws.product_id, sum(ws.on_hand) AS on_hand FROM warehouse_stock ws
                      WHERE ws.warehouse_id = ${warehouseId} GROUP BY ws.product_id) s
            ON s.product_id = p.product_id
         WHERE (l.min_qty IS NOT NULL AND COALESCE(s.on_hand, 0) <= l.min_qty)
            OR (l.min_qty IS NULL AND s.product_id IS NOT NULL AND s.on_hand = 0)
      ) x
      ${keyset}
      ORDER BY x.rank, x.product_id
      LIMIT ${take}`);
    return result.rows;
  }

  /** Raw low-stock rows with their products; inactive products dropped. */
  private async toLowStock(
    rows: readonly {
      product_id: string;
      on_hand: string;
      min_qty: string | null;
      max_qty: string | null;
      home_warehouse_id: string | null;
    }[],
  ): Promise<LowStockRow[]> {
    const products = new Map(
      (await this.catalog.getMany(rows.map((row) => Number.parseInt(row.product_id, 10)))).map(
        (product) => [product.id, product],
      ),
    );
    return rows.flatMap((row): LowStockRow[] => {
      const product = products.get(Number.parseInt(row.product_id, 10));
      if (product?.status !== 'ACTIVE') return [];
      const onHand = new Decimal(row.on_hand);
      const minQty = row.min_qty === null ? null : new Decimal(row.min_qty);
      const maxQty = row.max_qty === null ? null : new Decimal(row.max_qty);
      const target = maxQty ?? minQty;
      return [
        {
          product,
          status: onHand.isZero() ? 'OUT' : 'LOW',
          onHand,
          minQty,
          maxQty,
          suggestedQty: target?.gt(onHand) ? target.minus(onHand) : null,
          homeWarehouseId:
            row.home_warehouse_id === null ? null : Number.parseInt(row.home_warehouse_id, 10),
        },
      ];
    });
  }

  /**
   * Movement history (SPEC §8.2 #1): the ledger rows of StockPostingService with each row's product
   * and the unit its quantity was entered in. Costs are dropped by the controller for non-holders.
   */
  async movements(
    query: MovementQuery,
  ): Promise<{ data: StockMovement[]; nextCursor: string | null }> {
    const page = await this.posting.movements(query);
    const products = new Map(
      (await this.catalog.getMany([...new Set(page.data.map((row) => row.productId))])).map(
        (product) => [product.id, product],
      ),
    );
    const units = await this.units.describe([
      ...new Set(page.data.map((row) => row.productUnitId)),
    ]);
    return {
      data: page.data.flatMap((row) => {
        const product = products.get(row.productId);
        return product
          ? [{ ...row, product, unitName: units.get(row.productUnitId)?.uomName ?? '' }]
          : [];
      }),
      nextCursor: page.nextCursor,
    };
  }

  async latestReconciliation(): Promise<ReconciliationSummary | null> {
    const [run] = await this.db
      .select()
      .from(reconciliationRuns)
      .orderBy(desc(reconciliationRuns.id))
      .limit(1);
    if (!run) return null;
    return {
      id: run.id,
      status: run.status,
      diffCount: run.diffCount,
      diffs: run.diffs as ReconciliationDiff[],
      startedAt: run.startedAt,
      triggeredBy: run.triggeredBy,
    };
  }

  /**
   * Of these products, the ones holding stock anywhere (on hand or reserved), e.g. products an
   * import revert may not deactivate.
   */
  async productsWithStock(
    productIds: readonly number[],
    executor: Db | Tx = this.db,
  ): Promise<Set<number>> {
    const held = new Set<number>();
    const unique = [...new Set(productIds)];
    for (let start = 0; start < unique.length; start += 1_000) {
      const rows = await executor
        .selectDistinct({ productId: warehouseStock.productId })
        .from(warehouseStock)
        .where(
          and(
            inArray(warehouseStock.productId, unique.slice(start, start + 1_000)),
            sql`(${warehouseStock.onHand} <> 0 OR ${warehouseStock.reserved} <> 0)`,
          ),
        );
      for (const row of rows) held.add(row.productId);
    }
    return held;
  }

  /**
   * The products one segment condition on stock keeps, ascending (ADR-0049 #3): holding stock on
   * hand (`IN_STOCK`) or at or below their minimum (`AT_OR_BELOW_MIN`, ADR-0039's LOW rule), in
   * one warehouse or in any wholesale or store one (never transit or vehicles).
   */
  async productIdsWhere(
    condition: SegmentCondition,
    executor: Db | Tx = this.db,
  ): Promise<number[]> {
    if (condition.field !== 'stock') return [];
    const warehouses =
      condition.warehouseId !== undefined
        ? [condition.warehouseId]
        : (await this.org.listWarehouses())
            .filter((warehouse) => SELLING_KINDS.includes(warehouse.kind))
            .map((warehouse) => warehouse.id);
    if (warehouses.length === 0) return [];
    if (condition.op === 'IN_STOCK') {
      const rows = await executor
        .selectDistinct({ productId: warehouseStock.productId })
        .from(warehouseStock)
        .where(and(idIn(warehouseStock.warehouseId, warehouses), gt(warehouseStock.onHand, ZERO)))
        .orderBy(warehouseStock.productId);
      return rows.map((row) => row.productId);
    }
    if (condition.op !== 'AT_OR_BELOW_MIN') return [];
    const result = await executor.execute<{ product_id: string }>(sql`
      SELECT DISTINCT l.product_id
        FROM product_locations l
        LEFT JOIN (SELECT ws.warehouse_id, ws.product_id, sum(ws.on_hand) AS on_hand
                     FROM warehouse_stock ws GROUP BY ws.warehouse_id, ws.product_id) s
          ON s.warehouse_id = l.warehouse_id AND s.product_id = l.product_id
       WHERE l.min_qty IS NOT NULL AND COALESCE(s.on_hand, 0) <= l.min_qty
         AND ${idIn(sql`l.warehouse_id`, warehouses)}
       ORDER BY l.product_id`);
    return result.rows.map((row) => Number.parseInt(row.product_id, 10));
  }

  // -------------------------------------------------------------------------------------------

  /** Products holding stock (in one warehouse or any), paged by product id. */
  private async inStock(
    query: StockQuery,
    limit: number,
  ): Promise<{ data: ProductStock[]; nextCursor: string | null }> {
    const filters: SQL[] = [gt(warehouseStock.onHand, ZERO)];
    if (query.warehouseId) filters.push(eq(warehouseStock.warehouseId, query.warehouseId));
    const after = decodeCursor(query.cursor);
    if (typeof after?.productId === 'number') {
      filters.push(gt(warehouseStock.productId, after.productId));
    }
    const ids = await this.db
      .selectDistinct({ productId: warehouseStock.productId })
      .from(warehouseStock)
      .where(and(...filters))
      .orderBy(warehouseStock.productId)
      .limit(limit + 1);
    const page = toPage(ids, limit, (row) => ({ productId: row.productId }));
    const productIds = page.data.map((row) => row.productId);
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const balances = await this.balances(productIds, query.warehouseId);
    return {
      data: productIds.flatMap((id) => {
        const product = products.get(id);
        return product ? [withTotals(product, balances.get(id) ?? [])] : [];
      }),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Each product's outflow per warehouse over business dates `from` … `to` (ADR-0115): wholesale
   * sales less their returns, plus transfers to a supermarket, in base units.
   */
  outflowOf(
    productIds: readonly number[],
    from: string,
    to: string,
  ): Promise<Map<number, Map<number, Decimal>>> {
    return this.posting.outflow(productIds, from, to);
  }

  /** The outflow per calendar month (ADR-0118): product → warehouse → `YYYY-MM` → base quantity. */
  outflowByMonth(
    productIds: readonly number[],
    from: string,
    to: string,
  ): Promise<Map<number, Map<number, Map<string, Decimal>>>> {
    return this.posting.outflowByMonth(productIds, from, to);
  }

  /** Warehouse balances per product (warehouses holding or reserving none left out). */
  balancesOf(productIds: readonly number[]): Promise<Map<number, WarehouseBalance[]>> {
    return this.balances(productIds);
  }

  /**
   * The products with stock available in their home warehouse, ascending: sellable on hand, lots
   * summed, less what is reserved, as `balances()` counts it — the rep app's «in stock» filter,
   * the same quantity its shop shows (ADR-0068).
   */
  async productIdsAvailableAtHome(executor: Db | Tx = this.db): Promise<number[]> {
    const result = await executor.execute<{ product_id: string }>(sql`
      SELECT ws.product_id::text AS product_id
        FROM warehouse_stock ws
        JOIN product_locations l
          ON l.product_id = ws.product_id AND l.warehouse_id = ws.warehouse_id AND l.is_home
       GROUP BY ws.product_id
      HAVING sum(ws.sellable_on_hand) - sum(ws.reserved) > 0
       ORDER BY ws.product_id`);
    return result.rows.map((row) => Number.parseInt(row.product_id, 10));
  }

  /** Warehouse balances per product, lots summed; the value is Σ on hand × average per row. */
  private async balances(
    productIds: readonly number[],
    warehouseId?: number,
  ): Promise<Map<number, WarehouseBalance[]>> {
    if (productIds.length === 0) return new Map();
    const filters: SQL[] = [idIn(warehouseStock.productId, productIds)];
    if (warehouseId) filters.push(eq(warehouseStock.warehouseId, warehouseId));
    filters.push(sql`(${warehouseStock.onHand} <> 0 OR ${warehouseStock.reserved} <> 0)`);
    const rows = await this.db
      .select()
      .from(warehouseStock)
      .where(and(...filters))
      .orderBy(warehouseStock.productId, warehouseStock.warehouseId);
    const result = new Map<number, WarehouseBalance[]>();
    for (const row of rows) {
      const list = result.get(row.productId) ?? [];
      let balance = list.find((entry) => entry.warehouseId === row.warehouseId);
      if (!balance) {
        balance = {
          warehouseId: row.warehouseId,
          onHand: ZERO,
          sellableOnHand: ZERO,
          reserved: ZERO,
          available: ZERO,
          avgCost: row.avgCost,
          value: ZERO,
        };
        list.push(balance);
        result.set(row.productId, list);
      }
      balance.onHand = balance.onHand.plus(row.onHand);
      balance.sellableOnHand = balance.sellableOnHand.plus(row.sellableOnHand);
      balance.reserved = balance.reserved.plus(row.reserved);
      balance.value = balance.value.plus(valueOf(row.onHand, row.avgCost));
    }
    for (const list of result.values()) {
      for (const balance of list) {
        balance.available = Decimal.max(ZERO, balance.sellableOnHand.minus(balance.reserved));
        if (balance.onHand.gt(0)) {
          balance.avgCost = balance.value.dividedBy(balance.onHand).toDecimalPlaces(COST_SCALE);
        }
      }
    }
    return result;
  }
}

function withTotals(product: ProductSummary, warehouses: WarehouseBalance[]): ProductStock {
  return {
    product,
    onHand: warehouses.reduce((sum, row) => sum.plus(row.onHand), ZERO),
    available: warehouses.reduce((sum, row) => sum.plus(row.available), ZERO),
    value: warehouses.reduce((sum, row) => sum.plus(row.value), ZERO),
    warehouses,
  };
}
