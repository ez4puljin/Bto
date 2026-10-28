import { Inject, Injectable } from '@nestjs/common';
import { formatDocNumber } from '@tugeel/shared/inventory';
import { Decimal } from '@tugeel/shared/money';
import {
  lowestPoStatus,
  MAX_PO_SUPPLIERS,
  nextPoStatus,
  type PoSupplierStatus,
  previousPoStatus,
} from '@tugeel/shared/procurement';
import { businessDate, businessYear } from '@tugeel/shared/time';
import { and, desc, eq, ilike, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { escapeLike } from '../../../common/db/like';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { CatalogService } from '../../catalog';
import {
  type Actor,
  actorUserId,
  type AuthContext,
  AuditService,
  NumberingService,
  UserNamesService,
} from '../../identity';
import { ProductLocationsService, ReceiptsService } from '../../inventory';
import { SuppliersService } from '../../partners';
import {
  purchaseOrderLines,
  purchaseOrders,
  purchaseOrderSuppliers,
  supplierOrderers,
} from '../schema';
import {
  assertManage,
  editRight,
  lockOrderSupplier,
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
  qtyBase: Decimal;
  weightKg: Decimal;
  /** Σ ordered base quantity × each product's last receipt price per base unit (price readers). */
  estimatedCost: Decimal | null;
  /** The draft or posted receipt from «Ирсэн» on. */
  receiptId: number | null;
  receiptNumber: string | null;
  /** What the caller may do now. */
  canEdit: boolean;
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
  suppliers: PurchaseOrderSupplierView[];
}

export interface PurchaseOrderSummary {
  id: number;
  number: string;
  orderDate: string;
  note: string | null;
  status: PoSupplierStatus;
  supplierCount: number;
  supplierNames: string[];
  createdAt: Date;
}

export interface PurchaseOrderQuery {
  status?: PoSupplierStatus;
  supplierId?: number;
  /** Orders holding a supplier the caller orders from. */
  mine?: boolean;
  q?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Purchase orders (ADR-0115): one order holds several suppliers, each with its own status; the
 * order shows the lowest. Managers create orders and add or remove suppliers; a manager or the
 * supplier's orderer moves it through «Бэлдэж» → «Илгээсэн» → «Замд» → «Ирсэн», where its draft
 * goods receipt is made with the ordered quantities expected and the last prices filled in; only a
 * manager steps back, from «Ирсэн» only while no keeper confirmed the receipt. The receipt's
 * keepers and accountant move it on («Нягтлан шалгаж», «Орлого авсан») through the inventory hook
 * (`OrderProgressService`). Every write locks the order first, then its supplier rows.
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
    private readonly locations: ProductLocationsService,
    private readonly receipts: ReceiptsService,
  ) {}

  create(ctx: AuthContext, input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    assertManage(ctx);
    const supplierIds = uniqueSuppliers(input.supplierIds);
    if (supplierIds.length === 0) {
      throw invalid('supplierIds', 'required', 'choose at least one supplier');
    }
    return inTransaction(this.db, async (tx) => {
      for (const supplierId of supplierIds) await this.suppliers.assertActive(tx, supplierId);
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

  update(ctx: AuthContext, id: number, patch: { note?: string | null }): Promise<PurchaseOrderDetail> {
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
      for (const supplierId of fresh) await this.suppliers.assertActive(tx, supplierId);
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
   * Moves a supplier one status forward or back (ADR-0115). «Ирсэн» makes its draft receipt; back
   * from «Ирсэн» cancels it, refused once a keeper confirmed a warehouse. The receipt's own steps
   * (ACCOUNTING, RECEIVED) are never set here.
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
          permission: 'procurement.orders.manage',
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
      let receiptId: number | null = back && supplier.status === 'ARRIVED' ? null : supplier.receiptId;
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

  async get(ctx: AuthContext, id: number, executor: Db | Tx = this.db): Promise<PurchaseOrderDetail> {
    const [order] = await executor.select().from(purchaseOrders).where(eq(purchaseOrders.id, id));
    if (!order) throw notFound('purchase order', id);
    const rows = await executor
      .select()
      .from(purchaseOrderSuppliers)
      .where(eq(purchaseOrderSuppliers.orderId, id))
      .orderBy(purchaseOrderSuppliers.id);
    const suppliers = new Map(
      (await this.suppliers.getMany(rows.map((row) => row.supplierId), executor)).map(
        (supplier) => [supplier.id, supplier],
      ),
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
    const prices = ctx.permissions.has(PRICES)
      ? new Map(
          (await this.receipts.lastPrices(productIds, {}, executor)).map((price) => [
            price.productId,
            price.basePrice,
          ]),
        )
      : null;
    const names = await this.userNames.namesOf(
      [...orderers.values(), ...(order.createdBy === null ? [] : [order.createdBy])],
    );
    const receiptNumbers = new Map<number, string | null>();
    for (const row of rows) {
      if (row.receiptId !== null) {
        receiptNumbers.set(row.receiptId, (await this.receipts.get(row.receiptId, executor)).number);
      }
    }
    const zero = new Decimal(0);
    return {
      id: order.id,
      number: order.number,
      orderDate: order.orderDate,
      note: order.note,
      status: order.status,
      createdBy: order.createdBy === null ? null : (names.get(order.createdBy) ?? null),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      suppliers: rows
        .map((row) => {
          const own = lines.filter((line) => line.orderSupplierId === row.id);
          const ordererId = orderers.get(row.supplierId) ?? null;
          const supplier = suppliers.get(row.supplierId);
          return {
            supplierId: row.supplierId,
            supplierCode: supplier?.code ?? '',
            supplierName: supplier?.name ?? '',
            status: row.status,
            statusChangedAt: row.statusChangedAt,
            ordererId,
            ordererName: ordererId === null ? null : (names.get(ordererId) ?? null),
            lineCount: own.length,
            qtyBase: own.reduce((sum, line) => sum.plus(line.qtyBase), zero),
            weightKg: own.reduce((sum, line) => {
              const weight = weights.get(line.productId);
              return weight ? sum.plus(weight.times(line.qtyBase)) : sum;
            }, zero),
            estimatedCost: prices
              ? own.reduce((sum, line) => {
                  const price = prices.get(line.productId);
                  return price ? sum.plus(price.times(line.qtyBase)) : sum;
                }, zero).toDecimalPlaces(2)
              : null,
            receiptId: row.receiptId,
            receiptNumber: row.receiptId === null ? null : (receiptNumbers.get(row.receiptId) ?? null),
            canEdit: editRight(ctx, row.status, ordererId) !== null,
            canMoveNext:
              nextPoStatus(row.status) !== null && mayMove(ctx, ordererId, false),
            canMoveBack:
              previousPoStatus(row.status) !== null && mayMove(ctx, ordererId, true),
          };
        })
        .sort((a, b) => a.supplierName.localeCompare(b.supplierName)),
    };
  }

  async list(
    ctx: AuthContext,
    query: PurchaseOrderQuery,
  ): Promise<{ data: PurchaseOrderSummary[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    // Spelled out: Drizzle leaves the columns of a single-table select unqualified.
    if (query.status) filters.push(eq(purchaseOrders.status, query.status));
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

  /**
   * The supplier's draft receipt at «Ирсэн» (ADR-0115): one per supplier, each ordered line
   * expected in its unit with its product's last delivery-note price filled in (per that unit).
   */
  private async makeReceipt(
    tx: Tx,
    actor: Actor,
    order: OrderRow,
    supplier: OrderSupplierRow,
  ): Promise<number> {
    const lines = await tx
      .select()
      .from(purchaseOrderLines)
      .where(eq(purchaseOrderLines.orderSupplierId, supplier.id))
      .orderBy(purchaseOrderLines.id);
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
        return {
          productUnitId: line.productUnitId,
          enteredQty: line.qty,
          expectedQty: line.qty,
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

function uniqueSuppliers(ids: readonly number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

function textOrNull(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}
