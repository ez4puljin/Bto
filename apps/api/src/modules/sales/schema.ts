import { PRICE_BASES } from '@tugeel/shared/pricing';
import {
  BOARD_LIMITS,
  BOARD_RIGHTS,
  FULFILMENTS,
  ORDER_CHANNELS,
  ORDER_LIMITS,
  ORDER_STATUSES,
  PAYMENT_METHODS,
  STAGE_ACTIONS,
  STAGE_RIGHTS,
} from '@tugeel/shared/sales';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { coordinate, factor, jsonValue, money, qty } from '../../common/db/types';
import { productUnits, products } from '../catalog/schema';
import { branches, roles, users, warehouses } from '../identity/schema';
import { bins } from '../inventory/schema';
import { customerAddresses, customers } from '../partners/schema';

// The tables owned by the sales module (docs/modules/sales.md, ADR-0055, ADR-0056). Migration
// 0023_sales_orders adds by hand the REVOKEs that keep orders, their lines, parts and events from
// being deleted: an order is cancelled, never removed, and its history stays. 0024_sales_boards
// adds the boards and keeps stage moves from being changed.

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
    /** Where the card sits (ADR-0056 #2); null for an order entered before boards existed. */
    boardId: ref('board_id').references(() => salesBoards.id),
    stageId: ref('stage_id').references(() => salesStages.id),
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }),
    /** The picked counts confirmed (PACKED). */
    pickedAt: timestamp('picked_at', { withTimezone: true }),
    pickedBy: userRef('picked_by'),
    /** The main sale: stock issued out of STAGING (DELIVERED). */
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    deliveredBy: userRef('delivered_by'),
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
      'sales_orders_board',
      sql`(${t.boardId} IS NULL) = (${t.stageId} IS NULL) AND (${t.stageId} IS NULL) = (${t.stageEnteredAt} IS NULL)`,
    ),
    check(
      'sales_orders_picked',
      sql`(${t.pickedAt} IS NULL) = (${t.pickedBy} IS NULL) AND (${t.deliveredAt} IS NULL OR ${t.pickedAt} IS NOT NULL)`,
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
    /** Base units the picker confirmed, moved to STAGING (ADR-0056 #5); null until picked. */
    qtyPicked: qty('qty_picked'),
    pickBinId: ref('pick_bin_id').references(() => bins.id),
    /** Base units issued by the main sale; null until sold. */
    qtyDelivered: qty('qty_delivered'),
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
      'sales_order_lines_picked',
      sql`(${t.qtyPicked} IS NULL OR (${t.qtyPicked} >= 0 AND ${t.qtyPicked} <= ${t.qtyBase})) AND (${t.qtyDelivered} IS NULL OR (${t.qtyPicked} IS NOT NULL AND ${t.qtyDelivered} >= 0 AND ${t.qtyDelivered} <= ${t.qtyPicked}))`,
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

/**
 * A board of order stages (ADR-0056 #1): the owner's workflow per branch. Archived, never deleted.
 * Rights by role in `sales_board_roles`; none means everyone holding the sales rights.
 */
export const salesBoards = pgTable(
  'sales_boards',
  {
    id: id(),
    name: text('name').notNull(),
    branchId: ref('branch_id').references(() => branches.id),
    position: smallint('position').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'sales_boards_name',
      sql`length(${t.name}) BETWEEN 1 AND ${sql.raw(String(BOARD_LIMITS.maxName))}`,
    ),
    check('sales_boards_position', sql`${t.position} >= 0`),
  ],
);

/** A stage of a board: a column of cards, with what arriving there does (ADR-0056 #1, #3). */
export const salesStages = pgTable(
  'sales_stages',
  {
    id: id(),
    boardId: ref('board_id')
      .notNull()
      .references(() => salesBoards.id),
    name: text('name').notNull(),
    position: smallint('position').notNull(),
    action: text('action', { enum: STAGE_ACTIONS }).notNull().default('NONE'),
    printPickList: boolean('print_pick_list').notNull().default(false),
    printDeliveryNote: boolean('print_delivery_note').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('sales_stages_board_idx').on(t.boardId, t.position),
    check(
      'sales_stages_name',
      sql`length(${t.name}) BETWEEN 1 AND ${sql.raw(String(BOARD_LIMITS.maxName))}`,
    ),
    check('sales_stages_position', sql`${t.position} >= 0`),
    check('sales_stages_action', inList(t.action, STAGE_ACTIONS)),
  ],
);

/** Roles that may see or manage a board; dropped with the role. */
export const salesBoardRoles = pgTable(
  'sales_board_roles',
  {
    boardId: ref('board_id')
      .notNull()
      .references(() => salesBoards.id),
    roleId: ref('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    right: text('right', { enum: BOARD_RIGHTS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.boardId, t.roleId, t.right] }),
    check('sales_board_roles_right', inList(t.right, BOARD_RIGHTS)),
  ],
);

/** Roles that may see a stage, edit the orders in it or move cards into it; dropped with the role. */
export const salesStageRoles = pgTable(
  'sales_stage_roles',
  {
    stageId: ref('stage_id')
      .notNull()
      .references(() => salesStages.id),
    roleId: ref('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    right: text('right', { enum: STAGE_RIGHTS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.stageId, t.roleId, t.right] }),
    check('sales_stage_roles_right', inList(t.right, STAGE_RIGHTS)),
  ],
);

/** Where a new order of a channel lands (ADR-0056 #2). */
export const salesChannelDefaults = pgTable(
  'sales_channel_defaults',
  {
    channel: text('channel', { enum: ORDER_CHANNELS }).primaryKey(),
    boardId: ref('board_id')
      .notNull()
      .references(() => salesBoards.id),
    stageId: ref('stage_id')
      .notNull()
      .references(() => salesStages.id),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [check('sales_channel_defaults_channel', inList(t.channel, ORDER_CHANNELS))],
);

/** Every move of a card: from which stage to which, by whom, when. */
export const salesStageMoves = pgTable(
  'sales_stage_moves',
  {
    id: id(),
    orderId: ref('order_id')
      .notNull()
      .references(() => salesOrders.id),
    fromStageId: ref('from_stage_id').references(() => salesStages.id),
    toStageId: ref('to_stage_id')
      .notNull()
      .references(() => salesStages.id),
    actorId: userRef('actor_id'),
    createdAt: createdAt(),
  },
  (t) => [index('sales_stage_moves_order_idx').on(t.orderId, t.id)],
);
