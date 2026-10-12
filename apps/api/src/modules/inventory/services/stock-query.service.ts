import { Inject, Injectable } from '@nestjs/common';
import { COST_SCALE, valueOf } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import { and, desc, eq, gt, inArray, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
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
@Injectable()
export class StockQueryService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly bins: BinsService,
    private readonly catalog: CatalogService,
    private readonly posting: StockPostingService,
    private readonly units: UnitConversionService,
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

  /** Warehouse balances per product, lots summed; the value is Σ on hand × average per row. */
  private async balances(
    productIds: readonly number[],
    warehouseId?: number,
  ): Promise<Map<number, WarehouseBalance[]>> {
    if (productIds.length === 0) return new Map();
    const filters: SQL[] = [inArray(warehouseStock.productId, [...productIds])];
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
