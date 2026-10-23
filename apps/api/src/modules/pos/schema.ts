import {
  EBARIMT_STATUSES,
  POS_EVENT_KINDS,
  POS_LIMITS,
  POS_STATUSES,
  RECEIPT_TYPES,
  SALE_KINDS,
  SHIFT_STATUSES,
  TENDER_KINDS,
  VOID_REASONS,
} from '@tugeel/shared/pos';
import { PRICE_BASES } from '@tugeel/shared/pricing';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { factor, jsonValue, money, percent, qty } from '../../common/db/types';
import { productUnits, products, VAT_TYPES } from '../catalog/schema';
import { users, warehouses } from '../identity/schema';
import { adjustments } from '../inventory/schema';

// The tables of the supermarket POS on the centre (docs/modules/pos.md, ADR-0063, ADR-0064). The
// store's edge replays its documents here with the uuids the tills gave them; the centre is the
// system of record for stock and money. Migration 0027_pos adds by hand: the REVOKEs, the
// append-only guard of the tenders, the finance and inventory CHECKs that grew, and the
// assistant's movement view with the POS numbers.

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
/** A limit from the shared package, inlined: a bound parameter would not do in a CHECK. */
const lim = (value: number): SQL => sql.raw(String(value));
const textLength = (column: AnyPgColumn, max: number): SQL =>
  sql`${column} IS NULL OR length(${column}) BETWEEN 1 AND ${lim(max)}`;

/** The store's settings (ADR-0063 #2): one row; absent until the admin saves it. */
export const posSettings = pgTable(
  'pos_settings',
  {
    id: smallint('id').primaryKey(),
    /** The STORE warehouse whose SALESFLOOR the tills sell from. */
    storeWarehouseId: ref('store_warehouse_id').references(() => warehouses.id),
    /** The cash box the accountant books a shift's cash into by default (`fin.money_accounts`). */
    handoverMoneyAccountId: ref('handover_money_account_id'),
    returnWindowDays: smallint('return_window_days')
      .notNull()
      .default(POS_LIMITS.defaultReturnWindowDays),
    snapshotIntervalSec: integer('snapshot_interval_sec')
      .notNull()
      .default(POS_LIMITS.defaultSnapshotIntervalSec),
    supervisorRequired: boolean('supervisor_required').notNull().default(true),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('pos_settings_single', sql`${t.id} = 1`),
    check(
      'pos_settings_return_window',
      sql`${t.returnWindowDays} BETWEEN 0 AND ${lim(POS_LIMITS.maxReturnWindowDays)}`,
    ),
    check(
      'pos_settings_snapshot_interval',
      sql`${t.snapshotIntervalSec} BETWEEN ${lim(POS_LIMITS.minSnapshotIntervalSec)} AND ${lim(POS_LIMITS.maxSnapshotIntervalSec)}`,
    ),
  ],
);

/**
 * A store's edge server (ADR-0063 #1): the process on the store's LAN the tills talk to. It
 * authenticates to the centre with a token whose sha-256 is kept here (ADR-0063 #6).
 */
export const posEdgeNodes = pgTable(
  'pos_edge_nodes',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    tokenHash: text('token_hash'),
    tokenPrefix: text('token_prefix'),
    tokenIssuedAt: timestamp('token_issued_at', { withTimezone: true }),
    appVersion: text('app_version'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    lastPullAt: timestamp('last_pull_at', { withTimezone: true }),
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
    /** Documents the edge still has to replay, as it last reported. */
    backlog: integer('backlog').notNull().default(0),
    /** The edge's clock minus the centre's, in milliseconds, as it last reported. */
    clockSkewMs: integer('clock_skew_ms'),
    snapshotVersion: text('snapshot_version'),
    status: text('status', { enum: POS_STATUSES }).notNull().default('ACTIVE'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_edge_nodes_code').on(t.code),
    check('pos_edge_nodes_code_shape', sql`${t.code} ~ '^[A-Z0-9][A-Z0-9_-]{0,15}$'`),
    check('pos_edge_nodes_name', sql`length(${t.name}) BETWEEN 1 AND ${lim(POS_LIMITS.maxName)}`),
    check('pos_edge_nodes_status', inList(t.status, POS_STATUSES)),
    check('pos_edge_nodes_token', sql`(${t.tokenHash} IS NULL) = (${t.tokenPrefix} IS NULL)`),
    check('pos_edge_nodes_backlog', sql`${t.backlog} >= 0`),
  ],
);

/** A till (касс): a code printed on its receipts, its printer and drawer (owner 2026-10-16). */
export const posTills = pgTable(
  'pos_tills',
  {
    id: id(),
    edgeNodeId: ref('edge_node_id')
      .notNull()
      .references(() => posEdgeNodes.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    printerHost: text('printer_host'),
    printerPort: integer('printer_port').notNull().default(9100),
    drawerKick: boolean('drawer_kick').notNull().default(true),
    /** sha-256 of the one-time code a manager types to bind a browser to this till (S2). */
    pairingCodeHash: text('pairing_code_hash'),
    pairingExpiresAt: timestamp('pairing_expires_at', { withTimezone: true }),
    status: text('status', { enum: POS_STATUSES }).notNull().default('ACTIVE'),
    lastSaleAt: timestamp('last_sale_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_tills_node_code').on(t.edgeNodeId, t.code),
    check(
      'pos_tills_code_shape',
      sql`length(${t.code}) BETWEEN 1 AND ${lim(POS_LIMITS.maxTillCode)} AND ${t.code} !~ '[[:space:]]'`,
    ),
    check('pos_tills_name', sql`length(${t.name}) BETWEEN 1 AND ${lim(POS_LIMITS.maxName)}`),
    check('pos_tills_printer', sql`${textLength(t.printerHost, 253)}`),
    check('pos_tills_port', sql`${t.printerPort} BETWEEN 1 AND 65535`),
    check('pos_tills_status', inList(t.status, POS_STATUSES)),
    check(
      'pos_tills_pairing',
      sql`(${t.pairingCodeHash} IS NULL) = (${t.pairingExpiresAt} IS NULL)`,
    ),
  ],
);

/** A browser the edge bound to a till (S2); listed so the admin sees which screens are tills. */
export const posTillDevices = pgTable(
  'pos_till_devices',
  {
    id: id(),
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    deviceTokenHash: text('device_token_hash').notNull(),
    userAgent: text('user_agent'),
    boundBy: userRef('bound_by'),
    boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('pos_till_devices_token').on(t.deviceTokenHash),
    index('pos_till_devices_till_idx').on(t.tillId),
    check('pos_till_devices_agent', sql`${textLength(t.userAgent, 300)}`),
  ],
);

/** A staff member who may work a till, with the PIN they log in with (ADR-0063 #6). */
export const posCashiers = pgTable(
  'pos_cashiers',
  {
    userId: ref('user_id')
      .primaryKey()
      .references(() => users.id),
    /** argon2id of the PIN, keyed with POS_PIN_PEPPER; never the PIN. */
    pinHash: text('pin_hash').notNull(),
    pinSetAt: timestamp('pin_set_at', { withTimezone: true }).notNull().defaultNow(),
    pinSetBy: userRef('pin_set_by'),
    status: text('status', { enum: POS_STATUSES }).notNull().default('ACTIVE'),
    failedCount: integer('failed_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('pos_cashiers_status', inList(t.status, POS_STATUSES)),
    check('pos_cashiers_failed', sql`${t.failedCount} >= 0`),
  ],
);

/**
 * A cashier's shift at a till (ADR-0064 #1): opened with a float, closed with a count; its money
 * is booked at the close and handed to the accountant afterwards.
 */
export const posShifts = pgTable(
  'pos_shifts',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    edgeNodeId: ref('edge_node_id')
      .notNull()
      .references(() => posEdgeNodes.id),
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    cashierUserId: ref('cashier_user_id')
      .notNull()
      .references(() => users.id),
    number: text('number').notNull(),
    status: text('status', { enum: SHIFT_STATUSES }).notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    openingFloat: money('opening_float').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    countedCash: money('counted_cash'),
    floatKept: money('float_kept'),
    expectedCash: money('expected_cash'),
    /** counted − expected: positive = over, negative = short. */
    variance: money('variance'),
    note: text('note'),
    salesCount: integer('sales_count').notNull().default(0),
    returnsCount: integer('returns_count').notNull().default(0),
    cashSales: money('cash_sales')
      .notNull()
      .default(sql`0`),
    cashRefunds: money('cash_refunds')
      .notNull()
      .default(sql`0`),
    cardSales: money('card_sales')
      .notNull()
      .default(sql`0`),
    cardRefunds: money('card_refunds')
      .notNull()
      .default(sql`0`),
    salesTotal: money('sales_total')
      .notNull()
      .default(sql`0`),
    returnsTotal: money('returns_total')
      .notNull()
      .default(sql`0`),
    salesVat: money('sales_vat')
      .notNull()
      .default(sql`0`),
    returnsVat: money('returns_vat')
      .notNull()
      .default(sql`0`),
    /** The core's journal entry (`fin.journal_entries`, ADR-0089): a plain id. */
    journalEntryId: ref('journal_entry_id'),
    journalNumber: text('journal_number'),
    /** The hand-over voucher: a Finance Core document id (ADR-0090), no FK leaves `fin`. */
    handoverPaymentId: ref('handover_payment_id'),
    handoverNumber: text('handover_number'),
    handedOverAt: timestamp('handed_over_at', { withTimezone: true }),
    handedOverBy: userRef('handed_over_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_shifts_client').on(t.edgeNodeId, t.clientId),
    uniqueIndex('pos_shifts_number').on(t.edgeNodeId, t.number),
    uniqueIndex('pos_shifts_open_till')
      .on(t.tillId)
      .where(sql`${t.status} = 'OPEN'`),
    index('pos_shifts_opened_idx').on(t.openedAt, t.id),
    index('pos_shifts_cashier_idx').on(t.cashierUserId, t.id),
    check('pos_shifts_status', inList(t.status, SHIFT_STATUSES)),
    check('pos_shifts_number', sql`length(${t.number}) BETWEEN 1 AND 40`),
    check('pos_shifts_float', sql`${t.openingFloat} >= 0`),
    check(
      'pos_shifts_closed',
      sql`(${t.status} = 'OPEN') = (${t.closedAt} IS NULL) AND (${t.closedAt} IS NULL) = (${t.countedCash} IS NULL) AND (${t.closedAt} IS NULL) = (${t.expectedCash} IS NULL) AND (${t.closedAt} IS NULL) = (${t.variance} IS NULL) AND (${t.closedAt} IS NULL) = (${t.floatKept} IS NULL)`,
    ),
    check(
      'pos_shifts_handed_over',
      sql`(${t.status} = 'HANDED_OVER') = (${t.handedOverAt} IS NOT NULL) AND (${t.handedOverAt} IS NULL) = (${t.handoverPaymentId} IS NULL)`,
    ),
    check(
      'pos_shifts_money',
      sql`${t.cashSales} >= 0 AND ${t.cashRefunds} >= 0 AND ${t.cardSales} >= 0 AND ${t.cardRefunds} >= 0 AND ${t.salesTotal} >= 0 AND ${t.returnsTotal} >= 0 AND ${t.salesCount} >= 0 AND ${t.returnsCount} >= 0 AND (${t.countedCash} IS NULL OR ${t.countedCash} >= 0) AND (${t.floatKept} IS NULL OR ${t.floatKept} >= 0)`,
    ),
    check('pos_shifts_note', sql`${textLength(t.note, POS_LIMITS.maxNote)}`),
  ],
);

/**
 * A sale or a return at a till (ADR-0063 #3): the edge's uuid and number, the cashier, the money
 * and the e-Barimt facts the edge reports (never the lottery or the QR). Immutable but for the
 * receipt facts; a mistake is corrected by a RETURN.
 */
export const posSales = pgTable(
  'pos_sales',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    edgeNodeId: ref('edge_node_id')
      .notNull()
      .references(() => posEdgeNodes.id),
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    shiftId: ref('shift_id')
      .notNull()
      .references(() => posShifts.id),
    cashierUserId: ref('cashier_user_id')
      .notNull()
      .references(() => users.id),
    /** The senior cashier who approved a return (ADR-0063 #7). */
    approvedBy: userRef('approved_by'),
    number: text('number').notNull(),
    kind: text('kind', { enum: SALE_KINDS }).notNull(),
    refundsSaleId: ref('refunds_sale_id').references((): AnyPgColumn => posSales.id),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull(),
    /** The Ulaanbaatar day of `sold_at`, as the edge printed it. */
    soldDay: text('sold_day').notNull(),
    subtotal: money('subtotal').notNull(),
    discountTotal: money('discount_total').notNull(),
    total: money('total').notNull(),
    vatTotal: money('vat_total').notNull(),
    receiptType: text('receipt_type', { enum: RECEIPT_TYPES }).notNull().default('B2C'),
    customerTin: text('customer_tin'),
    customerName: text('customer_name'),
    consumerNo: text('consumer_no'),
    ebarimtStatus: text('ebarimt_status', { enum: EBARIMT_STATUSES }).notNull().default('NONE'),
    ddtd: text('ddtd'),
    posapiDate: text('posapi_date'),
    billIdSuffix: text('bill_id_suffix'),
    inactiveId: text('inactive_id'),
    snapshotVersion: text('snapshot_version'),
    note: text('note'),
    /** When the centre accepted it; `sold_at` is when the till sold it. */
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_sales_client').on(t.edgeNodeId, t.clientId),
    uniqueIndex('pos_sales_number').on(t.edgeNodeId, t.number),
    index('pos_sales_shift_idx').on(t.shiftId, t.id),
    index('pos_sales_sold_idx').on(t.soldAt, t.id),
    index('pos_sales_till_idx').on(t.tillId, t.soldAt),
    index('pos_sales_refunds_idx').on(t.refundsSaleId),
    check('pos_sales_kind', inList(t.kind, SALE_KINDS)),
    check('pos_sales_number_shape', sql`length(${t.number}) BETWEEN 1 AND 40`),
    check('pos_sales_day', sql`${t.soldDay} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
    check('pos_sales_refund', sql`(${t.kind} = 'RETURN') = (${t.refundsSaleId} IS NOT NULL)`),
    check(
      'pos_sales_totals',
      sql`${t.total} = ${t.subtotal} - ${t.discountTotal} AND ${t.subtotal} >= 0 AND ${t.discountTotal} >= 0 AND ${t.total} >= 0 AND ${t.vatTotal} >= 0`,
    ),
    check('pos_sales_receipt_type', inList(t.receiptType, RECEIPT_TYPES)),
    check(
      'pos_sales_b2b',
      sql`${t.receiptType} = 'B2C' OR (${t.customerTin} IS NOT NULL AND ${t.customerTin} ~ '^[0-9]{11,14}$')`,
    ),
    check('pos_sales_customer_name', sql`${textLength(t.customerName, POS_LIMITS.maxName)}`),
    check(
      'pos_sales_consumer_no',
      sql`${t.consumerNo} IS NULL OR ${t.consumerNo} ~ '^([0-9]{8}|11\\*{6})$'`,
    ),
    check('pos_sales_ebarimt_status', inList(t.ebarimtStatus, EBARIMT_STATUSES)),
    check('pos_sales_note', sql`${textLength(t.note, POS_LIMITS.maxNote)}`),
  ],
);

/** A line as the till priced it (ADR-0063 #4): snapshots, the RETAIL basis, the VAT inside. */
export const posSaleLines = pgTable(
  'pos_sale_lines',
  {
    id: id(),
    saleId: ref('sale_id')
      .notNull()
      .references(() => posSales.id),
    lineNo: smallint('line_no').notNull(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    productSku: text('product_sku').notNull(),
    productName: text('product_name').notNull(),
    uomName: text('uom_name').notNull(),
    qty: qty('qty').notNull(),
    factorSnapshot: factor('factor_snapshot').notNull(),
    qtyBase: qty('qty_base').notNull(),
    basis: text('basis', { enum: PRICE_BASES }).notNull(),
    listPrice: money('list_price').notNull(),
    unitPrice: money('unit_price').notNull(),
    discountAmount: money('discount_amount').notNull(),
    subtotal: money('subtotal').notNull(),
    total: money('total').notNull(),
    vatType: text('vat_type', { enum: VAT_TYPES }).notNull(),
    vatRatePct: percent('vat_rate_pct').notNull(),
    vatAmount: money('vat_amount').notNull(),
    /** The discount programs the till applied, as it reported them. */
    applied: jsonValue('applied')
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** On a RETURN line: the sold line it takes back. */
    refundsLineId: ref('refunds_line_id').references((): AnyPgColumn => posSaleLines.id),
    /** A returned item that goes to DAMAGED instead of back onto the shelf. */
    damaged: boolean('damaged').notNull().default(false),
    /** On a sold line: base units taken back by returns so far. */
    returnedBase: qty('returned_base')
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    uniqueIndex('pos_sale_lines_sale_line').on(t.saleId, t.lineNo),
    index('pos_sale_lines_product_idx').on(t.productId),
    index('pos_sale_lines_refunds_idx').on(t.refundsLineId),
    check('pos_sale_lines_basis', inList(t.basis, PRICE_BASES)),
    check('pos_sale_lines_vat_type', inList(t.vatType, VAT_TYPES)),
    check(
      'pos_sale_lines_qty',
      sql`${t.qty} > 0 AND ${t.factorSnapshot} > 0 AND ${t.qtyBase} > 0 AND ${t.returnedBase} >= 0 AND ${t.returnedBase} <= ${t.qtyBase}`,
    ),
    check(
      'pos_sale_lines_money',
      sql`${t.total} = ${t.subtotal} - ${t.discountAmount} AND ${t.unitPrice} >= 0 AND ${t.listPrice} >= 0 AND ${t.discountAmount} >= 0 AND ${t.total} >= 0 AND ${t.vatAmount} >= 0`,
    ),
  ],
);

/** How a sale was paid (SPEC §6.6 #4): cash with the change, or a card with the slip's facts. */
export const posTenders = pgTable(
  'pos_tenders',
  {
    id: id(),
    saleId: ref('sale_id')
      .notNull()
      .references(() => posSales.id),
    tenderNo: smallint('tender_no').notNull(),
    kind: text('kind', { enum: TENDER_KINDS }).notNull(),
    /** What this tender settles of the sale (a refund: what was given back). */
    amount: money('amount').notNull(),
    /** Cash handed over, at least `amount`; the difference is the change. */
    tendered: money('tendered'),
    terminalId: text('terminal_id'),
    rrn: text('rrn'),
    maskedPan: text('masked_pan'),
  },
  (t) => [
    uniqueIndex('pos_tenders_sale_no').on(t.saleId, t.tenderNo),
    check('pos_tenders_kind', inList(t.kind, TENDER_KINDS)),
    check('pos_tenders_amount', sql`${t.amount} > 0`),
    check(
      'pos_tenders_cash',
      sql`(${t.kind} = 'CASH' AND (${t.tendered} IS NULL OR ${t.tendered} >= ${t.amount})) OR (${t.kind} <> 'CASH' AND ${t.tendered} IS NULL)`,
    ),
    check(
      'pos_tenders_card',
      sql`${textLength(t.terminalId, POS_LIMITS.maxCardField)} AND ${textLength(t.rrn, POS_LIMITS.maxCardField)} AND ${textLength(t.maskedPan, POS_LIMITS.maxCardField)}`,
    ),
  ],
);

/**
 * What the shelf lacked when a till sold it (ADR-0063 #5): the automatic adjustment that filled
 * the gap, for the storekeeper to check and explain.
 */
export const posShortfalls = pgTable(
  'pos_shortfalls',
  {
    id: id(),
    saleId: ref('sale_id')
      .notNull()
      .references(() => posSales.id),
    saleLineId: ref('sale_line_id')
      .notNull()
      .references(() => posSaleLines.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    qtyBase: qty('qty_base').notNull(),
    adjustmentId: ref('adjustment_id')
      .notNull()
      .references(() => adjustments.id),
    adjustmentNumber: text('adjustment_number').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: userRef('resolved_by'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('pos_shortfalls_open_idx')
      .on(t.productId, t.id)
      .where(sql`${t.resolvedAt} IS NULL`),
    index('pos_shortfalls_sale_idx').on(t.saleId),
    check('pos_shortfalls_qty', sql`${t.qtyBase} > 0`),
    check('pos_shortfalls_resolved', sql`(${t.resolvedAt} IS NULL) = (${t.resolvedBy} IS NULL)`),
    check('pos_shortfalls_note', sql`${textLength(t.note, POS_LIMITS.maxNote)}`),
  ],
);

/** A replayed document the centre refused for good (ADR-0063 #4): kept for the admin to fix. */
export const posSyncRejections = pgTable(
  'pos_sync_rejections',
  {
    id: id(),
    edgeNodeId: ref('edge_node_id')
      .notNull()
      .references(() => posEdgeNodes.id),
    clientId: uuid('client_id').notNull(),
    kind: text('kind', { enum: POS_EVENT_KINDS }).notNull(),
    payload: jsonValue('payload').notNull(),
    code: text('code').notNull(),
    params: jsonValue('params'),
    createdAt: createdAt(),
    replayedAt: timestamp('replayed_at', { withTimezone: true }),
    replayedBy: userRef('replayed_by'),
  },
  (t) => [
    index('pos_sync_rejections_node_idx').on(t.edgeNodeId, t.id),
    check('pos_sync_rejections_kind', inList(t.kind, POS_EVENT_KINDS)),
    check('pos_sync_rejections_code', sql`length(${t.code}) BETWEEN 1 AND 60`),
  ],
);

// ---------------------------------------------------------------- ADR-0104 (migration 0043)

/**
 * The till's F7 panel (ADR-0104): groups of product units the admin chose, the same on every till.
 * The admin saves the whole set at once, so groups and buttons are replaced, not edited in place.
 */
export const posQuickGroups = pgTable(
  'pos_quick_groups',
  {
    id: id(),
    name: text('name').notNull(),
    sort: smallint('sort').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_quick_groups_sort').on(t.sort),
    check(
      'pos_quick_groups_name',
      sql`length(${t.name}) BETWEEN 1 AND ${lim(POS_LIMITS.maxQuickLabel)}`,
    ),
    check('pos_quick_groups_sort_range', sql`${t.sort} >= 0`),
  ],
);

export const posQuickButtons = pgTable(
  'pos_quick_buttons',
  {
    id: id(),
    groupId: ref('group_id')
      .notNull()
      .references(() => posQuickGroups.id, { onDelete: 'cascade' }),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    /** Shown instead of the product's name when set («Талх»). */
    label: text('label'),
    sort: smallint('sort').notNull(),
  },
  (t) => [
    uniqueIndex('pos_quick_buttons_group_sort').on(t.groupId, t.sort),
    uniqueIndex('pos_quick_buttons_group_unit').on(t.groupId, t.productUnitId),
    check('pos_quick_buttons_label', sql`${textLength(t.label, POS_LIMITS.maxQuickLabel)}`),
    check('pos_quick_buttons_sort_range', sql`${t.sort} >= 0`),
  ],
);

/**
 * Goods taken off a till's cart before payment (ADR-0104): a removed line, a lowered quantity, a
 * cancelled cart or parked basket, with the supervisor whose PIN approved it. Append-only.
 */
export const posVoids = pgTable(
  'pos_voids',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    edgeNodeId: ref('edge_node_id')
      .notNull()
      .references(() => posEdgeNodes.id),
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    /** The till's open shift at the time; null between shifts. */
    shiftId: ref('shift_id').references(() => posShifts.id),
    cashierUserId: userRef('cashier_user_id').notNull(),
    approvedBy: userRef('approved_by'),
    reason: text('reason', { enum: VOID_REASONS }).notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }).notNull(),
    total: money('total').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_voids_client').on(t.edgeNodeId, t.clientId),
    index('pos_voids_voided_idx').on(t.voidedAt, t.id),
    index('pos_voids_shift_idx').on(t.shiftId),
    check('pos_voids_reason', inList(t.reason, VOID_REASONS)),
    check('pos_voids_total', sql`${t.total} >= 0`),
  ],
);

export const posVoidLines = pgTable(
  'pos_void_lines',
  {
    id: id(),
    voidId: ref('void_id')
      .notNull()
      .references(() => posVoids.id),
    lineNo: smallint('line_no').notNull(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    productSku: text('product_sku').notNull(),
    productName: text('product_name').notNull(),
    uomName: text('uom_name').notNull(),
    qty: qty('qty').notNull(),
    unitPrice: money('unit_price').notNull(),
    total: money('total').notNull(),
  },
  (t) => [
    uniqueIndex('pos_void_lines_void_line').on(t.voidId, t.lineNo),
    index('pos_void_lines_product_idx').on(t.productId),
    check('pos_void_lines_qty', sql`${t.qty} > 0`),
    check('pos_void_lines_money', sql`${t.unitPrice} >= 0 AND ${t.total} >= 0`),
  ],
);
