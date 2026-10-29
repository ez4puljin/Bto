import {
  PO_EDITABLE_STATUSES,
  PO_SHIPPING_STATUS,
  type PoSupplierStatus,
} from '@tugeel/shared/procurement';
import { eq } from 'drizzle-orm';
import type { Db, Tx } from '../../../common/db/db.types';
import { AppError, notFound } from '../../../common/errors/app-error';
import type { AuthContext } from '../../identity';
import { purchaseOrders, purchaseOrderSuppliers, supplierOrderers } from '../schema';

export const READ = 'procurement.orders.read';
export const EDIT = 'procurement.orders.edit';
export const MANAGE = 'procurement.orders.manage';
export const PRICES = 'procurement.prices.read';
/** Inventory's rights the order page leans on (ADR-0118): the keeper's count and the price check. */
export const RECEIPTS = 'inventory.receipts.manage';
export const COSTS = 'inventory.costs.manage';

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
 * Who may type a supplier's quantities (owner 2026-10-29, ADR-0115, ADR-0118): a manager, or the
 * supplier's orderer, up to «Замд» — every product; anyone else with the edit right only in
 * «Бэлдэж», only for products whose home warehouse is in their scope. `all`: every product of the
 * supplier; `ownWarehouses`: only those; null: none.
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

/** The shipped quantities (ADR-0118 #1): a manager or the orderer, in «Ачигдаж байна» only. */
export function canShip(
  ctx: AuthContext,
  status: PoSupplierStatus,
  ordererId: number | null,
): boolean {
  if (status !== PO_SHIPPING_STATUS) return false;
  if (ctx.permissions.has(MANAGE)) return true;
  return ctx.permissions.has(EDIT) && ordererId === ctx.userId;
}

/**
 * The arrived quantity of a receipt line on the order page (ADR-0118 #5): in «Ирсэн», a manager
 * for every line, a receipt holder for the lines of a warehouse in their write scope.
 */
export function canCount(ctx: AuthContext, status: PoSupplierStatus, warehouseId: number): boolean {
  if (status !== 'ARRIVED') return false;
  if (ctx.permissions.has(MANAGE)) return true;
  return ctx.permissions.has(RECEIPTS) && canWriteHome(ctx, warehouseId);
}

/** The price check on the order page (ADR-0118 #5): a cost holder in «Нягтлан шалгаж». */
export function canPrice(ctx: AuthContext, status: PoSupplierStatus): boolean {
  return status === 'ACCOUNTING' && ctx.permissions.has(COSTS);
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
