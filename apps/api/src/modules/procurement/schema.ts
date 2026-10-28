import { PO_SUPPLIER_STATUSES } from '@tugeel/shared/procurement';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { factor, qty } from '../../common/db/types';
import { productUnits, products } from '../catalog/schema';
import { users } from '../identity/schema';
import { goodsReceipts } from '../inventory/schema';
import { suppliers } from '../partners/schema';

// Tables owned by the procurement module (ADR-0115, docs/modules/procurement.md): purchase orders
// by supplier, their quantity lines, and each supplier's orderer. A supplier's arrival makes a draft
// goods receipt (inventory's), which this module links to its order.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const userRef = (name: string) => ref(name).references(() => users.id);

/** `column IN ('A', 'B')` for an enum list, written into CHECK constraints. */
const inList = (column: AnyPgColumn, values: readonly string[]) =>
  sql`${column} IN (${sql.raw(values.map((value) => `'${value}'`).join(', '))})`;

/**
 * A purchase order (PO-, numbered at creation like a sales order): several suppliers, each with its
 * own status; `status` is the lowest of them, kept in the transaction that moves one.
 */
export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: id(),
    number: text('number').notNull(),
    /** The business date the order was made for (Asia/Ulaanbaatar). */
    orderDate: date('order_date', { mode: 'string' }).notNull(),
    note: text('note'),
    status: text('status', { enum: PO_SUPPLIER_STATUSES }).notNull().default('PREPARING'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('purchase_orders_number_key').on(t.number),
    index('purchase_orders_status_idx').on(t.status, t.id),
    check('purchase_orders_status', inList(t.status, PO_SUPPLIER_STATUSES)),
    check('purchase_orders_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500`),
  ],
);

/** One supplier inside an order, with its status and, from «Ирсэн», its draft receipt. */
export const purchaseOrderSuppliers = pgTable(
  'purchase_order_suppliers',
  {
    id: id(),
    orderId: ref('order_id')
      .notNull()
      .references(() => purchaseOrders.id),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    status: text('status', { enum: PO_SUPPLIER_STATUSES }).notNull().default('PREPARING'),
    /** The goods receipt made when the supplier arrived (NULL before, and after a step back). */
    receiptId: ref('receipt_id').references(() => goodsReceipts.id),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }).notNull().defaultNow(),
    statusChangedBy: userRef('status_changed_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('purchase_order_suppliers_key').on(t.orderId, t.supplierId),
    unique('purchase_order_suppliers_receipt_key').on(t.receiptId),
    index('purchase_order_suppliers_supplier_idx').on(t.supplierId, t.orderId),
    check('purchase_order_suppliers_status', inList(t.status, PO_SUPPLIER_STATUSES)),
    check(
      'purchase_order_suppliers_receipt',
      sql`(${t.receiptId} IS NOT NULL) = (${t.status} IN ('ARRIVED', 'ACCOUNTING', 'RECEIVED'))`,
    ),
  ],
);

/**
 * An ordered quantity of one product from one supplier of an order, in any of its units; no row
 * means nothing ordered (a zero deletes the row).
 */
export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    id: id(),
    orderSupplierId: ref('order_supplier_id')
      .notNull()
      .references(() => purchaseOrderSuppliers.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    qty: qty('qty').notNull(),
    factorSnapshot: factor('factor_snapshot').notNull(),
    qtyBase: qty('qty_base').notNull(),
    updatedBy: userRef('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('purchase_order_lines_key').on(t.orderSupplierId, t.productId),
    index('purchase_order_lines_product_idx').on(t.productId),
    check('purchase_order_lines_qty', sql`${t.qty} > 0 AND ${t.qtyBase} > 0`),
  ],
);

/** The staff member who orders from a supplier (one per supplier, owner 2026-10-29). */
export const supplierOrderers = pgTable(
  'supplier_orderers',
  {
    supplierId: ref('supplier_id')
      .primaryKey()
      .references(() => suppliers.id),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [index('supplier_orderers_user_idx').on(t.userId)],
);
