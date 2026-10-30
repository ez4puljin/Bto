import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { CatalogService, UnitConversionService } from '../../catalog';
import { actorUserId, type AuthContext, AuditService } from '../../identity';
import { SuppliersService } from '../../partners';
import {
  purchaseOrderLines,
  purchaseOrderLoadLines,
  purchaseOrderLoads,
  purchaseOrders,
  purchaseOrderSuppliers,
  trucks,
} from '../schema';
import { assertManage, lockOrderSupplier } from './support';

export interface Truck {
  id: number;
  name: string;
  plate: string | null;
  capacityKg: Decimal | null;
  isActive: boolean;
}

export interface TruckInput {
  name: string;
  plate: string | null;
  capacityKg: Decimal | null;
}

/** A quantity of one order line riding on a load, in the line's own unit (boxes). */
export interface OrderLoadItem {
  lineId: number;
  supplierId: number;
  productId: number;
  qty: Decimal;
}

export interface OrderLoad {
  id: number;
  orderId: number;
  truckId: number;
  truckName: string;
  plate: string | null;
  capacityKg: Decimal | null;
  /** The truck was deactivated meanwhile; the load keeps its name. */
  truckActive: boolean;
  note: string | null;
  items: OrderLoadItem[];
}

/** What the dispatcher puts on a load: a quantity of a supplier's product (0 takes it off). */
export interface LoadLineInput {
  supplierId: number;
  productId: number;
  qty: Decimal;
}

export interface LoadLinesQuery {
  q?: string;
  supplierId?: number;
  /** Only lines with something still off every truck. */
  unassigned?: boolean;
  cursor?: string;
  limit?: number;
}

/** One order line as the loading screen reads it (ADR-0122): ordered, on which trucks, remaining. */
export interface LoadLineView {
  lineId: number;
  supplierId: number;
  supplierName: string;
  productId: number;
  sku: string;
  productName: string;
  unitName: string;
  /** Ordered, in the line's unit. */
  qty: Decimal;
  factor: Decimal;
  /** Weight of one line unit, kg (null without a product weight). */
  unitWeightKg: Decimal | null;
  loads: { loadId: number; qty: Decimal }[];
  remaining: Decimal;
}

export interface LoadLinesPage {
  data: LoadLineView[];
  nextCursor: string | null;
  total: number;
}

/** Load lines read per page at most. */
export const LOAD_LINES_PAGE = 200;
/** Lines written in one call at most. */
const MAX_LOAD_CHANGES = 500;

/**
 * The company's trucks and the loads of a purchase order (owner 2026-10-30, after Butenorgil's
 * «Машины ачилт», ADR-0121; by line since ADR-0122): a manager names a truck on an order, which
 * makes a load, and puts quantities of the suppliers' lines on it — a whole supplier at once, or
 * some of its lines, or a part of a line, so one supplier's goods may ride on several trucks.
 * Nothing here moves stock, money or a status: the loads are the dispatcher's plan.
 */
@Injectable()
export class OrderLoadsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly catalog: CatalogService,
    private readonly units: UnitConversionService,
    private readonly suppliers: SuppliersService,
  ) {}

  async trucks(includeInactive = false, executor: Db | Tx = this.db): Promise<Truck[]> {
    const rows = await executor
      .select()
      .from(trucks)
      .where(includeInactive ? undefined : eq(trucks.isActive, true))
      .orderBy(asc(trucks.name));
    return rows.map(truckOf);
  }

  createTruck(ctx: AuthContext, input: TruckInput): Promise<Truck> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const [taken] = await tx
        .select({ id: trucks.id })
        .from(trucks)
        .where(eq(trucks.name, input.name));
      if (taken) throw invalid('name', 'unique', 'a truck of this name exists');
      const [row] = await tx
        .insert(trucks)
        .values({ name: input.name, plate: input.plate, capacityKg: input.capacityKg })
        .returning();
      if (!row) throw new Error('truck insert returned nothing');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'trucks',
        entityId: row.id,
        after: row,
      });
      return truckOf(row);
    });
  }

  updateTruck(
    ctx: AuthContext,
    id: number,
    patch: Partial<TruckInput> & { isActive?: boolean },
  ): Promise<Truck> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const [before] = await tx.select().from(trucks).where(eq(trucks.id, id)).for('update');
      if (!before) throw notFound('truck', id);
      if (patch.name !== undefined && patch.name !== before.name) {
        const [taken] = await tx
          .select({ id: trucks.id })
          .from(trucks)
          .where(eq(trucks.name, patch.name));
        if (taken) throw invalid('name', 'unique', 'a truck of this name exists');
      }
      const [row] = await tx
        .update(trucks)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name }),
          ...(patch.plate === undefined ? {} : { plate: patch.plate }),
          ...(patch.capacityKg === undefined ? {} : { capacityKg: patch.capacityKg }),
          ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
          updatedAt: sql`now()`,
        })
        .where(eq(trucks.id, id))
        .returning();
      if (!row) throw notFound('truck', id);
      await this.audit.record(tx, ctx, {
        action: 'UPDATE',
        entity: 'trucks',
        entityId: id,
        before,
        after: row,
      });
      return truckOf(row);
    });
  }

  /** The order's loads with their trucks and what rides on each, oldest first. */
  async loadsOf(orderId: number, executor: Db | Tx = this.db): Promise<OrderLoad[]> {
    const rows = await executor
      .select({ load: purchaseOrderLoads, truck: trucks })
      .from(purchaseOrderLoads)
      .innerJoin(trucks, eq(trucks.id, purchaseOrderLoads.truckId))
      .where(eq(purchaseOrderLoads.orderId, orderId))
      .orderBy(asc(purchaseOrderLoads.id));
    if (rows.length === 0) return [];
    const items = await executor
      .select({
        loadId: purchaseOrderLoadLines.loadId,
        lineId: purchaseOrderLoadLines.lineId,
        qty: purchaseOrderLoadLines.qty,
        supplierId: purchaseOrderSuppliers.supplierId,
        productId: purchaseOrderLines.productId,
      })
      .from(purchaseOrderLoadLines)
      .innerJoin(purchaseOrderLines, eq(purchaseOrderLines.id, purchaseOrderLoadLines.lineId))
      .innerJoin(
        purchaseOrderSuppliers,
        eq(purchaseOrderSuppliers.id, purchaseOrderLines.orderSupplierId),
      )
      .where(
        inArray(
          purchaseOrderLoadLines.loadId,
          rows.map((row) => row.load.id),
        ),
      )
      .orderBy(asc(purchaseOrderLoadLines.id));
    return rows.map(({ load, truck }) => ({
      id: load.id,
      orderId: load.orderId,
      truckId: load.truckId,
      truckName: truck.name,
      plate: truck.plate,
      capacityKg: truck.capacityKg,
      truckActive: truck.isActive,
      note: load.note,
      items: items
        .filter((item) => item.loadId === load.id)
        .map((item) => ({
          lineId: item.lineId,
          supplierId: item.supplierId,
          productId: item.productId,
          qty: item.qty,
        })),
    }));
  }

  /**
   * The order's lines for the loading screen (ADR-0122): each with its supplier, product, unit,
   * ordered quantity, what rides on which load and what is still off every truck; searched by
   * product code or name, narrowed to a supplier or to the unassigned, 200 a page.
   */
  async lines(orderId: number, query: LoadLinesQuery): Promise<LoadLinesPage> {
    const [order] = await this.db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId));
    if (!order) throw notFound('purchase order', orderId);
    const rows = await this.db
      .select({ line: purchaseOrderLines, supplierId: purchaseOrderSuppliers.supplierId })
      .from(purchaseOrderLines)
      .innerJoin(
        purchaseOrderSuppliers,
        eq(purchaseOrderSuppliers.id, purchaseOrderLines.orderSupplierId),
      )
      .where(
        and(
          eq(purchaseOrderSuppliers.orderId, orderId),
          query.supplierId === undefined
            ? undefined
            : eq(purchaseOrderSuppliers.supplierId, query.supplierId),
        ),
      )
      .orderBy(asc(purchaseOrderLines.id));
    if (rows.length === 0) return { data: [], nextCursor: null, total: 0 };
    const loaded = await this.db
      .select({
        lineId: purchaseOrderLoadLines.lineId,
        loadId: purchaseOrderLoadLines.loadId,
        qty: purchaseOrderLoadLines.qty,
      })
      .from(purchaseOrderLoadLines)
      .innerJoin(purchaseOrderLoads, eq(purchaseOrderLoads.id, purchaseOrderLoadLines.loadId))
      .where(eq(purchaseOrderLoads.orderId, orderId))
      .orderBy(asc(purchaseOrderLoadLines.loadId));
    const products = new Map(
      (await this.catalog.getMany([...new Set(rows.map((row) => row.line.productId))])).map(
        (product) => [product.id, product],
      ),
    );
    const suppliers = new Map(
      (await this.suppliers.getMany([...new Set(rows.map((row) => row.supplierId))])).map(
        (supplier) => [supplier.id, supplier],
      ),
    );
    const units = await this.units.describe([
      ...new Set(rows.map((row) => row.line.productUnitId)),
    ]);
    const needle = query.q?.trim().toLowerCase() ?? '';
    const all = rows
      .map(({ line, supplierId }): LoadLineView => {
        const product = products.get(line.productId);
        const unit = units.get(line.productUnitId);
        const onLoads = loaded
          .filter((item) => item.lineId === line.id)
          .map((item) => ({ loadId: item.loadId, qty: item.qty }));
        const sum = onLoads.reduce((total, item) => total.plus(item.qty), new Decimal(0));
        const weight = product?.weightKg ?? null;
        return {
          lineId: line.id,
          supplierId,
          supplierName: suppliers.get(supplierId)?.name ?? '',
          productId: line.productId,
          sku: product?.sku ?? '',
          productName: product?.name ?? '',
          unitName: unit?.uomName ?? '',
          qty: line.qty,
          factor: line.factorSnapshot,
          unitWeightKg: weight ? weight.times(line.factorSnapshot) : null,
          loads: onLoads,
          remaining: Decimal.max(line.qty.minus(sum), 0),
        };
      })
      .filter((view) => !query.unassigned || !view.remaining.isZero())
      .filter(
        (view) =>
          needle === '' ||
          view.sku.toLowerCase().includes(needle) ||
          view.productName.toLowerCase().includes(needle) ||
          view.supplierName.toLowerCase().includes(needle),
      )
      .sort(
        (a, b) =>
          a.supplierName.localeCompare(b.supplierName) ||
          a.productName.localeCompare(b.productName),
      );
    const limit = Math.min(query.limit ?? LOAD_LINES_PAGE, LOAD_LINES_PAGE);
    const offset = offsetOf(query.cursor);
    const data = all.slice(offset, offset + limit);
    return {
      data,
      nextCursor: offset + limit < all.length ? String(offset + limit) : null,
      total: all.length,
    };
  }

  /** Names a truck on the order: one load per truck per order; the order must not be archived. */
  addLoad(ctx: AuthContext, orderId: number, truckId: number, note: string | null): Promise<void> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockLiveOrder(tx, orderId);
      const [truck] = await tx.select().from(trucks).where(eq(trucks.id, truckId));
      if (!truck || !truck.isActive) throw notFound('truck', truckId);
      const [exists] = await tx
        .select({ id: purchaseOrderLoads.id })
        .from(purchaseOrderLoads)
        .where(
          and(eq(purchaseOrderLoads.orderId, orderId), eq(purchaseOrderLoads.truckId, truckId)),
        );
      if (exists) throw invalid('truckId', 'unique', 'this truck is already on the order');
      const [row] = await tx
        .insert(purchaseOrderLoads)
        .values({ orderId, truckId, note, createdBy: actorUserId(ctx) })
        .returning();
      if (!row) throw new Error('load insert returned nothing');
      await this.audit.record(tx, ctx, {
        action: 'LOAD_ADD',
        entity: 'purchase_orders',
        entityId: order.id,
        after: { loadId: row.id, truckId, truckName: truck.name, note },
      });
    });
  }

  /** Takes a truck off the order; what rode on it becomes unassigned again. */
  removeLoad(ctx: AuthContext, orderId: number, loadId: number): Promise<void> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockLiveOrder(tx, orderId);
      const load = await this.lockLoad(tx, orderId, loadId);
      const freed = await tx
        .delete(purchaseOrderLoadLines)
        .where(eq(purchaseOrderLoadLines.loadId, loadId))
        .returning({ lineId: purchaseOrderLoadLines.lineId, qty: purchaseOrderLoadLines.qty });
      await tx.delete(purchaseOrderLoads).where(eq(purchaseOrderLoads.id, loadId));
      await this.audit.record(tx, ctx, {
        action: 'LOAD_REMOVE',
        entity: 'purchase_orders',
        entityId: order.id,
        before: {
          loadId,
          truckId: load.truckId,
          truckName: load.truckName,
          lines: freed.map((row) => ({ lineId: row.lineId, qty: row.qty.toString() })),
        },
      });
    });
  }

  /**
   * Puts a whole supplier on a load — every quantity of its lines still off any truck — or takes
   * all of it off every load (null).
   */
  assign(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    loadId: number | null,
  ): Promise<void> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const { order, supplier } = await lockOrderSupplier(tx, orderId, supplierId);
      assertLive(order.archivedAt, orderId);
      const lines = await tx
        .select()
        .from(purchaseOrderLines)
        .where(eq(purchaseOrderLines.orderSupplierId, supplier.id));
      if (lines.length === 0) return;
      const lineIds = lines.map((line) => line.id);
      if (loadId === null) {
        const removed = await tx
          .delete(purchaseOrderLoadLines)
          .where(inArray(purchaseOrderLoadLines.lineId, lineIds))
          .returning({ loadId: purchaseOrderLoadLines.loadId });
        if (removed.length === 0) return;
        await this.audit.record(tx, ctx, {
          action: 'LOAD_ASSIGN',
          entity: 'purchase_order_suppliers',
          entityId: supplier.id,
          before: { supplierId, loadIds: [...new Set(removed.map((row) => row.loadId))] },
          after: { supplierId, loadId: null },
        });
        return;
      }
      const load = await this.lockLoad(tx, orderId, loadId);
      const elsewhere = await this.loadedOf(tx, lineIds);
      let placed = 0;
      for (const line of lines) {
        const onThis = elsewhere.get(line.id)?.get(loadId) ?? new Decimal(0);
        const total = [...(elsewhere.get(line.id)?.values() ?? [])].reduce(
          (sum, qty) => sum.plus(qty),
          new Decimal(0),
        );
        const free = line.qty.minus(total);
        if (free.lte(0)) continue;
        await this.upsertLoadLine(tx, ctx, loadId, line.id, onThis.plus(free));
        placed += 1;
      }
      await this.audit.record(tx, ctx, {
        action: 'LOAD_ASSIGN',
        entity: 'purchase_order_suppliers',
        entityId: supplier.id,
        before: { supplierId },
        after: { supplierId, loadId, truckName: load.truckName, lines: placed },
      });
    });
  }

  /**
   * Sets what a load carries of the given lines (ADR-0122): each quantity replaces the one on this
   * load (0 takes the line off it); a quantity may not exceed what the line has off other trucks.
   */
  setLines(
    ctx: AuthContext,
    orderId: number,
    loadId: number,
    inputs: readonly LoadLineInput[],
  ): Promise<void> {
    assertManage(ctx);
    if (inputs.length > MAX_LOAD_CHANGES) {
      throw invalid('lines', 'max', `at most ${MAX_LOAD_CHANGES} lines per save`);
    }
    const keys = inputs.map((input) => `${input.supplierId}:${input.productId}`);
    if (new Set(keys).size !== keys.length) {
      throw invalid('lines', 'unique', 'one quantity per supplier and product');
    }
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockLiveOrder(tx, orderId);
      const load = await this.lockLoad(tx, orderId, loadId);
      if (inputs.length === 0) return;
      const supplierIds = [...new Set(inputs.map((input) => input.supplierId))];
      const supplierRows = await tx
        .select({ id: purchaseOrderSuppliers.id, supplierId: purchaseOrderSuppliers.supplierId })
        .from(purchaseOrderSuppliers)
        .where(
          and(
            eq(purchaseOrderSuppliers.orderId, orderId),
            inArray(purchaseOrderSuppliers.supplierId, supplierIds),
          ),
        );
      const rowOfSupplier = new Map(supplierRows.map((row) => [row.supplierId, row.id]));
      const lines = await tx
        .select()
        .from(purchaseOrderLines)
        .where(
          inArray(
            purchaseOrderLines.orderSupplierId,
            supplierRows.map((row) => row.id),
          ),
        )
        .for('update');
      const lineOf = new Map(
        lines.map((line) => [`${line.orderSupplierId}:${line.productId}`, line]),
      );
      const elsewhere = await this.loadedOf(
        tx,
        lines.map((line) => line.id),
      );
      const changes: { productId: number; supplierId: number; from: string; to: string }[] = [];
      for (const input of inputs) {
        const rowId = rowOfSupplier.get(input.supplierId);
        const line = rowId === undefined ? undefined : lineOf.get(`${rowId}:${input.productId}`);
        if (!line) {
          throw notFound('purchase order line', input.productId);
        }
        if (input.qty.isNegative() || input.qty.decimalPlaces() > 3) {
          throw invalid('lines', 'qty', 'a load quantity is zero or more, 3 decimals at most');
        }
        const onLoads = elsewhere.get(line.id) ?? new Map<number, Decimal>();
        const onThis = onLoads.get(loadId) ?? new Decimal(0);
        const onOthers = [...onLoads.entries()]
          .filter(([id]) => id !== loadId)
          .reduce((sum, [, qty]) => sum.plus(qty), new Decimal(0));
        if (input.qty.plus(onOthers).gt(line.qty)) {
          throw new AppError('PO_LOAD_OVER', `line ${line.id} has less to load`, {
            productId: input.productId,
            supplierId: input.supplierId,
            ordered: line.qty.toString(),
            elsewhere: onOthers.toString(),
          });
        }
        if (onThis.equals(input.qty)) continue;
        if (input.qty.isZero()) {
          await tx
            .delete(purchaseOrderLoadLines)
            .where(
              and(
                eq(purchaseOrderLoadLines.loadId, loadId),
                eq(purchaseOrderLoadLines.lineId, line.id),
              ),
            );
        } else {
          await this.upsertLoadLine(tx, ctx, loadId, line.id, input.qty);
        }
        changes.push({
          productId: input.productId,
          supplierId: input.supplierId,
          from: onThis.toString(),
          to: input.qty.toString(),
        });
      }
      if (changes.length === 0) return;
      await this.audit.recordMany(
        tx,
        ctx,
        changes.map((change) => ({
          action: 'LOAD_LINE',
          entity: 'purchase_order_suppliers',
          entityId: rowOfSupplier.get(change.supplierId) ?? order.id,
          before: { productId: change.productId, loaded: change.from },
          after: {
            productId: change.productId,
            loaded: { loadId, truckName: load.truckName, qty: change.to },
          },
        })),
      );
    });
  }

  /** What rides on which load, per line id: line → (load → qty). */
  private async loadedOf(
    tx: Tx,
    lineIds: readonly number[],
  ): Promise<Map<number, Map<number, Decimal>>> {
    const result = new Map<number, Map<number, Decimal>>();
    if (lineIds.length === 0) return result;
    const rows = await tx
      .select({
        lineId: purchaseOrderLoadLines.lineId,
        loadId: purchaseOrderLoadLines.loadId,
        qty: purchaseOrderLoadLines.qty,
      })
      .from(purchaseOrderLoadLines)
      .where(inArray(purchaseOrderLoadLines.lineId, [...lineIds]));
    for (const row of rows) {
      const byLoad = result.get(row.lineId) ?? new Map<number, Decimal>();
      byLoad.set(row.loadId, row.qty);
      result.set(row.lineId, byLoad);
    }
    return result;
  }

  private async upsertLoadLine(
    tx: Tx,
    ctx: AuthContext,
    loadId: number,
    lineId: number,
    qty: Decimal,
  ): Promise<void> {
    await tx
      .insert(purchaseOrderLoadLines)
      .values({ loadId, lineId, qty, createdBy: actorUserId(ctx) })
      .onConflictDoUpdate({
        target: [purchaseOrderLoadLines.loadId, purchaseOrderLoadLines.lineId],
        set: { qty, updatedAt: sql`now()` },
      });
  }

  private async lockLoad(tx: Tx, orderId: number, loadId: number) {
    const [row] = await tx
      .select({ load: purchaseOrderLoads, truckName: trucks.name })
      .from(purchaseOrderLoads)
      .innerJoin(trucks, eq(trucks.id, purchaseOrderLoads.truckId))
      .where(and(eq(purchaseOrderLoads.id, loadId), eq(purchaseOrderLoads.orderId, orderId)))
      .for('update', { of: purchaseOrderLoads });
    if (!row) throw notFound('purchase order load', loadId);
    return { ...row.load, truckName: row.truckName };
  }

  private async lockLiveOrder(tx: Tx, orderId: number) {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))
      .for('update');
    if (!order) throw notFound('purchase order', orderId);
    assertLive(order.archivedAt, orderId);
    return order;
  }
}

function assertLive(archivedAt: Date | null, orderId: number): void {
  if (archivedAt !== null) {
    throw new AppError('PO_NOT_EDITABLE', `order ${orderId} is archived`, { reason: 'ARCHIVED' });
  }
}

function offsetOf(cursor: string | undefined): number {
  if (cursor === undefined || !/^\d{1,7}$/.test(cursor)) return 0;
  return Number.parseInt(cursor, 10);
}

function truckOf(row: typeof trucks.$inferSelect): Truck {
  return {
    id: row.id,
    name: row.name,
    plate: row.plate,
    capacityKg: row.capacityKg,
    isActive: row.isActive,
  };
}
