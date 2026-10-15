import { PRICE_BASES } from '@tugeel/shared/pricing';
import {
  FULFILMENTS,
  ORDER_CHANNELS,
  ORDER_LIMITS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
} from '@tugeel/shared/sales';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { coordinate, factor, jsonValue, money, qty } from '../../common/db/types';
import { productUnits, products } from '../catalog/schema';
import { users, warehouses } from '../identity/schema';
import { customerAddresses, customers } from '../partners/schema';

// The tables owned by the sales module (docs/modules/sales.md, ADR-0055). Migration
// 0023_sales_orders adds by hand the REVOKEs that keep orders, their lines, parts and events from
// being deleted: an order is cancelled, never removed, and its history stays.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;

/**
 * A customer order (architecture §5.6). A draft has no number and no prices; the office's submit
 * confirms it in one transaction (ADR-0055): `SO-` number, prices frozen on the lines, stock
 * reserved per line. The address is copied from the customer's address at the time.
 */
export const salesOrders = pgTable(
  'sales_orders',
  {
    id: id(),
    number: text('number'),
    channel: text('channel', { enum: ORDER_CHANNELS }).notNull().default('ADMIN'),
    status: text('status', { enum: ORDER_STATUSES }).notNull().default('DRAFT'),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    fulfilment: text('fulfilment', { enum: FULFILMENTS }).notNull(),
    /** The Ulaanbaatar day the customer expects the goods. */
    deliveryDate: date('delivery_date', { mode: 'string' }).notNull(),
    addressId: ref('address_id').references(() => customerAddresses.id),
    addressText: text('address_text'),
    addressLat: coordinate('address_lat'),
    addressLng: coordinate('address_lng'),
    contactName: text('contact_name'),
    /** E.164 (+976…). */
    contactPhone: text('contact_phone'),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }).notNull(),
    note: text('note'),
    /** The day the prices were taken (submit). */
    priceDate: date('price_date', { mode: 'string' }),
    subtotal: money('subtotal'),
    discountTotal: money('discount_total'),
    total: money('total'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submittedBy: userRef('submitted_by'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: userRef('cancelled_by'),
    cancelReason: text('cancel_reason'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sales_orders_number').on(t.number),
    index('sales_orders_customer_idx').on(t.customerId, t.id),
    index('sales_orders_status_idx').on(t.status, t.id),
    check('sales_orders_status', inList(t.status, ORDER_STATUSES)),
    check('sales_orders_channel', inList(t.channel, ORDER_CHANNELS)),
    check('sales_orders_fulfilment', inList(t.fulfilment, FULFILMENTS)),
    check('sales_orders_payment_method', inList(t.paymentMethod, PAYMENT_METHODS)),
    check(
      'sales_orders_submitted',
      sql`(${t.submittedAt} IS NULL) = (${t.number} IS NULL) AND (${t.submittedAt} IS NULL) = (${t.priceDate} IS NULL) AND (${t.submittedAt} IS NULL) = (${t.total} IS NULL)`,
    ),
    check(
      'sales_orders_draft',
      sql`(${t.status} = 'DRAFT') = (${t.submittedAt} IS NULL AND ${t.cancelledAt} IS NULL)`,
    ),
    check(
      'sales_orders_cancelled',
      sql`(${t.status} = 'CANCELLED') = (${t.cancelledAt} IS NOT NULL)`,
    ),
    check(
      'sales_orders_address',
      sql`${t.submittedAt} IS NULL OR ${t.fulfilment} = 'PICKUP' OR ${t.addressId} IS NOT NULL`,
    ),
    check(
      'sales_orders_note',
      sql`${t.note} IS NULL OR length(${t.note}) <= ${sql.raw(String(ORDER_LIMITS.maxNote))}`,
    ),
    check(
      'sales_orders_contact',
      sql`(${t.contactName} IS NULL OR length(${t.contactName}) <= ${sql.raw(String(ORDER_LIMITS.maxContactName))}) AND (${t.contactPhone} IS NULL OR ${t.contactPhone} ~ '^\\+976[0-9]{8}$')`,
    ),
    check(
      'sales_orders_cancel_reason',
      sql`${t.cancelReason} IS NULL OR length(${t.cancelReason}) <= ${sql.raw(String(ORDER_LIMITS.maxCancelReason))}`,
    ),
    check(
      'sales_orders_totals',
      sql`${t.total} IS NULL OR (${t.subtotal} >= 0 AND ${t.discountTotal} >= 0 AND ${t.total} = ${t.subtotal} - ${t.discountTotal})`,
    ),
  ],
);

/**
 * An order line: a product in one of its units, from the product's home warehouse (ADR-0055 #3).
 * Prices and the reserved / backordered split are written at submit.
 */
export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: id(),
    orderId: ref('order_id')
      .notNull()
      .references(() => salesOrders.id),
    lineNo: smallint('line_no').notNull(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    /** In the line's unit. */
    qty: qty('qty').notNull(),
    factorSnapshot: factor('factor_snapshot').notNull(),
    qtyBase: qty('qty_base').notNull(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    /** Base units reserved at confirmation. */
    qtyApproved: qty('qty_approved')
      .notNull()
      .default(sql`0`),
    /** Base units wanted beyond the available stock (SPEC §6.4 #4). */
    qtyBackordered: qty('qty_backordered')
      .notNull()
      .default(sql`0`),
    subtotal: money('subtotal'),
    discountAmount: money('discount_amount'),
    total: money('total'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sales_order_lines_no').on(t.orderId, t.lineNo),
    index('sales_order_lines_product_idx').on(t.productId),
    check(
      'sales_order_lines_qty',
      sql`${t.qty} > 0 AND ${t.qtyBase} > 0 AND ${t.factorSnapshot} > 0`,
    ),
    check(
      'sales_order_lines_split',
      sql`${t.qtyApproved} >= 0 AND ${t.qtyBackordered} >= 0 AND ${t.qtyApproved} + ${t.qtyBackordered} <= ${t.qtyBase}`,
    ),
    check(
      'sales_order_lines_totals',
      sql`${t.total} IS NULL OR ${t.total} = ${t.subtotal} - ${t.discountAmount}`,
    ),
  ],
);

/** A line's price parts frozen at submit (ADR-0048 #4): whole packs and loose pieces each. */
export const salesOrderLineParts = pgTable(
  'sales_order_line_parts',
  {
    id: id(),
    lineId: ref('line_id')
      .notNull()
      .references(() => salesOrderLines.id),
    partNo: smallint('part_no').notNull(),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    uomName: text('uom_name').notNull(),
    basis: text('basis', { enum: PRICE_BASES }).notNull(),
    qty: qty('qty').notNull(),
    factorSnapshot: factor('factor_snapshot').notNull(),
    qtyBase: qty('qty_base').notNull(),
    listPrice: money('list_price').notNull(),
    unitPrice: money('unit_price').notNull(),
    subtotal: money('subtotal').notNull(),
    discountAmount: money('discount_amount').notNull(),
    total: money('total').notNull(),
    /** The programs applied, as the quote named them. */
    applied: jsonValue('applied').notNull(),
  },
  (t) => [
    unique('sales_order_line_parts_no').on(t.lineId, t.partNo),
    check('sales_order_line_parts_basis', inList(t.basis, PRICE_BASES)),
    check('sales_order_line_parts_qty', sql`${t.qty} > 0 AND ${t.qtyBase} > 0`),
    check(
      'sales_order_line_parts_money',
      sql`${t.listPrice} >= 0 AND ${t.unitPrice} >= 0 AND ${t.discountAmount} >= 0 AND ${t.total} = ${t.subtotal} - ${t.discountAmount}`,
    ),
  ],
);

/** Every state change of an order: who, when, from what to what, why. */
export const orderStatusEvents = pgTable(
  'order_status_events',
  {
    id: id(),
    orderId: ref('order_id')
      .notNull()
      .references(() => salesOrders.id),
    fromStatus: text('from_status', { enum: ORDER_STATUSES }),
    toStatus: text('to_status', { enum: ORDER_STATUSES }).notNull(),
    reason: text('reason'),
    actorId: userRef('actor_id'),
    actorLabel: text('actor_label'),
    createdAt: createdAt(),
  },
  (t) => [
    index('order_status_events_order_idx').on(t.orderId, t.id),
    check('order_status_events_to', inList(t.toStatus, ORDER_STATUSES)),
    check(
      'order_status_events_from',
      sql`${t.fromStatus} IS NULL OR ${inList(t.fromStatus, ORDER_STATUSES)}`,
    ),
  ],
);
