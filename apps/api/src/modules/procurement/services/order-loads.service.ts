import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { actorUserId, type AuthContext, AuditService } from '../../identity';
import { purchaseOrderLoads, purchaseOrders, purchaseOrderSuppliers, trucks } from '../schema';
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

export interface OrderLoad {
  id: number;
  orderId: number;
  truckId: number;
  truckName: string;
  plate: string | null;
  capacityKg: Decimal | null;
  note: string | null;
  /** The suppliers riding on this load, by their supplier id. */
  supplierIds: number[];
}

/**
 * The company's trucks and the loads of a purchase order (owner 2026-10-30, after Butenorgil's
 * «Машины ачилт», ADR-0121): a manager names a truck on an order, which makes a load, and assigns
 * whole suppliers to it; a supplier rides on one load or none. Nothing here moves stock or money:
 * the loads are the dispatcher's plan, read beside the suppliers' statuses.
 */
@Injectable()
export class OrderLoadsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
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

  /** The order's loads with their trucks and the suppliers on each, oldest first. */
  async loadsOf(orderId: number, executor: Db | Tx = this.db): Promise<OrderLoad[]> {
    const rows = await executor
      .select({ load: purchaseOrderLoads, truck: trucks })
      .from(purchaseOrderLoads)
      .innerJoin(trucks, eq(trucks.id, purchaseOrderLoads.truckId))
      .where(eq(purchaseOrderLoads.orderId, orderId))
      .orderBy(asc(purchaseOrderLoads.id));
    if (rows.length === 0) return [];
    const riders = await executor
      .select({
        loadId: purchaseOrderSuppliers.loadId,
        supplierId: purchaseOrderSuppliers.supplierId,
      })
      .from(purchaseOrderSuppliers)
      .where(
        inArray(
          purchaseOrderSuppliers.loadId,
          rows.map((row) => row.load.id),
        ),
      );
    return rows.map(({ load, truck }) => ({
      id: load.id,
      orderId: load.orderId,
      truckId: load.truckId,
      truckName: truck.name,
      plate: truck.plate,
      capacityKg: truck.capacityKg,
      note: load.note,
      supplierIds: riders
        .filter((rider) => rider.loadId === load.id)
        .map((rider) => rider.supplierId),
    }));
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

  /** Takes a truck off the order; its suppliers become unassigned again. */
  removeLoad(ctx: AuthContext, orderId: number, loadId: number): Promise<void> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const order = await this.lockLiveOrder(tx, orderId);
      const [load] = await tx
        .select()
        .from(purchaseOrderLoads)
        .where(and(eq(purchaseOrderLoads.id, loadId), eq(purchaseOrderLoads.orderId, orderId)))
        .for('update');
      if (!load) throw notFound('purchase order load', loadId);
      const freed = await tx
        .update(purchaseOrderSuppliers)
        .set({ loadId: null })
        .where(eq(purchaseOrderSuppliers.loadId, loadId))
        .returning({ supplierId: purchaseOrderSuppliers.supplierId });
      await tx.delete(purchaseOrderLoads).where(eq(purchaseOrderLoads.id, loadId));
      await this.audit.record(tx, ctx, {
        action: 'LOAD_REMOVE',
        entity: 'purchase_orders',
        entityId: order.id,
        before: { loadId, truckId: load.truckId, supplierIds: freed.map((row) => row.supplierId) },
      });
    });
  }

  /** Puts a supplier on a load of its order, or takes it off (null). */
  assign(
    ctx: AuthContext,
    orderId: number,
    supplierId: number,
    loadId: number | null,
  ): Promise<void> {
    assertManage(ctx);
    return inTransaction(this.db, async (tx) => {
      const { order, supplier } = await lockOrderSupplier(tx, orderId, supplierId);
      if (order.archivedAt !== null) {
        throw new AppError('PO_NOT_EDITABLE', `order ${orderId} is archived`, {
          reason: 'ARCHIVED',
        });
      }
      if (loadId !== null) {
        const [load] = await tx
          .select({ id: purchaseOrderLoads.id })
          .from(purchaseOrderLoads)
          .where(and(eq(purchaseOrderLoads.id, loadId), eq(purchaseOrderLoads.orderId, orderId)));
        if (!load) throw notFound('purchase order load', loadId);
      }
      if (supplier.loadId === loadId) return;
      await tx
        .update(purchaseOrderSuppliers)
        .set({ loadId })
        .where(eq(purchaseOrderSuppliers.id, supplier.id));
      await this.audit.record(tx, ctx, {
        action: 'LOAD_ASSIGN',
        entity: 'purchase_order_suppliers',
        entityId: supplier.id,
        before: { supplierId, loadId: supplier.loadId },
        after: { supplierId, loadId },
      });
    });
  }

  private async lockLiveOrder(tx: Tx, orderId: number) {
    const [order] = await tx
      .select()
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))
      .for('update');
    if (!order) throw notFound('purchase order', orderId);
    if (order.archivedAt !== null) {
      throw new AppError('PO_NOT_EDITABLE', `order ${orderId} is archived`, { reason: 'ARCHIVED' });
    }
    return order;
  }
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
