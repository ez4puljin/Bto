import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { MAX_PO_CHANGES, PO_GRID_PAGE } from '@tugeel/shared/procurement';
import { addDays, addMonths, businessMonthStart } from '@tugeel/shared/time';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { CatalogService, ProductQueryService, UnitConversionService } from '../../catalog';
import { actorUserId, type AuthContext, AuditService, OrgService } from '../../identity';
import { ProductLocationsService, ReceiptsService, StockQueryService } from '../../inventory';
import { ProductSuppliersService } from '../../partners';
import { purchaseOrderLines, purchaseOrders, purchaseOrderSuppliers } from '../schema';
import {
  canWriteHome,
  editRight,
  type EditRight,
  lockOrderSupplier,
  ordererOf,
  PRICES,
} from './support';

/** Most products a supplier's grid walks (its main products). */
const GRID_CAP = 5000;

export type GridFilter = 'ALL' | 'ORDERED' | 'BELOW_MIN';

export interface GridQuery {
  q?: string;
  filter?: GridFilter;
  cursor?: string;
  limit?: number;
}

export interface GridUnit {
  id: number;
  name: string;
  factor: Decimal;
  isBase: boolean;
}

/** One product of a supplier's grid with what Bto knows beside it (ADR-0115). */
export interface GridRow {
  productId: number;
  sku: string;
  name: string;
  weightKg: Decimal | null;
  /** Current units, base first, then by factor; the largest is the default to order in. */
  units: GridUnit[];
  homeWarehouseId: number | null;
  homeWarehouseName: string | null;
  /** On hand and the minimum in the home warehouse, base units. */
  onHand: Decimal;
  minQty: Decimal | null;
  /** Last calendar month's outflow from the home warehouse: sales less returns, plus transfers to a supermarket. */
  lastMonthOut: Decimal;
  /** The last delivery-note price per base unit and its date (price readers only). */
  lastBasePrice: Decimal | null;
  lastPriceDate: string | null;
  line: { productUnitId: number; qty: Decimal; qtyBase: Decimal } | null;
  /** May the caller change this row now? */
  editable: boolean;
}

export interface GridPage {
  data: GridRow[];
  nextCursor: string | null;
  total: number;
  /** The month `lastMonthOut` covers (YYYY-MM-DD … YYYY-MM-DD). */
  outflowFrom: string;
  outflowTo: string;
}

/** A cell as the page sends it: the new value and the value it had when the page opened. */
export interface GridChange {
  productId: number;
  /** The unit and quantity now; a zero or null quantity removes the line. */
  productUnitId: number | null;
  qty: Decimal | null;
  previous: { productUnitId: number; qty: Decimal } | null;
}

export interface GridSaveResult {
  applied: number;
  /** Cells someone else changed since the page opened, with what they hold now (skipped). */
  conflicts: { productId: number; productUnitId: number | null; qty: Decimal | null }[];
  /** Cells this person may not change (a product of another warehouse, or without a home). */
  refused: { productId: number; reason: 'SCOPE' | 'NO_HOME' | 'NOT_SUPPLIER' }[];
}

/**
 * A supplier's quantities inside an order (ADR-0115): the grid of its main products with stock,
 * minimum, last month's outflow and the last price beside each, and the save that writes only the
 * changed cells, each checked against the value it had when the page opened, so a stale page never
 * overwrites a colleague (Butenorgil's lesson). Saves lock the order and its supplier rows.
 */
@Injectable()
export class PurchaseOrderGridService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly org: OrgService,
    private readonly catalog: CatalogService,
    private readonly productQuery: ProductQueryService,
    private readonly units: UnitConversionService,
    private readonly links: ProductSuppliersService,
    private readonly locations: ProductLocationsService,
    private readonly stock: StockQueryService,
    private readonly receipts: ReceiptsService,
  ) {}

  async rows(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    query: GridQuery,
  ): Promise<GridPage> {
    const supplier = await this.orderSupplier(orderId, supplierId);
    const lines = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderSupplierId, supplier.id));
    const lineOf = new Map(lines.map((line) => [line.productId, line]));
    const main = await this.links.productIdsWhere({
      field: 'supplier',
      op: 'MAIN_IN',
      ids: [supplierId],
    });
    // Ordered products stay in the grid even when their main supplier changed meanwhile.
    const { ids: ordered } = await this.productQuery.orderedIds(
      {
        ...(query.q?.trim() ? { q: query.q.trim() } : {}),
        status: 'ACTIVE',
        onlyIds: [...new Set([...main, ...lineOf.keys()])],
      },
      GRID_CAP,
    );
    let ids = ordered;
    if (query.filter === 'ORDERED') ids = ids.filter((id) => lineOf.has(id));
    const homes = await this.locations.homeOf(ids);
    if (query.filter === 'BELOW_MIN') {
      const facts = await this.homeFacts(ids, homes);
      ids = ids.filter((id) => {
        const fact = facts.get(id);
        return fact?.minQty != null && fact.onHand.lt(fact.minQty);
      });
    }
    const limit = Math.min(query.limit ?? PO_GRID_PAGE, PO_GRID_PAGE);
    const after = decodeCursor(query.cursor);
    const offset = typeof after?.offset === 'number' ? after.offset : 0;
    const pageIds = ids.slice(offset, offset + limit);
    const right = editRight(ctx, supplier.status, await ordererOf(this.db, supplierId));
    const outflowFrom = addMonths(businessMonthStart(), -1);
    const outflowTo = addDays(businessMonthStart(), -1);
    return {
      data: await this.describe(ctx, pageIds, homes, lineOf, right, outflowFrom, outflowTo),
      nextCursor: offset + limit < ids.length ? encodeCursor({ offset: offset + limit }) : null,
      total: ids.length,
      outflowFrom,
      outflowTo,
    };
  }

  /** Writes the changed cells (ADR-0115); a cell changed by someone else since is skipped. */
  saveLines(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    changes: readonly GridChange[],
  ): Promise<GridSaveResult> {
    if (changes.length > MAX_PO_CHANGES) {
      throw invalid('changes', 'max', `at most ${MAX_PO_CHANGES} cells per save`);
    }
    if (new Set(changes.map((change) => change.productId)).size !== changes.length) {
      throw invalid('changes', 'unique', 'one change per product');
    }
    return inTransaction(this.db, async (tx) => {
      const { supplier } = await lockOrderSupplier(tx, orderId, supplierId);
      const right = editRight(ctx, supplier.status, await ordererOf(tx, supplierId));
      if (right === null) {
        throw new AppError('PO_NOT_EDITABLE', `supplier ${supplierId} is not editable now`, {
          status: supplier.status,
          reason: supplier.status,
        });
      }
      const productIds = changes.map((change) => change.productId);
      const current = new Map(
        (
          await tx
            .select()
            .from(purchaseOrderLines)
            .where(
              and(
                eq(purchaseOrderLines.orderSupplierId, supplier.id),
                inArray(purchaseOrderLines.productId, productIds.length ? productIds : [0]),
              ),
            )
        ).map((line) => [line.productId, line]),
      );
      const mains = await this.links.mainSupplierOf(productIds, tx);
      const homes = await this.locations.homeOf(productIds, tx);
      const result: GridSaveResult = { applied: 0, conflicts: [], refused: [] };
      const audits: { productId: number; before: unknown; after: unknown }[] = [];
      for (const change of changes) {
        const line = current.get(change.productId);
        if (!line && mains.get(change.productId) !== supplierId) {
          result.refused.push({ productId: change.productId, reason: 'NOT_SUPPLIER' });
          continue;
        }
        const homeId = homes.get(change.productId);
        if (homeId === undefined) {
          result.refused.push({ productId: change.productId, reason: 'NO_HOME' });
          continue;
        }
        if (!right.all && !canWriteHome(ctx, homeId)) {
          result.refused.push({ productId: change.productId, reason: 'SCOPE' });
          continue;
        }
        if (!sameCell(line, change.previous)) {
          result.conflicts.push({
            productId: change.productId,
            productUnitId: line?.productUnitId ?? null,
            qty: line?.qty ?? null,
          });
          continue;
        }
        const qty = change.qty;
        if (qty === null || qty.isZero()) {
          if (line) {
            await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.id, line.id));
            audits.push({ productId: change.productId, before: line, after: null });
            result.applied += 1;
          }
          continue;
        }
        if (change.productUnitId === null) {
          throw invalid('changes', 'unit', 'a quantity needs its unit');
        }
        const converted = await this.units.toBase(change.productUnitId, qty, tx);
        if (converted.productId !== change.productId) {
          throw invalid('changes', 'unit', 'the unit belongs to another product');
        }
        const values = {
          productUnitId: converted.unitId,
          qty,
          factorSnapshot: converted.factorSnapshot,
          qtyBase: converted.qtyBase,
          updatedBy: actorUserId(ctx),
          updatedAt: sql`now()`,
        };
        if (line) {
          await tx.update(purchaseOrderLines).set(values).where(eq(purchaseOrderLines.id, line.id));
        } else {
          await tx.insert(purchaseOrderLines).values({
            ...values,
            orderSupplierId: supplier.id,
            productId: change.productId,
          });
        }
        audits.push({
          productId: change.productId,
          before: line ?? null,
          after: { productUnitId: converted.unitId, qty: qty.toString() },
        });
        result.applied += 1;
      }
      if (audits.length > 0) {
        await this.audit.recordMany(
          tx,
          ctx,
          audits.map((entry) => ({
            action: 'UPDATE',
            entity: 'purchase_order_suppliers',
            entityId: supplier.id,
            before: entry.before,
            after: { productId: entry.productId, line: entry.after },
          })),
        );
        await tx
          .update(purchaseOrders)
          .set({ updatedAt: sql`now()` })
          .where(eq(purchaseOrders.id, orderId));
      }
      return result;
    });
  }

  /**
   * The order sheet of one supplier, or of all (ADR-0115, browser print): each ordered product with
   * its home warehouse, unit, quantity, pieces and weight, by warehouse then name.
   */
  async sheets(
    orderId: number,
    supplierId: number | undefined,
  ): Promise<
    {
      supplierId: number;
      lines: {
        productId: number;
        sku: string;
        name: string;
        warehouseName: string | null;
        unitName: string;
        qty: Decimal;
        qtyBase: Decimal;
        baseUnitName: string;
        weightKg: Decimal | null;
      }[];
    }[]
  > {
    const [order] = await this.db
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    if (!order) throw notFound('purchase order', orderId);
    const rows = await this.db
      .select()
      .from(purchaseOrderSuppliers)
      .where(eq(purchaseOrderSuppliers.orderId, orderId))
      .orderBy(purchaseOrderSuppliers.id);
    const chosen =
      supplierId === undefined ? rows : rows.filter((row) => row.supplierId === supplierId);
    if (supplierId !== undefined && chosen.length === 0) {
      throw notFound('purchase order supplier', supplierId);
    }
    const lines =
      chosen.length === 0
        ? []
        : await this.db
            .select()
            .from(purchaseOrderLines)
            .where(
              inArray(
                purchaseOrderLines.orderSupplierId,
                chosen.map((row) => row.id),
              ),
            );
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const units = await this.units.describe([...new Set(lines.map((line) => line.productUnitId))]);
    const homes = await this.locations.homeOf(productIds);
    const warehouseNames = await this.warehouseNames([...new Set(homes.values())]);
    return chosen.map((row) => ({
      supplierId: row.supplierId,
      lines: lines
        .filter((line) => line.orderSupplierId === row.id)
        .map((line) => {
          const product = products.get(line.productId);
          const home = homes.get(line.productId);
          const weight = product?.weightKg ?? null;
          return {
            productId: line.productId,
            sku: product?.sku ?? '',
            name: product?.name ?? '',
            warehouseName: home === undefined ? null : (warehouseNames.get(home) ?? null),
            unitName: units.get(line.productUnitId)?.uomName ?? '',
            qty: line.qty,
            qtyBase: line.qtyBase,
            baseUnitName: product?.baseUnit.uomName ?? '',
            weightKg: weight ? weight.times(line.qtyBase) : null,
          };
        })
        .sort(
          (a, b) =>
            (a.warehouseName ?? '').localeCompare(b.warehouseName ?? '') ||
            a.name.localeCompare(b.name),
        ),
    }));
  }

  // -------------------------------------------------------------------------------------------

  private async orderSupplier(orderId: number, supplierId: number) {
    const [row] = await this.db
      .select()
      .from(purchaseOrderSuppliers)
      .where(
        and(
          eq(purchaseOrderSuppliers.orderId, orderId),
          eq(purchaseOrderSuppliers.supplierId, supplierId),
        ),
      );
    if (!row) throw notFound('purchase order supplier', supplierId);
    return row;
  }

  /** Each product's on-hand and minimum in its home warehouse, base units. */
  private async homeFacts(
    productIds: readonly number[],
    homes: Map<number, number>,
  ): Promise<Map<number, { onHand: Decimal; minQty: Decimal | null }>> {
    const facts = new Map<number, { onHand: Decimal; minQty: Decimal | null }>();
    if (productIds.length === 0) return facts;
    const balances = await this.stock.balancesOf(productIds);
    const levels = await this.locations.ofProductIds(productIds);
    for (const productId of productIds) {
      const home = homes.get(productId);
      const balance = (balances.get(productId) ?? []).find((row) => row.warehouseId === home);
      const level = levels.find((row) => row.productId === productId && row.warehouseId === home);
      facts.set(productId, {
        onHand: balance?.onHand ?? new Decimal(0),
        minQty: level?.minQty ?? null,
      });
    }
    return facts;
  }

  private async describe(
    ctx: AuthContext,
    productIds: readonly number[],
    homes: Map<number, number>,
    lineOf: Map<number, typeof purchaseOrderLines.$inferSelect>,
    right: EditRight,
    outflowFrom: string,
    outflowTo: string,
  ): Promise<GridRow[]> {
    if (productIds.length === 0) return [];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const units = await this.units.currentUnits(productIds);
    const facts = await this.homeFacts(productIds, homes);
    const outflow = await this.stock.outflowOf(productIds, outflowFrom, outflowTo);
    const prices = ctx.permissions.has(PRICES)
      ? new Map(
          (await this.receipts.lastPrices(productIds)).map((price) => [price.productId, price]),
        )
      : null;
    const warehouseNames = await this.warehouseNames([...new Set(homes.values())]);
    return productIds.flatMap((productId) => {
      const product = products.get(productId);
      if (!product) return [];
      const home = homes.get(productId);
      const line = lineOf.get(productId);
      const fact = facts.get(productId);
      const price = prices?.get(productId);
      return [
        {
          productId,
          sku: product.sku,
          name: product.name,
          weightKg: product.weightKg,
          units: (units.get(productId) ?? []).map((unit) => ({
            id: unit.unitId,
            name: unit.uomName,
            factor: unit.factorToBase,
            isBase: unit.isBase,
          })),
          homeWarehouseId: home ?? null,
          homeWarehouseName: home === undefined ? null : (warehouseNames.get(home) ?? null),
          onHand: fact?.onHand ?? new Decimal(0),
          minQty: fact?.minQty ?? null,
          lastMonthOut:
            home === undefined
              ? new Decimal(0)
              : (outflow.get(productId)?.get(home) ?? new Decimal(0)),
          lastBasePrice: price?.basePrice ?? null,
          lastPriceDate: price?.date ?? null,
          line: line
            ? { productUnitId: line.productUnitId, qty: line.qty, qtyBase: line.qtyBase }
            : null,
          editable: right !== null && home !== undefined && (right.all || canWriteHome(ctx, home)),
        },
      ];
    });
  }

  private async warehouseNames(ids: readonly number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    for (const id of ids) names.set(id, (await this.org.getWarehouse(id)).name);
    return names;
  }
}

/** The cell as stored equals the value the page opened with (both empty counts as equal). */
function sameCell(
  line: { productUnitId: number; qty: Decimal } | undefined,
  previous: { productUnitId: number; qty: Decimal } | null,
): boolean {
  if (!line || !previous) return !line && !previous;
  return line.productUnitId === previous.productUnitId && line.qty.equals(previous.qty);
}
