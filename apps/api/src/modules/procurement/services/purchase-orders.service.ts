import { Inject, Injectable } from '@nestjs/common';
import { formatDocNumber } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import {
  lowestPoStatus,
  MAX_PO_SUPPLIERS,
  nextPoStatus,
  PO_SUPPLIER_STATUSES,
  type PoSupplierStatus,
  previousPoStatus,
} from '@tugeel/shared/procurement';
import { businessDate, businessYear } from '@tugeel/shared/time';
import { and, desc, eq, ilike, inArray, isNotNull, isNull, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService, ProductQueryService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  NumberingService,
  UserNamesService,
} from '../../identity';
import {
  ProductLocationsService,
  type ReceiptCosting,
  type ReceiptDetail,
  ReceiptsService,
} from '../../inventory';
import { ProductSuppliersService, SuppliersService, type SupplierSummary } from '../../partners';
import { type OrderLoad, OrderLoadsService } from './order-loads.service';
import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseOrderSuppliers,
  supplierOrderers,
} from '../schema';
import {
  assertManage,
  canCount,
  canPrice,
  canShip,
  editRight,
  lockOrderSupplier,
  MANAGE,
  mayMove,
  ordererOf,
  type OrderRow,
  type OrderSupplierRow,
  PRICES,
} from './support';

export interface PurchaseOrderInput {
  /** The business date of the order (today when absent). */
  orderDate?: string | null;
  note?: string | null;
  supplierIds: readonly number[];
}

export interface PurchaseOrderSupplierView {
  supplierId: number;
  supplierCode: string;
  supplierName: string;
  status: PoSupplierStatus;
  statusChangedAt: Date;
  ordererId: number | null;
  ordererName: string | null;
  /** Ordered products and their base quantity and weight (kg, lines with a weight). */
  lineCount: number;
  /** Σ ordered quantity in the lines' own unit (boxes for a box line). */
  boxes: Decimal;
  qtyBase: Decimal;
  weightKg: Decimal;
  /** Σ shipped quantity in base units (lines with a shipped quantity typed). */
  shippedBase: Decimal;
  /** Σ counted base quantity of the receipt's lines (null before the receipt). */
  arrivedBase: Decimal | null;
  /** Receipt lines still waiting for the keeper's count. */
  uncheckedLines: number;
  /** Σ ordered base quantity × each product's last receipt price per base unit (price readers). */
  estimatedCost: Decimal | null;
  /** The receipt's payable so far (price readers; null before the receipt). */
  finalAmount: Decimal | null;
  /** Lines whose price differs from the product's previous one (price readers, posted receipt). */
  priceDiffCount: number | null;
  /** The delivery note's totals as typed on the receipt. */
  noteTotalQty: Decimal | null;
  noteTotalAmount: Decimal | null;
  /** The draft or posted receipt from «Ирсэн» on. */
  receiptId: number | null;
  receiptNumber: string | null;
  /** The truck load it rides on (ADR-0121), or null. */
  loadId: number | null;
  /** What the caller may do now. */
  canEdit: boolean;
  canShip: boolean;
  canCount: boolean;
  canPrice: boolean;
  canMoveNext: boolean;
  canMoveBack: boolean;
}

export interface PurchaseOrderDetail {
  id: number;
  number: string;
  orderDate: string;
  note: string | null;
  status: PoSupplierStatus;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  archivedBy: string | null;
  /** A manager may archive it now (received, or nothing ordered). */
  canArchive: boolean;
  suppliers: PurchaseOrderSupplierView[];
  loads: OrderLoad[];
}

export interface PurchaseOrderSummary {
  id: number;
  number: string;
  orderDate: string;
  note: string | null;
  status: PoSupplierStatus;
  supplierCount: number;
  supplierNames: string[];
  /** Suppliers per status, in status order, zeros left out. */
  statusCounts: { status: PoSupplierStatus; count: number }[];
  archivedAt: Date | null;
  createdAt: Date;
}

export interface PurchaseOrderQuery {
  status?: PoSupplierStatus;
  supplierId?: number;
  /** Orders holding a supplier the caller orders from. */
  mine?: boolean;
  /** Archived orders only (default: the live ones). */
  archived?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

/** An active supplier the new-order dialog offers, with how many active products it is the main supplier of. */
export interface SupplierCandidate {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  tin: string | null;
  mainProductCount: number;
}

/** Most active products counted for the candidates' main-product counts, and most suppliers read. */
const CANDIDATE_PRODUCT_CAP = 200_000;
const CANDIDATE_SUPPLIER_CAP = 10_000;

/** What the page polls to learn that someone else changed the order (ADR-0118 #3). */
export interface PurchaseOrderVersion {
  updatedAt: Date;
  /** The latest change of any of its receipts (null before the first receipt). */
  receiptsUpdatedAt: Date | null;
}

/**
 * Purchase orders (ADR-0115, ADR-0118): one order holds several suppliers, each with its own
 * status; the order shows the lowest. Managers create orders and add or remove suppliers; a
 * manager or the supplier's orderer moves it through «Бэлдэж» → «Илгээсэн» → «Ачигдаж байна» →
 * «Замд» → «Ирсэн», where its draft goods receipt is made expecting the shipped quantities (the
 * ordered ones where none was typed) with the last prices filled in; only a manager steps back,
 * from «Ирсэн» only while no keeper confirmed the receipt. The receipt's keepers and accountant
 * move it on («Нягтлан шалгаж», «Орлого авсан») through the inventory hook
 * (`OrderProgressService`). Managers archive a received order out of the list. Every write locks
 * the order first, then its supplier rows.
 */
@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly userNames: UserNamesService,
    private readonly suppliers: SuppliersService,
    private readonly catalog: CatalogService,
    private readonly productQuery: ProductQueryService,
    private readonly links: ProductSuppliersService,
    private readonly locations: ProductLocationsService,
    private readonly receipts: ReceiptsService,
    private readonly loads: OrderLoadsService,
  ) {}

  /**
   * Every active supplier by name with its number of active main products: the new-order dialog's
   * «Бүгдийг сонгох» takes those with at least one and names how many it skipped. One list, no
   * page: a few hundred rows.
   */
  async supplierCandidates(): Promise<SupplierCandidate[]> {
    const all: SupplierSummary[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.suppliers.list({ status: 'ACTIVE', limit: 500, cursor });
      all.push(...page.data);
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined && all.length < CANDIDATE_SUPPLIER_CAP);
    const { ids } = await this.productQuery.orderedIds({ status: 'ACTIVE' }, CANDIDATE_PRODUCT_CAP);
    const counts = new Map(
      (await this.links.mainSupplierCounts(ids)).map((row) => [row.supplierId, row.productCount]),
    );
    return all.map((supplier) => ({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      phone: supplier.phone,
      tin: supplier.tin,
      mainProductCount: counts.get(supplier.id) ?? 0,
    }));
  }

  /** Every id must name an active supplier (SUPPLIER_INACTIVE / not found as before), read at once. */
  private async assertAllActive(tx: Tx, supplierIds: readonly number[]): Promise<void> {
    if (supplierIds.length === 0) return;
    const found = new Map(
      (await this.suppliers.getMany(supplierIds, tx)).map((supplier) => [supplier.id, supplier]),
    );
    for (const supplierId of supplierIds) {
      const supplier = found.get(supplierId);
      if (!supplier) throw notFound('supplier', supplierId);
      if (supplier.status !== 'ACTIVE') {
        throw new AppError('SUPPLIER_INACTIVE', `supplier ${supplierId} is inactive`, {
          id: supplierId,
        });
      }
    }
  }

  create(ctx: AuthContext, input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    const supplierIds = uniqueSuppliers(input.supplierIds);
    if (supplierIds.length === 0) {
      throw invalid('supplierIds', 'required', 'choose at least one supplier');
    }
    if (supplierIds.length > MAX_PO_SUPPLIERS) {
      throw invalid('supplierIds', 'max', `an order holds at most ${MAX_PO_SUPPLIERS} suppliers`);
    }
    // One transaction, one read of the suppliers, one insert of the rows: hundreds at once.
    return inTransaction(this.db, async (tx) => {
      await this.assertAllActive(tx, supplierIds);
      const year = businessYear();
      const number = formatDocNumber('PO', year, await this.numbering.next(tx, 'PO', year));
      const [order] = await tx
        .insert(purchaseOrders)
        .values({
          number,
          orderDate: input.orderDate ?? businessDate(),
          note: textOrNull(input.note),
          createdBy: actorUserId(ctx),
        })
        .returning();
      if (!order) throw new Error('purchase order insert returned no row');
      await tx.insert(purchaseOrderSuppliers).values(
        supplierIds.map((supplierId) => ({
          orderId: order.id,
          supplierId,
          statusChangedBy: actorUserId(ctx),
        })),
      );
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'purchase_orders',
        entityId: order.id,
        after: { ...order, supplierIds },
      });
      return this.get(ctx, order.id, tx);
    });
  }

  update(
    ctx: AuthContext,
    id: number,
    patch: { note?: string | null },
  ): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (patch.note !== undefined) {
        await tx
          .update(purchaseOrders)
          .set({ note: textOrNull(patch.note), updatedAt: sql`now()` })
          .where(eq(purchaseOrders.id, id));
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'purchase_orders',
          entityId: id,
          before: { note: order.note },
          after: { note: textOrNull(patch.note) },
        });
      }
      return this.get(ctx, id, tx);
    });
  }

  addSuppliers(
    ctx: AuthContext,
    id: number,
    supplierIds: readonly number[],
  ): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      await this.lockOrder(tx, id);
      const existing = new Set(
        (
          await tx
            .select({ supplierId: purchaseOrderSuppliers.supplierId })
            .from(purchaseOrderSuppliers)
            .where(eq(purchaseOrderSuppliers.orderId, id))
        ).map((row) => row.supplierId),
      );
      const fresh = uniqueSuppliers(supplierIds).filter((supplierId) => !existing.has(supplierId));
      if (existing.size + fresh.length > MAX_PO_SUPPLIERS) {
        throw invalid('supplierIds', 'max', `an order holds at most ${MAX_PO_SUPPLIERS} suppliers`);
      }
      await this.assertAllActive(tx, fresh);
      if (fresh.length > 0) {
        await tx.insert(purchaseOrderSuppliers).values(
          fresh.map((supplierId) => ({
            orderId: id,
            supplierId,
            statusChangedBy: actorUserId(ctx),
          })),
        );
        await this.audit.record(tx, ctx, {
          action: 'UPDATE',
          entity: 'purchase_orders',
          entityId: id,
          after: { addedSupplierIds: fresh },
        });
        await this.refreshStatus(tx, id);
      }
      return this.get(ctx, id, tx);
    });
  }

  /** Takes a supplier out of an order while «Бэлдэж», with its quantities. */
  removeSupplier(ctx: AuthContext, id: number, supplierId: number): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const { supplier } = await lockOrderSupplier(tx, id, supplierId);
      if (supplier.status !== 'PREPARING') {
        throw new AppError('PO_STATUS_INVALID', `supplier ${supplierId} is ${supplier.status}`, {
          status: supplier.status,
        });
      }
      const lines = await tx
        .delete(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderSupplierId, supplier.id))
        .returning();
      await tx.delete(purchaseOrderSuppliers).where(eq(purchaseOrderSuppliers.id, supplier.id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'purchase_orders',
        entityId: id,
        before: { removedSupplierId: supplierId, lines },
      });
      await this.refreshStatus(tx, id);
      return this.get(ctx, id, tx);
    });
  }

  /**
   * Moves a supplier one status forward or back (ADR-0115, ADR-0118). «Ирсэн» makes its draft
   * receipt expecting the shipped quantities (the ordered ones where none was typed; a line
   * shipped as 0 is left out); back from «Ирсэн» cancels it, refused once a keeper confirmed a
   * warehouse. The receipt's own steps (ACCOUNTING, RECEIVED) are never set here.
   */
  move(
    ctx: AuthContext,
    id: number,
    supplierId: number,
    to: PoSupplierStatus,
  ): Promise<PurchaseOrderDetail> {
    return inTransaction(this.db, async (tx) => {
      // A step back from «Ирсэн» locks the receipt before the order, the order the receipt's own
      // confirmation takes (receipt → order), so the two never wait on each other.
      const [peek] = await tx
        .select()
        .from(purchaseOrderSuppliers)
        .where(
          and(
            eq(purchaseOrderSuppliers.orderId, id),
            eq(purchaseOrderSuppliers.supplierId, supplierId),
          ),
        );
      if (!peek) throw notFound('purchase order supplier', supplierId);
      const back = previousPoStatus(peek.status) === to;
      if (!back && nextPoStatus(peek.status) !== to) {
        throw new AppError('PO_STATUS_INVALID', `${peek.status} cannot move to ${to}`, {
          status: peek.status,
          to,
        });
      }
      const ordererId = await ordererOf(tx, supplierId);
      if (!mayMove(ctx, ordererId, back)) {
        throw new AppError('FORBIDDEN', 'the supplier is moved by a manager or its orderer', {
          permission: MANAGE,
        });
      }
      if (back && peek.status === 'ARRIVED' && peek.receiptId !== null) {
        await this.receipts.cancelOrderDraftInTx(tx, ctx, peek.receiptId);
      }
      const { order, supplier } = await lockOrderSupplier(tx, id, supplierId);
      if (supplier.status !== peek.status || supplier.receiptId !== peek.receiptId) {
        throw new AppError('CONFLICT', `supplier ${supplierId} moved meanwhile`, {
          status: supplier.status,
        });
      }
      if (order.archivedAt !== null) {
        throw new AppError('PO_STATUS_INVALID', `order ${id} is archived`, { status: 'ARCHIVED' });
      }
      let receiptId: number | null =
        back && supplier.status === 'ARRIVED' ? null : supplier.receiptId;
      if (!back) {
        const lineCount = await this.lineCount(tx, supplier.id);
        if (lineCount === 0) {
          throw new AppError('PO_SUPPLIER_EMPTY', `supplier ${supplierId} has nothing ordered`);
        }
        if (to === 'ARRIVED') receiptId = await this.makeReceipt(tx, ctx, order, supplier);
      }
      await tx
        .update(purchaseOrderSuppliers)
        .set({
          status: to,
          receiptId,
          statusChangedAt: sql`now()`,
          statusChangedBy: actorUserId(ctx),
        })
        .where(eq(purchaseOrderSuppliers.id, supplier.id));
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'purchase_order_suppliers',
        entityId: supplier.id,
        before: { status: supplier.status, receiptId: supplier.receiptId },
        after: { status: to, receiptId },
      });
      await this.refreshStatus(tx, id);
      return this.get(ctx, id, tx);
    });
  }

  /** Takes a finished order out of the list (ADR-0118 #7): received, or nothing ordered. */
  archive(ctx: AuthContext, id: number): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (order.archivedAt !== null) return this.get(ctx, id, tx);
      if (!(await this.archivable(tx, order))) {
        throw new AppError('PO_NOT_ARCHIVABLE', `order ${id} is not finished`, {
          status: order.status,
        });
      }
      await tx
        .update(purchaseOrders)
        .set({ archivedAt: sql`now()`, archivedBy: actorUserId(ctx), updatedAt: sql`now()` })
        .where(eq(purchaseOrders.id, id));
      await this.audit.record(tx, ctx, {
        action: 'ARCHIVE',
        entity: 'purchase_orders',
        entityId: id,
        after: { archived: true },
      });
      return this.get(ctx, id, tx);
    });
  }

  unarchive(ctx: AuthContext, id: number): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockOrder(tx, id);
      if (order.archivedAt === null) return this.get(ctx, id, tx);
      await tx
        .update(purchaseOrders)
        .set({ archivedAt: null, archivedBy: null, updatedAt: sql`now()` })
        .where(eq(purchaseOrders.id, id));
      await this.audit.record(tx, ctx, {
        action: 'UNARCHIVE',
        entity: 'purchase_orders',
        entityId: id,
        after: { archived: false },
      });
      return this.get(ctx, id, tx);
    });
  }

  async get(
    ctx: AuthContext,
    id: number,
    executor: Db | Tx = this.db,
  ): Promise<PurchaseOrderDetail> {
    const [order] = await executor.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!order) throw notFound('purchase order', id);
    const rows = await executor
      .select()
      .from(purchaseOrderSuppliers)
      .where(eq(purchaseOrderSuppliers.orderId, id))
      .orderBy(purchaseOrderSuppliers.id);
    const suppliers = new Map(
      (
        await this.suppliers.getMany(
          rows.map((row) => row.supplierId),
          executor,
        )
      ).map((supplier) => [supplier.id, supplier]),
    );
    const orderers = new Map(
      rows.length === 0
        ? []
        : (
            await executor
              .select()
              .from(supplierOrderers)
              .where(
                inArray(
                  supplierOrderers.supplierId,
                  rows.map((row) => row.supplierId),
                ),
              )
          ).map((row) => [row.supplierId, row.userId]),
    );
    const lines =
      rows.length === 0
        ? []
        : await executor
            .select()
            .from(purchaseOrderLines)
            .where(
              inArray(
                purchaseOrderLines.orderSupplierId,
                rows.map((row) => row.id),
              ),
            );
    const productIds = [...new Set(lines.map((line) => line.productId))];
    const weights = new Map(
      (await this.catalog.getMany(productIds, executor)).map((product) => [
        product.id,
        product.weightKg,
      ]),
    );
    const withPrices = ctx.permissions.has(PRICES);
    const prices = withPrices
      ? new Map(
          (await this.receipts.lastPrices(productIds, {}, executor)).map((price) => [
            price.productId,
            price.basePrice,
          ]),
        )
      : null;
    const names = await this.userNames.namesOf(
      [
        ...orderers.values(),
        ...(order.createdBy === null ? [] : [order.createdBy]),
        ...(order.archivedBy === null ? [] : [order.archivedBy]),
      ],
      executor,
    );
    const receipts = new Map<number, { detail: ReceiptDetail; costing: ReceiptCosting | null }>();
    for (const row of rows) {
      if (row.receiptId !== null) {
        const detail = await this.receipts.get(row.receiptId, executor);
        const costing =
          withPrices && detail.status === 'POSTED'
            ? await this.receipts.costing(row.receiptId, executor)
            : null;
        receipts.set(row.receiptId, { detail, costing });
      }
    }
    const zero = new Decimal(0);
    const manage = ctx.permissions.has(MANAGE);
    return {
      id: order.id,
      number: order.number,
      orderDate: order.orderDate,
      note: order.note,
      status: order.status,
      createdBy: order.createdBy === null ? null : (names.get(order.createdBy) ?? null),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      archivedAt: order.archivedAt,
      archivedBy: order.archivedBy === null ? null : (names.get(order.archivedBy) ?? null),
      canArchive:
        manage && order.archivedAt === null && (order.status === 'RECEIVED' || lines.length === 0),
      suppliers: rows
        .map((row) => {
          const own = lines.filter((line) => line.orderSupplierId === row.id);
          const ordererId = orderers.get(row.supplierId) ?? null;
          const supplier = suppliers.get(row.supplierId);
          const receipt = row.receiptId === null ? undefined : receipts.get(row.receiptId);
          const detail = receipt?.detail;
          return {
            supplierId: row.supplierId,
            supplierCode: supplier?.code ?? '',
            supplierName: supplier?.name ?? '',
            status: row.status,
            statusChangedAt: row.statusChangedAt,
            ordererId,
            ordererName: ordererId === null ? null : (names.get(ordererId) ?? null),
            lineCount: own.length,
            boxes: own.reduce((sum, line) => sum.plus(line.qty), zero),
            qtyBase: own.reduce((sum, line) => sum.plus(line.qtyBase), zero),
            weightKg: own.reduce((sum, line) => {
              const weight = weights.get(line.productId);
              return weight ? sum.plus(weight.times(line.qtyBase)) : sum;
            }, zero),
            shippedBase: own.reduce(
              (sum, line) =>
                line.shippedQty === null
                  ? sum
                  : sum.plus(line.shippedQty.times(line.factorSnapshot)),
              zero,
            ),
            arrivedBase: detail
              ? detail.lines.reduce(
                  (sum, line) => (line.checkedAt === null ? sum : sum.plus(line.qtyBase)),
                  zero,
                )
              : null,
            uncheckedLines: detail
              ? detail.lines.filter((line) => line.checkedAt === null).length
              : 0,
            estimatedCost: prices
              ? own
                  .reduce((sum, line) => {
                    const price = prices.get(line.productId);
                    return price ? sum.plus(price.times(line.qtyBase)) : sum;
                  }, zero)
                  .toDecimalPlaces(2)
              : null,
            finalAmount: withPrices && detail ? detail.totals.netTotal : null,
            priceDiffCount: receipt?.costing ? priceDifferences(receipt.costing) : null,
            noteTotalQty: detail?.noteTotalQty ?? null,
            noteTotalAmount: detail?.noteTotalAmount ?? null,
            receiptId: row.receiptId,
            receiptNumber: detail?.number ?? null,
            loadId: row.loadId,
            canEdit: editRight(ctx, row.status, ordererId) !== null,
            canShip: canShip(ctx, row.status, ordererId),
            canCount:
              detail?.status === 'DRAFT' &&
              detail.lines.some((line) => canCount(ctx, row.status, line.warehouseId)),
            canPrice: canPrice(ctx, row.status) && detail?.status === 'POSTED',
            canMoveNext:
              order.archivedAt === null &&
              nextPoStatus(row.status) !== null &&
              mayMove(ctx, ordererId, false),
            canMoveBack:
              order.archivedAt === null &&
              previousPoStatus(row.status) !== null &&
              mayMove(ctx, ordererId, true),
          };
        })
        .sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
      loads: await this.loads.loadsOf(order.id, executor),
    };
  }

  /** The stamps the page compares to learn about another user's change (ADR-0118 #3). */
  async version(id: number): Promise<PurchaseOrderVersion> {
    const [order] = await this.db
      .select({ updatedAt: purchaseOrders.updatedAt })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id));
    if (!order) throw notFound('purchase order', id);
    const rows = await this.db
      .select({ receiptId: purchaseOrderSuppliers.receiptId })
      .from(purchaseOrderSuppliers)
      .where(
        and(eq(purchaseOrderSuppliers.orderId, id), isNotNull(purchaseOrderSuppliers.receiptId)),
      );
    const stamps = await this.receipts.updatedAtOf(
      rows.flatMap((row) => (row.receiptId === null ? [] : [row.receiptId])),
    );
    let latest: Date | null = null;
    for (const stamp of stamps.values()) {
      if (latest === null || stamp > latest) latest = stamp;
    }
    return { updatedAt: order.updatedAt, receiptsUpdatedAt: latest };
  }

  async list(
    ctx: AuthContext,
    query: PurchaseOrderQuery,
  ): Promise<{ data: PurchaseOrderSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    // Spelled out: Drizzle leaves the columns of a single-table select unqualified.
    // A status filter means: a supplier of the order is in that status (the order has none itself).
    if (query.status) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM purchase_order_suppliers s WHERE s.order_id = purchase_orders.id AND s.status = ${query.status})`,
      );
    }
    filters.push(
      query.archived ? isNotNull(purchaseOrders.archivedAt) : isNull(purchaseOrders.archivedAt),
    );
    if (query.supplierId) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM purchase_order_suppliers s WHERE s.order_id = purchase_orders.id AND s.supplier_id = ${query.supplierId})`,
      );
    }
    if (query.mine) {
      filters.push(
        sql`EXISTS (SELECT 1 FROM purchase_order_suppliers s JOIN supplier_orderers o ON o.supplier_id = s.supplier_id WHERE s.order_id = purchase_orders.id AND o.user_id = ${ctx.userId})`,
      );
    }
    const q = query.q?.trim();
    if (q) filters.push(ilike(purchaseOrders.number, `%${escapeLike(q)}%`));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(purchaseOrders.id, after.id));
    const rows = await this.db
      .select()
      .from(purchaseOrders)
      .where(and(...filters))
      .orderBy(desc(purchaseOrders.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const links =
      page.data.length === 0
        ? []
        : await this.db
            .select({
              orderId: purchaseOrderSuppliers.orderId,
              supplierId: purchaseOrderSuppliers.supplierId,
              status: purchaseOrderSuppliers.status,
            })
            .from(purchaseOrderSuppliers)
            .where(
              inArray(
                purchaseOrderSuppliers.orderId,
                page.data.map((row) => row.id),
              ),
            );
    const names = new Map(
      (await this.suppliers.getMany([...new Set(links.map((link) => link.supplierId))])).map(
        (supplier) => [supplier.id, supplier.name],
      ),
    );
    return {
      data: page.data.map((row) => {
        const own = links.filter((link) => link.orderId === row.id);
        return {
          id: row.id,
          number: row.number,
          orderDate: row.orderDate,
          note: row.note,
          status: row.status,
          supplierCount: own.length,
          supplierNames: own
            .map((link) => names.get(link.supplierId) ?? '')
            .sort((a, b) => a.localeCompare(b)),
          statusCounts: PO_SUPPLIER_STATUSES.flatMap((status) => {
            const count = own.filter((link) => link.status === status).length;
            return count === 0 ? [] : [{ status, count }];
          }),
          archivedAt: row.archivedAt,
          createdAt: row.createdAt,
        };
      }),
      nextCursor: page.nextCursor,
    };
  }

  /** The order's status: the lowest of its suppliers' (ADR-0115). */
  async refreshStatus(tx: Tx, orderId: number): Promise<void> {
    const rows = await tx
      .select({ status: purchaseOrderSuppliers.status })
      .from(purchaseOrderSuppliers)
      .where(eq(purchaseOrderSuppliers.orderId, orderId));
    await tx
      .update(purchaseOrders)
      .set({ status: lowestPoStatus(rows.map((row) => row.status)), updatedAt: sql`now()` })
      .where(eq(purchaseOrders.id, orderId));
  }

  /** Received in full, or nothing ordered on any supplier (ADR-0118 #7). */
  private async archivable(tx: Tx, order: OrderRow): Promise<boolean> {
    if (order.status === 'RECEIVED') return true;
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrderLines)
      .innerJoin(
        purchaseOrderSuppliers,
        eq(purchaseOrderSuppliers.id, purchaseOrderLines.orderSupplierId),
      )
      .where(eq(purchaseOrderSuppliers.orderId, order.id));
    return (row?.count ?? 0) === 0;
  }

  /**
   * The supplier's draft receipt at «Ирсэн» (ADR-0115, ADR-0118 #1): one per supplier, each line
   * expected in its unit as shipped (as ordered where nothing was typed), with its product's last
   * delivery-note price filled in (per that unit). A line shipped as 0 is left out.
   */
  private async makeReceipt(
    tx: Tx,
    actor: Actor,
    order: OrderRow,
    supplier: OrderSupplierRow,
  ): Promise<number> {
    const lines = (
      await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderSupplierId, supplier.id))
        .orderBy(purchaseOrderLines.id)
    ).filter((line) => line.shippedQty === null || !line.shippedQty.isZero());
    if (lines.length === 0) {
      throw new AppError('PO_SUPPLIER_EMPTY', `supplier ${supplier.supplierId} shipped nothing`);
    }
    const prices = new Map(
      (
        await this.receipts.lastPrices(
          lines.map((line) => line.productId),
          {},
          tx,
        )
      ).map((price) => [price.productId, price.basePrice]),
    );
    const homes = await this.locations.homeOf(
      lines.map((line) => line.productId),
      tx,
    );
    const homeless = lines.filter((line) => !homes.has(line.productId));
    if (homeless.length > 0) {
      throw new AppError('PRODUCT_NO_HOME', 'an ordered product has no home warehouse', {
        productId: homeless[0]?.productId ?? null,
      });
    }
    return this.receipts.createInTx(tx, actor, {
      supplierId: supplier.supplierId,
      supplierDocDate: businessDate(),
      origin: 'ORDER',
      originRef: order.number,
      lines: lines.map((line) => {
        const base = prices.get(line.productId);
        const expected = line.shippedQty ?? line.qty;
        return {
          productUnitId: line.productUnitId,
          enteredQty: expected,
          expectedQty: expected,
          ...(base ? { docUnitPrice: base.times(line.factorSnapshot).toDecimalPlaces(2) } : {}),
        };
      }),
    });
  }

  private async lockOrder(tx: Tx, id: number): Promise<OrderRow> {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, id))
      .for('update');
    if (!order) throw notFound('purchase order', id);
    return order;
  }

  private async lineCount(tx: Tx, orderSupplierId: number): Promise<number> {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderSupplierId, orderSupplierId));
    return row?.count ?? 0;
  }
}

/** Lines whose price (typed, else the draft's) differs from the product's previous one. */
function priceDifferences(costing: ReceiptCosting): number {
  let count = 0;
  for (const line of costing.lines) {
    if (line.previousUnitPrice === null || line.freeGoods) continue;
    const typed =
      line.docAmount !== null && !line.enteredQty.isZero()
        ? line.docAmount.div(line.enteredQty).toDecimalPlaces(2)
        : line.docUnitPrice;
    if (typed !== null && !typed.equals(line.previousUnitPrice)) count += 1;
  }
  return count;
}

function uniqueSuppliers(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function textOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}
