import { PO_SUPPLIER_STATUSES } from '@tugeel/shared/procurement';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { factor, money, qty } from '../../common/db/types';
import { productUnits, products } from '../catalog/schema';
import { files, users } from '../identity/schema';
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
    /** Set by a manager once the order is received (or nothing was ordered); hidden from the list (ADR-0118 #7). */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: userRef('archived_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('purchase_orders_number_key').on(t.number),
    index('purchase_orders_status_idx').on(t.status, t.id),
    index('purchase_orders_archived_idx').on(t.archivedAt, t.id),
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
    /**
     * What the supplier shipped, in the line's unit, typed in «Ачигдаж байна» (ADR-0118 #1): NULL
     * until typed (the receipt then expects the ordered quantity); 0 = not shipped, left out of
     * the receipt.
     */
    shippedQty: qty('shipped_qty'),
    updatedBy: userRef('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('purchase_order_lines_key').on(t.orderSupplierId, t.productId),
    index('purchase_order_lines_product_idx').on(t.productId),
    check('purchase_order_lines_qty', sql`${t.qty} > 0 AND ${t.qtyBase} > 0`),
    check('purchase_order_lines_shipped', sql`${t.shippedQty} IS NULL OR ${t.shippedQty} >= 0`),
  ],
);

/** A company truck (ADR-0121): a name, its plate and what it carries, in kg. */
export const trucks = pgTable(
  'trucks',
  {
    id: id(),
    name: text('name').notNull(),
    plate: text('plate'),
    capacityKg: qty('capacity_kg'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('trucks_name_key').on(t.name),
    check('trucks_name', sql`length(${t.name}) BETWEEN 1 AND 80`),
    check('trucks_plate', sql`${t.plate} IS NULL OR length(${t.plate}) BETWEEN 1 AND 20`),
    check('trucks_capacity', sql`${t.capacityKg} IS NULL OR ${t.capacityKg} > 0`),
  ],
);

/**
 * One truck's load on an order (ADR-0121): a truck appears once per order. What rides on it is
 * said by line (`purchase_order_loads_lines`, ADR-0122): a supplier's goods may be split over
 * several trucks; removing the load frees its lines.
 */
export const purchaseOrderLoads = pgTable(
  'purchase_order_loads',
  {
    id: id(),
    orderId: ref('order_id')
      .notNull()
      .references(() => purchaseOrders.id),
    truckId: ref('truck_id')
      .notNull()
      .references(() => trucks.id),
    note: text('note'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('purchase_order_loads_key').on(t.orderId, t.truckId),
    check(
      'purchase_order_loads_note',
      sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`,
    ),
  ],
);

/**
 * A quantity of one order line on one load (ADR-0122), in the line's own unit (boxes): the sum
 * over the loads of a line never exceeds its ordered quantity; a line not here is unassigned.
 */
export const purchaseOrderLoadLines = pgTable(
  'purchase_order_load_lines',
  {
    id: id(),
    loadId: ref('load_id')
      .notNull()
      .references(() => purchaseOrderLoads.id),
    lineId: ref('line_id')
      .notNull()
      .references(() => purchaseOrderLines.id),
    qty: qty('qty').notNull(),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('purchase_order_load_lines_key').on(t.loadId, t.lineId),
    index('purchase_order_load_lines_line_idx').on(t.lineId),
    check('purchase_order_load_lines_qty', sql`${t.qty} > 0`),
  ],
);

export const PO_INVOICE_CHECK_STATUSES = ['PENDING', 'DONE', 'FAILED'] as const;
export type PoInvoiceCheckStatus = (typeof PO_INVOICE_CHECK_STATUSES)[number];

/**
 * The AI's reading of a supplier's final invoice (ADR-0122): the photo (a private file of
 * identity's), what the model read from it and how it compares with the ordered lines. `result`
 * holds the structured comparison; the prompt and the raw answer are never stored (ADR-0045 #7).
 */
export const purchaseOrderInvoiceChecks = pgTable(
  'purchase_order_invoice_checks',
  {
    id: id(),
    orderSupplierId: ref('order_supplier_id')
      .notNull()
      .references(() => purchaseOrderSuppliers.id),
    fileId: ref('file_id')
      .notNull()
      .references(() => files.id),
    status: text('status', { enum: PO_INVOICE_CHECK_STATUSES }).notNull().default('PENDING'),
    /** The model that answered, as the provider reports it. */
    model: text('model'),
    /** The invoice's total as the model read it. */
    invoiceTotal: money('invoice_total'),
    /** Σ ordered × last price per base unit at the time of the check (the order's estimate). */
    orderedTotal: money('ordered_total'),
    result: jsonb('result'),
    errorReason: text('error_reason'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('purchase_order_invoice_checks_supplier_idx').on(t.orderSupplierId),
    check('purchase_order_invoice_checks_status', inList(t.status, PO_INVOICE_CHECK_STATUSES)),
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
