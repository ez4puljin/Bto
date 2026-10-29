import { PO_EDITABLE_STATUSES, type PoSupplierStatus } from '@tugeel/shared/procurement';
import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import type { AuthContext } from '../../identity';
import { purchaseOrders, purchaseOrderSuppliers, supplierOrderers } from '../schema';

export const READ = 'procurement.orders.read';
export const EDIT = 'procurement.orders.edit';
export const MANAGE = 'procurement.orders.manage';
export const PRICES = 'procurement.prices.read';

export type OrderRow = typeof purchaseOrders.$inferSelect;
export type OrderSupplierRow = typeof purchaseOrderSuppliers.$inferSelect;

/** Locks the order, then its supplier row (the order of locks every writer keeps). */
export async function lockOrderSupplier(
  tx: Tx,
  orderId: number,
  supplierId: number,
): Promise<{ order: OrderRow; supplier: OrderSupplierRow }> {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId))
    .for('update');
  if (!order) throw notFound('purchase order', orderId);
  const rows = await tx
    .select()
    .from(purchaseOrderSuppliers)
    .where(eq(purchaseOrderSuppliers.orderId, orderId))
    .for('update');
  const supplier = rows.find((row) => row.supplierId === supplierId);
  if (!supplier) throw notFound('purchase order supplier', supplierId);
  return { order, supplier };
}

export async function ordererOf(tx: Db | Tx, supplierId: number): Promise<number | null> {
  const [row] = await tx
    .select({ userId: supplierOrderers.userId })
    .from(supplierOrderers)
    .where(eq(supplierOrderers.supplierId, supplierId));
  return row?.userId ?? null;
}

/**
 * Who may type a supplier's quantities (owner 2026-10-29, ADR-0115): a manager, or the supplier's
 * orderer, up to «Замд» — every product; anyone else with the edit right only in «Бэлдэж», only
 * for products whose home warehouse is in their scope. `all`: every product of the supplier;
 * `ownWarehouses`: only those; null: none.
 */
export type EditRight = { all: true } | { all: false; ownWarehouses: true } | null;

export function editRight(
  ctx: AuthContext,
  status: PoSupplierStatus,
  ordererId: number | null,
): EditRight {
  if (!PO_EDITABLE_STATUSES.includes(status)) return null;
  if (ctx.permissions.has(MANAGE)) return { all: true };
  if (!ctx.permissions.has(EDIT)) return null;
  if (ordererId === ctx.userId) return { all: true };
  return status === 'PREPARING' ? { all: false, ownWarehouses: true } : null;
}

/** May this person move the supplier (managers, and the orderer for the forward steps)? */
export function mayMove(ctx: AuthContext, ordererId: number | null, back: boolean): boolean {
  if (ctx.permissions.has(MANAGE)) return true;
  return !back && ctx.permissions.has(EDIT) && ordererId === ctx.userId;
}

export function canWriteHome(ctx: AuthContext, homeId: number | undefined): boolean {
  if (homeId === undefined) return false;
  return ctx.writableWarehouseIds === null || ctx.writableWarehouseIds.has(homeId);
}

export function assertManage(ctx: AuthContext): void {
  if (!ctx.permissions.has(MANAGE)) {
    throw new AppError('FORBIDDEN', 'purchase orders are managed by managers', {
      permission: MANAGE,
    });
  }
}
