import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { MAX_PO_CHANGES, PO_GRID_PAGE } from '@tugeel/shared/procurement';
import { addDays, addMonths, businessMonthStart } from '@tugeel/shared/time';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, encodeCursor } from '../../../common/pagination/page';
import { CatalogService, ProductQueryService, UnitConversionService } from '../../catalog';
import { actorUserId, type AuthContext, AuditService, OrgService } from '../../identity';
import {
  ProductLocationsService,
  type ReceiptCosting,
  type ReceiptDetail,
  ReceiptsService,
  StockQueryService,
} from '../../inventory';
import { ProductSuppliersService, SuppliersService } from '../../partners';
import { purchaseOrderLines, purchaseOrders, purchaseOrderSuppliers } from '../schema';
import {
  canCount,
  canPrice,
  canShip,
  canWriteHome,
  COSTS,
  editRight,
  type EditRight,
  lockOrderSupplier,
  ordererOf,
  type OrderSupplierRow,
  PRICES,
} from './support';

/** Most products a supplier's grid walks (its main products). */
const GRID_CAP = 5000;
/** The sales columns look back this many calendar months (ADR-0118 #5). */
const SALES_MONTHS = 12;

export type GridFilter = 'ALL' | 'ORDERED' | 'BELOW_MIN';

export interface GridQuery {
  q?: string;
  filter?: GridFilter;
  /** Rows whose home warehouse is this one. */
  warehouseId?: number;
  cursor?: string;
  limit?: number;
}

export interface GridUnit {
  id: number;
  name: string;
  factor: Decimal;
  isBase: boolean;
}

/** The sales columns (ADR-0118 #5): averages per calendar month, base units, home warehouse. */
export interface GridSales {
  avg12: Decimal;
  avg3: Decimal;
  lastMonth: Decimal;
  sameMonthLastYear: Decimal;
}

/** The row's receipt line once the supplier arrived (ADR-0118 #5). */
export interface GridReceiptLine {
  lineId: number;
  warehouseId: number;
  unitName: string;
  /** Pieces per the receipt line's unit (1 once counted in pieces). */
  factor: Decimal;
  /** What the order expected, in base units (null on a line not on the order). */
  expectedBase: Decimal | null;
  /** The counted quantity in base units; null while the keeper has not checked the line. */
  arrivedBase: Decimal | null;
  checkedAt: Date | null;
  note: string | null;
  /** The line's warehouse is confirmed: frozen. */
  confirmed: boolean;
  /** May the caller type this line's count now? */
  canCount: boolean;
  /** Cost data (cost holders only): the draft's or typed price per the line's unit and amount. */
  docUnitPrice: Decimal | null;
  docAmount: Decimal | null;
  /** The product's price on the receipt before (per the line's unit), once the receipt is posted. */
  previousUnitPrice: Decimal | null;
  previousDate: string | null;
}

/** One product of a supplier's grid with what Bto knows beside it (ADR-0115, ADR-0118). */
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
  sales: GridSales;
  /** The last delivery-note price per base unit and its date (price readers only). */
  lastBasePrice: Decimal | null;
  lastPriceDate: string | null;
  line: {
    productUnitId: number;
    qty: Decimal;
    qtyBase: Decimal;
    /** What the supplier shipped, in the line's unit; null until typed. */
    shippedQty: Decimal | null;
  } | null;
  /** May the caller change the ordered quantity now? */
  editable: boolean;
  /** May the caller type the shipped quantity now? */
  canShip: boolean;
  receipt: GridReceiptLine | null;
  /** A receipt line of a product not on the order («Захиалгад байхгүй»). */
  extra: boolean;
}

/** What the page may type for this supplier now (ADR-0118). */
export interface GridRights {
  order: boolean;
  shipped: boolean;
  count: boolean;
  price: boolean;
}

export interface GridReceipt {
  id: number;
  number: string | null;
  status: 'DRAFT' | 'POSTED' | 'CANCELLED';
  costingVersion: number;
  noteTotalQty: Decimal | null;
  noteTotalAmount: Decimal | null;
  confirmedWarehouseIds: number[];
}

export interface GridPage {
  data: GridRow[];
  nextCursor: string | null;
  total: number;
  /** The month `lastMonthOut` covers (YYYY-MM-DD … YYYY-MM-DD). */
  outflowFrom: string;
  outflowTo: string;
  /** The sales window (YYYY-MM … YYYY-MM, 12 months). */
  salesFrom: string;
  salesTo: string;
  rights: GridRights;
  receipt: GridReceipt | null;
  /** Receipt lines of products not in the grid; on the first page only. */
  extra: GridRow[];
}

/** A cell as the page sends it: the new value and the value it had when the page opened. */
export interface GridChange {
  productId: number;
  /** ORDERED: the ordered quantity in its unit; SHIPPED: the shipped quantity in the line's unit. */
  field: 'ORDERED' | 'SHIPPED';
  /** The unit now (ORDERED; null with no quantity). */
  productUnitId: number | null;
  /** The quantity now; a zero or null ordered quantity removes the line, a null shipped one clears it. */
  qty: Decimal | null;
  previous: { productUnitId: number | null; qty: Decimal } | null;
}

export type GridRefusalReason = 'SCOPE' | 'NO_HOME' | 'NOT_SUPPLIER' | 'NO_LINE';

export interface GridSaveResult {
  applied: number;
  /** Cells someone else changed since the page opened, with what they hold now (skipped). */
  conflicts: {
    productId: number;
    field: 'ORDERED' | 'SHIPPED';
    productUnitId: number | null;
    qty: Decimal | null;
  }[];
  /** Cells this person may not change (a product of another warehouse, or without a home). */
  refused: { productId: number; reason: GridRefusalReason }[];
}

/** A keeper's count on the order page (ADR-0118 #5), against the value the page opened with. */
export interface ArrivalChange {
  lineId: number;
  /** The counted quantity in base units (boxes × pieces); absent when only the note changes. */
  arrivedQtyBase?: Decimal;
  note?: string | null;
  /** The count when the page opened; null while the line was unchecked. */
  previousArrivedQtyBase: Decimal | null;
}

export type ArrivalRefusalReason = 'SCOPE' | 'CONFIRMED' | 'NOT_FOUND';

export interface ArrivalSaveResult {
  applied: number;
  conflicts: { lineId: number; arrivedQtyBase: Decimal | null; note: string | null }[];
  refused: { lineId: number; reason: ArrivalRefusalReason }[];
}

/** One line of the order's Excel (ADR-0118 #7). */
export interface ExportLine {
  supplierName: string;
  sku: string;
  name: string;
  warehouseName: string | null;
  orderedQty: Decimal | null;
  unitName: string | null;
  orderedBase: Decimal | null;
  shippedQty: Decimal | null;
  arrivedBase: Decimal | null;
  /** Arrived less expected, base units (null until counted). */
  difference: Decimal | null;
  unitPrice: Decimal | null;
  amount: Decimal | null;
}

/**
 * A supplier's quantities inside an order (ADR-0115, ADR-0118): the grid of its main products with
 * stock, minimum, the sales columns, the last price and, once the supplier arrived, its receipt line
 * beside each; and the saves that write only the changed cells, each checked against the value it
 * had when the page opened, so a stale page never overwrites a colleague (Butenorgil's lesson).
 * Saves lock the order and its supplier rows; the arrivals lock the receipt first, as the receipt's
 * own hook does.
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
    private readonly suppliers: SuppliersService,
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
    if (query.warehouseId !== undefined) {
      ids = ids.filter((id) => homes.get(id) === query.warehouseId);
    }
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
    const ordererId = await ordererOf(this.db, supplierId);
    const right = editRight(ctx, supplier.status, ordererId);
    const shipping = canShip(ctx, supplier.status, ordererId);
    const monthStart = businessMonthStart();
    const outflowFrom = addMonths(monthStart, -1);
    const outflowTo = addDays(monthStart, -1);
    const salesFrom = addMonths(monthStart, -SALES_MONTHS);
    const receipt = await this.receiptOf(ctx, supplier);
    const describe = (productIds: readonly number[]) =>
      this.describe(ctx, supplier, productIds, homes, lineOf, right, shipping, receipt, {
        outflowFrom,
        outflowTo,
        salesFrom,
        salesTo: outflowTo,
      });
    const data = await describe(pageIds);
    // Goods the keeper added that the order never listed; shown once, under the first page.
    const extraIds =
      offset === 0 && receipt
        ? [
            ...new Set(
              receipt.detail.lines
                .filter((line) => !lineOf.has(line.productId))
                .map((line) => line.productId),
            ),
          ]
        : [];
    const extra = extraIds.length === 0 ? [] : await describe(extraIds);
    return {
      data,
      nextCursor: offset + limit < ids.length ? encodeCursor({ offset: offset + limit }) : null,
      total: ids.length,
      outflowFrom,
      outflowTo,
      salesFrom: salesFrom.slice(0, 7),
      salesTo: outflowTo.slice(0, 7),
      rights: {
        order: right !== null,
        shipped: shipping,
        count:
          receipt !== null &&
          receipt.detail.status === 'DRAFT' &&
          receipt.detail.lines.some((line) => canCount(ctx, supplier.status, line.warehouseId)),
        price: canPrice(ctx, supplier.status) && receipt?.detail.status === 'POSTED',
      },
      receipt: receipt
        ? {
            id: receipt.detail.id,
            number: receipt.detail.number,
            status: receipt.detail.status,
            costingVersion: receipt.detail.costingVersion,
            noteTotalQty: receipt.detail.noteTotalQty,
            noteTotalAmount: receipt.detail.noteTotalAmount,
            confirmedWarehouseIds: receipt.detail.confirmations.map((row) => row.warehouseId),
          }
        : null,
      extra: extra.map((row) => ({ ...row, extra: true })),
    };
  }

  /**
   * Writes the changed cells (ADR-0115, ADR-0118): the ordered quantities and, in «Ачигдаж байна»,
   * the shipped ones; a cell changed by someone else since is skipped.
   */
  saveLines(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    changes: readonly GridChange[],
  ): Promise<GridSaveResult> {
    if (changes.length > MAX_PO_CHANGES) {
      throw invalid('changes', 'max', `at most ${MAX_PO_CHANGES} cells per save`);
    }
    const keys = changes.map((change) => `${change.field}:${change.productId}`);
    if (new Set(keys).size !== keys.length) {
      throw invalid('changes', 'unique', 'one change per product and field');
    }
    return inTransaction(this.db, async (tx) => {
      const { supplier } = await lockOrderSupplier(tx, orderId, supplierId);
      const ordererId = await ordererOf(tx, supplierId);
      const right = editRight(ctx, supplier.status, ordererId);
      const shipping = canShip(ctx, supplier.status, ordererId);
      if (changes.some((change) => change.field === 'ORDERED') && right === null) {
        throw new AppError('PO_NOT_EDITABLE', `supplier ${supplierId} is not editable now`, {
          status: supplier.status,
          reason: supplier.status,
        });
      }
      if (changes.some((change) => change.field === 'SHIPPED') && !shipping) {
        throw new AppError(
          'PO_NOT_EDITABLE',
          `supplier ${supplierId} takes no shipped quantities now`,
          {
            status: supplier.status,
            reason: 'SHIPPED',
          },
        );
      }
      const productIds = [...new Set(changes.map((change) => change.productId))];
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
        if (change.field === 'SHIPPED') {
          if (!line) {
            result.refused.push({ productId: change.productId, reason: 'NO_LINE' });
            continue;
          }
          const previous = change.previous?.qty ?? null;
          if (!sameQty(line.shippedQty, previous)) {
            result.conflicts.push({
              productId: change.productId,
              field: 'SHIPPED',
              productUnitId: line.productUnitId,
              qty: line.shippedQty,
            });
            continue;
          }
          const shipped = change.qty;
          if (shipped !== null && shipped.isNegative()) {
            throw invalid('changes', 'qty', 'a shipped quantity is not negative');
          }
          await tx
            .update(purchaseOrderLines)
            .set({ shippedQty: shipped, updatedBy: actorUserId(ctx), updatedAt: sql`now()` })
            .where(eq(purchaseOrderLines.id, line.id));
          audits.push({
            productId: change.productId,
            before: line,
            after: { shipped: { qty: shipped === null ? null : shipped.toString() } },
          });
          result.applied += 1;
          continue;
        }
        if (right === null) continue;
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
            field: 'ORDERED',
            productUnitId: line?.productUnitId ?? null,
            qty: line?.qty ?? null,
          });
          continue;
        }
        const qty = change.qty;
        if (qty === null || qty.isZero()) {
          if (line) {
            await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.id, line.id));
            audits.push({ productId: change.productId, before: line, after: { line: null } });
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
          after: { line: { productUnitId: converted.unitId, qty: qty.toString() } },
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
            after: { productId: entry.productId, ...(entry.after as object) },
          })),
        );
        await this.touchOrder(tx, orderId);
      }
      return result;
    });
  }

  /**
   * The keepers' counts typed on the order page (ADR-0118 #5): in «Ирсэн», each line by a manager
   * or by a receipt holder of the line's warehouse, written through inventory's receipt line
   * service (which audits the count on the receipt), against the count the page opened with. The
   * receipt is locked before the order, the order the confirmation hook takes.
   */
  saveArrivals(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    changes: readonly ArrivalChange[],
  ): Promise<ArrivalSaveResult> {
    if (changes.length > MAX_PO_CHANGES) {
      throw invalid('changes', 'max', `at most ${MAX_PO_CHANGES} lines per save`);
    }
    if (new Set(changes.map((change) => change.lineId)).size !== changes.length) {
      throw invalid('changes', 'unique', 'one change per line');
    }
    return inTransaction(this.db, async (tx) => {
      const peek = await this.orderSupplier(orderId, supplierId, tx);
      if (peek.status !== 'ARRIVED' || peek.receiptId === null) {
        throw new AppError('PO_NOT_EDITABLE', `supplier ${supplierId} takes no counts now`, {
          status: peek.status,
          reason: 'ARRIVALS',
        });
      }
      const receipt = await this.receipts.lockDraftInTx(tx, peek.receiptId);
      const { supplier } = await lockOrderSupplier(tx, orderId, supplierId);
      if (supplier.status !== 'ARRIVED' || supplier.receiptId !== receipt.id) {
        throw new AppError('CONFLICT', `supplier ${supplierId} moved meanwhile`, {
          status: supplier.status,
        });
      }
      const detail = await this.receipts.get(receipt.id, tx);
      const lineOf = new Map(detail.lines.map((line) => [line.id, line]));
      const confirmed = new Set(detail.confirmations.map((row) => row.warehouseId));
      const result: ArrivalSaveResult = { applied: 0, conflicts: [], refused: [] };
      for (const change of changes) {
        const line = lineOf.get(change.lineId);
        if (!line) {
          result.refused.push({ lineId: change.lineId, reason: 'NOT_FOUND' });
          continue;
        }
        if (!canCount(ctx, supplier.status, line.warehouseId)) {
          result.refused.push({ lineId: change.lineId, reason: 'SCOPE' });
          continue;
        }
        if (confirmed.has(line.warehouseId)) {
          result.refused.push({ lineId: change.lineId, reason: 'CONFIRMED' });
          continue;
        }
        const arrived = line.checkedAt === null ? null : line.qtyBase;
        if (!sameQty(arrived, change.previousArrivedQtyBase)) {
          result.conflicts.push({
            lineId: change.lineId,
            arrivedQtyBase: arrived,
            note: line.note,
          });
          continue;
        }
        if (change.arrivedQtyBase === undefined && change.note === undefined) continue;
        await this.receipts.countLineInTx(tx, ctx, change.lineId, {
          ...(change.arrivedQtyBase === undefined ? {} : { arrivedQtyBase: change.arrivedQtyBase }),
          ...(change.note === undefined ? {} : { note: change.note }),
        });
        result.applied += 1;
      }
      if (result.applied > 0) await this.touchOrder(tx, orderId);
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

  /**
   * The order's lines for its Excel (ADR-0118 #7): every supplier's ordered products (and the
   * receipt's extra lines), with what was shipped, what arrived and, for price readers, the price
   * and amount the receipt carries.
   */
  async exportLines(ctx: AuthContext, orderId: number): Promise<ExportLine[]> {
    const rows = await this.db
      .select()
      .from(purchaseOrderSuppliers)
      .where(eq(purchaseOrderSuppliers.orderId, orderId))
      .orderBy(purchaseOrderSuppliers.id);
    if (rows.length === 0) return [];
    const lines = await this.db
      .select()
      .from(purchaseOrderLines)
      .where(
        inArray(
          purchaseOrderLines.orderSupplierId,
          rows.map((row) => row.id),
        ),
      );
    const receipts = new Map<number, ReceiptDetail>();
    for (const row of rows) {
      if (row.receiptId !== null) receipts.set(row.id, await this.receipts.get(row.receiptId));
    }
    const productIds = [
      ...new Set([
        ...lines.map((line) => line.productId),
        ...[...receipts.values()].flatMap((receipt) => receipt.lines.map((line) => line.productId)),
      ]),
    ];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const units = await this.units.describe([...new Set(lines.map((line) => line.productUnitId))]);
    const homes = await this.locations.homeOf(productIds);
    const warehouseNames = await this.warehouseNames([...new Set(homes.values())]);
    const supplierNames = await this.supplierNames(rows);
    const withPrices = ctx.permissions.has(PRICES);
    const out: ExportLine[] = [];
    for (const row of rows) {
      const receipt = receipts.get(row.id);
      const receiptLines = new Map(receipt?.lines.map((line) => [line.productId, line]) ?? []);
      const own = lines
        .filter((line) => line.orderSupplierId === row.id)
        .map((line) => {
          const product = products.get(line.productId);
          const home = homes.get(line.productId);
          const received = receiptLines.get(line.productId);
          const expectedBase =
            received?.expectedQty == null
              ? null
              : received.expectedQty.times(received.factorSnapshot);
          const arrivedBase = received && received.checkedAt !== null ? received.qtyBase : null;
          return {
            supplierName: supplierNames.get(row.supplierId) ?? '',
            sku: product?.sku ?? '',
            name: product?.name ?? '',
            warehouseName: home === undefined ? null : (warehouseNames.get(home) ?? null),
            orderedQty: line.qty,
            unitName: units.get(line.productUnitId)?.uomName ?? null,
            orderedBase: line.qtyBase,
            shippedQty: line.shippedQty,
            arrivedBase,
            difference:
              arrivedBase === null || expectedBase === null
                ? null
                : arrivedBase.minus(expectedBase),
            unitPrice: withPrices ? (received?.docUnitPrice ?? null) : null,
            amount: withPrices ? (received?.docAmount ?? null) : null,
          };
        });
      const ordered = new Set(own.map((line) => line.sku));
      const extra = (receipt?.lines ?? [])
        .filter((line) => !ordered.has(products.get(line.productId)?.sku ?? ''))
        .map((line) => ({
          supplierName: supplierNames.get(row.supplierId) ?? '',
          sku: line.productSku,
          name: line.productName,
          warehouseName: line.warehouseName,
          orderedQty: null,
          unitName: null,
          orderedBase: null,
          shippedQty: null,
          arrivedBase: line.checkedAt === null ? null : line.qtyBase,
          difference: null,
          unitPrice: withPrices ? line.docUnitPrice : null,
          amount: withPrices ? line.docAmount : null,
        }));
      out.push(...[...own, ...extra].sort((a, b) => a.name.localeCompare(b.name)));
    }
    return out;
  }

  // -------------------------------------------------------------------------------------------

  private async orderSupplier(orderId: number, supplierId: number, executor: Db | Tx = this.db) {
    const [row] = await executor
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

  private async touchOrder(tx: Tx, orderId: number): Promise<void> {
    await tx
      .update(purchaseOrders)
      .set({ updatedAt: sql`now()` })
      .where(eq(purchaseOrders.id, orderId));
  }

  /** The supplier's receipt with, for cost holders of a posted one, its costing (previous prices). */
  private async receiptOf(
    ctx: AuthContext,
    supplier: OrderSupplierRow,
  ): Promise<{ detail: ReceiptDetail; costing: ReceiptCosting | null } | null> {
    if (supplier.receiptId === null) return null;
    const detail = await this.receipts.get(supplier.receiptId);
    const costing =
      detail.status === 'POSTED' && ctx.permissions.has(COSTS)
        ? await this.receipts.costing(supplier.receiptId)
        : null;
    return { detail, costing };
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
    supplier: OrderSupplierRow,
    productIds: readonly number[],
    homes: Map<number, number>,
    lineOf: Map<number, typeof purchaseOrderLines.$inferSelect>,
    right: EditRight,
    shipping: boolean,
    receipt: { detail: ReceiptDetail; costing: ReceiptCosting | null } | null,
    period: { outflowFrom: string; outflowTo: string; salesFrom: string; salesTo: string },
  ): Promise<GridRow[]> {
    if (productIds.length === 0) return [];
    const products = new Map(
      (await this.catalog.getMany(productIds)).map((product) => [product.id, product]),
    );
    const units = await this.units.currentUnits(productIds);
    const allHomes = new Map(homes);
    for (const [productId, home] of await this.locations.homeOf(
      productIds.filter((id) => !allHomes.has(id)),
    )) {
      allHomes.set(productId, home);
    }
    const facts = await this.homeFacts(productIds, allHomes);
    const outflow = await this.stock.outflowByMonth(productIds, period.salesFrom, period.salesTo);
    const prices = ctx.permissions.has(PRICES)
      ? new Map(
          (await this.receipts.lastPrices(productIds)).map((price) => [price.productId, price]),
        )
      : null;
    const warehouseNames = await this.warehouseNames([...new Set(allHomes.values())]);
    const months = monthKeys(period.salesFrom, SALES_MONTHS);
    const lastMonth = months[months.length - 1] ?? '';
    const lastThree = months.slice(-3);
    const sameMonthLastYear = months[0] ?? '';
    const confirmed = new Set(receipt?.detail.confirmations.map((row) => row.warehouseId) ?? []);
    const receiptLines = new Map(receipt?.detail.lines.map((line) => [line.productId, line]) ?? []);
    const costed = new Map(receipt?.costing?.lines.map((line) => [line.lineId, line]) ?? []);
    const withCosts = ctx.permissions.has(COSTS);
    return productIds.flatMap((productId) => {
      const product = products.get(productId);
      if (!product) return [];
      const home = allHomes.get(productId);
      const line = lineOf.get(productId);
      const fact = facts.get(productId);
      const price = prices?.get(productId);
      const byMonth = home === undefined ? undefined : outflow.get(productId)?.get(home);
      const sum = (keys: readonly string[]) =>
        keys.reduce((total, key) => total.plus(byMonth?.get(key) ?? 0), new Decimal(0));
      const received = receiptLines.get(productId);
      const cost = received ? costed.get(received.id) : undefined;
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
          lastMonthOut: sum([lastMonth]),
          sales: {
            avg12: sum(months).div(SALES_MONTHS).toDecimalPlaces(3),
            avg3: sum(lastThree).div(3).toDecimalPlaces(3),
            lastMonth: sum([lastMonth]),
            sameMonthLastYear: sum([sameMonthLastYear]),
          },
          lastBasePrice: price?.basePrice ?? null,
          lastPriceDate: price?.date ?? null,
          line: line
            ? {
                productUnitId: line.productUnitId,
                qty: line.qty,
                qtyBase: line.qtyBase,
                shippedQty: line.shippedQty,
              }
            : null,
          editable: right !== null && home !== undefined && (right.all || canWriteHome(ctx, home)),
          canShip: shipping && line !== undefined,
          receipt: received
            ? {
                lineId: received.id,
                warehouseId: received.warehouseId,
                unitName: received.unitName,
                factor: received.factorSnapshot,
                expectedBase:
                  received.expectedQty === null
                    ? null
                    : received.expectedQty.times(received.factorSnapshot),
                arrivedBase: received.checkedAt === null ? null : received.qtyBase,
                checkedAt: received.checkedAt,
                note: received.note,
                confirmed: confirmed.has(received.warehouseId),
                canCount:
                  receipt?.detail.status === 'DRAFT' &&
                  !confirmed.has(received.warehouseId) &&
                  canCount(ctx, supplier.status, received.warehouseId),
                docUnitPrice: withCosts ? received.docUnitPrice : null,
                docAmount: withCosts ? received.docAmount : null,
                previousUnitPrice: cost?.previousUnitPrice ?? null,
                previousDate: cost?.previousDate ?? null,
              }
            : null,
          extra: false,
        },
      ];
    });
  }

  private async warehouseNames(ids: readonly number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    for (const id of ids) names.set(id, (await this.org.getWarehouse(id)).name);
    return names;
  }

  private async supplierNames(rows: readonly OrderSupplierRow[]): Promise<Map<number, string>> {
    const suppliers = await this.suppliers.getMany([...new Set(rows.map((row) => row.supplierId))]);
    return new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  }
}

/** The cell as stored equals the value the page opened with (both empty counts as equal). */
function sameCell(
  line: { productUnitId: number; qty: Decimal } | undefined,
  previous: { productUnitId: number | null; qty: Decimal } | null,
): boolean {
  if (!line || !previous) return !line && !previous;
  return line.productUnitId === previous.productUnitId && line.qty.equals(previous.qty);
}

function sameQty(stored: Decimal | null, previous: Decimal | null): boolean {
  if (stored === null || previous === null) return stored === null && previous === null;
  return stored.equals(previous);
}

/** `count` month keys (YYYY-MM) from the month of `from` on. */
function monthKeys(from: string, count: number): string[] {
  const keys: string[] = [];
  for (let index = 0; index < count; index += 1) keys.push(addMonths(from, index).slice(0, 7));
  return keys;
}
