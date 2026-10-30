import {
  EBARIMT_STATUSES,
  POS_EVENT_KINDS,
  POS_LIMITS,
  POS_STATUSES,
  RECEIPT_TYPES,
  SALE_KINDS,
  SHIFT_STATUSES,
  PAYMENT_TYPE_KINDS,
  TENDER_KINDS,
  VOID_REASONS,
  VOUCHER_BATCH_STATUSES,
  VOUCHER_EFFECTS,
  VOUCHER_ISSUES,
  VOUCHER_KINDS,
  VOUCHER_LIMITS,
  VOUCHER_STATUSES,
  GENDERS,
  LOYALTY_ENTRY_KINDS,
  LOYALTY_ISSUES,
  LOYALTY_LIMITS,
  LOYALTY_MEMBER_STATUSES,
} from '@tugeel/shared/pos';
import { REG_NO_MAX_LENGTH } from '@tugeel/shared/taxpayer';
import { PRICE_BASES } from '@tugeel/shared/pricing';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { factor, jsonValue, money, percent, qty } from '../../common/db/types';
import { categories, productUnits, products, VAT_TYPES } from '../catalog/schema';
import { creditNotes, invoices } from '../finance/schema';
import { users, warehouses } from '../identity/schema';
import { adjustments } from '../inventory/schema';
import { customers } from '../partners/schema';

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
    /** ADR-0065: the printed receipt's heading (the store's name) and closing line. */
    receiptTitle: text('receipt_title'),
    receiptFooter: text('receipt_footer'),
    /** ADR-0065: the store's district (сум) code and default classification code for e-Barimt. */
    ebarimtDistrictCode: text('ebarimt_district_code'),
    ebarimtClassificationCode: text('ebarimt_classification_code'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('pos_settings_single', sql`${t.id} = 1`),
    check(
      'pos_settings_return_window',
      sql`${t.returnWindowDays} BETWEEN 0 AND ${lim(POS_LIMITS.maxReturnWindowDays)}`,
    ),
    check('pos_settings_receipt_title', textLength(t.receiptTitle, POS_LIMITS.maxReceiptText)),
    check('pos_settings_receipt_footer', textLength(t.receiptFooter, POS_LIMITS.maxReceiptText)),
    check(
      'pos_settings_district_code',
      sql`${t.ebarimtDistrictCode} IS NULL OR ${t.ebarimtDistrictCode} ~ '^[0-9]{4}$'`,
    ),
    check(
      'pos_settings_classification_code',
      sql`${t.ebarimtClassificationCode} IS NULL OR ${t.ebarimtClassificationCode} ~ '^[0-9]{7}$'`,
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
    /** ADR-0065: the store PosAPI as the edge last read it (`GET /rest/info`, heartbeat). */
    posapiVersion: text('posapi_version'),
    /** PosAPI's `lastSentDate` verbatim: when it last sent its receipts to the tax office. */
    posapiLastSent: text('posapi_last_sent'),
    posapiLeftLotteries: integer('posapi_left_lotteries'),
    posapiCheckedAt: timestamp('posapi_checked_at', { withTimezone: true }),
    posapiError: text('posapi_error'),
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
    /**
     * The STORE warehouse this till sells from and takes returns onto (ADR-0123): the edge's by
     * default, another of the same branch when a second sales floor keeps its own stock.
     */
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    printerHost: text('printer_host'),
    printerPort: integer('printer_port').notNull().default(9100),
    drawerKick: boolean('drawer_kick').notNull().default(true),
    /**
     * ADR-0111: the till PC's receipt printer as the admin noted it (information only: Chrome
     * prints to the PC's Windows default printer with --kiosk-printing).
     */
    printerName: text('printer_name'),
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
    index('pos_tills_warehouse_idx').on(t.warehouseId),
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

export const POS_TILL_ROLES = ['CASHIER', 'SUPERVISOR'] as const;
export type PosTillRole = (typeof POS_TILL_ROLES)[number];

/**
 * Who works a till (ADR-0124): the cashiers who may sign in at it and the supervisors who may
 * approve at it. A till with no rows of a role admits everyone the store admits for that role.
 */
export const posTillUsers = pgTable(
  'pos_till_users',
  {
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    role: text('role', { enum: POS_TILL_ROLES }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.tillId, t.userId, t.role] }),
    index('pos_till_users_user_idx').on(t.userId),
    check('pos_till_users_role', inList(t.role, POS_TILL_ROLES)),
  ],
);

/**
 * What a till sells (ADR-0124): the categories (with everything under them) its products come
 * from. A till with no rows sells the whole snapshot.
 */
export const posTillCategories = pgTable(
  'pos_till_categories',
  {
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    categoryId: ref('category_id')
      .notNull()
      .references(() => categories.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.tillId, t.categoryId] })],
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
    /** ADR-0109: sold on credit, and taken back off customers' debts (the CREDIT tenders). */
    creditSales: money('credit_sales')
      .notNull()
      .default(sql`0`),
    creditRefunds: money('credit_refunds')
      .notNull()
      .default(sql`0`),
    /** ADR-0110: paid by partner vouchers (the VOUCHER tenders of its sales). */
    voucherSales: money('voucher_sales')
      .notNull()
      .default(sql`0`),
    /** ADR-0111: bank transfers taken (and given back) at the till. */
    transferSales: money('transfer_sales')
      .notNull()
      .default(sql`0`),
    transferRefunds: money('transfer_refunds')
      .notNull()
      .default(sql`0`),
    /**
     * ADR-0112: paid with bonus points and given back as points (the POINTS tenders), and the
     * points its sales earned and its returns took back.
     */
    pointsSales: money('points_sales')
      .notNull()
      .default(sql`0`),
    pointsRefunds: money('points_refunds')
      .notNull()
      .default(sql`0`),
    pointsEarned: money('points_earned')
      .notNull()
      .default(sql`0`),
    pointsClawback: money('points_clawback')
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
      sql`${t.cashSales} >= 0 AND ${t.cashRefunds} >= 0 AND ${t.creditSales} >= 0 AND ${t.creditRefunds} >= 0 AND ${t.voucherSales} >= 0 AND ${t.transferSales} >= 0 AND ${t.transferRefunds} >= 0 AND ${t.pointsSales} >= 0 AND ${t.pointsRefunds} >= 0 AND ${t.pointsEarned} >= 0 AND ${t.pointsClawback} >= 0 AND ${t.cardSales} >= 0 AND ${t.cardRefunds} >= 0 AND ${t.salesTotal} >= 0 AND ${t.returnsTotal} >= 0 AND ${t.salesCount} >= 0 AND ${t.returnsCount} >= 0 AND (${t.countedCash} IS NULL OR ${t.countedCash} >= 0) AND (${t.floatKept} IS NULL OR ${t.floatKept} >= 0)`,
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
    /**
     * ADR-0109: the customer a CREDIT tender charged (a sale) or whose debt a return reduced, the
     * part on credit, the invoice of the sale or the credit note of the return, and what the
     * customer's limit was passed by when the centre accepted it (an offline sale is never
     * refused), with the office's «Шалгасан».
     */
    customerId: ref('customer_id').references(() => customers.id),
    creditTotal: money('credit_total')
      .notNull()
      .default(sql`0`),
    invoiceId: ref('invoice_id').references(() => invoices.id),
    creditNoteId: ref('credit_note_id').references(() => creditNotes.id),
    /** The invoice's or the credit note's number, as finance allocated it. */
    creditDocNumber: text('credit_doc_number'),
    creditExcess: money('credit_excess'),
    creditReviewedAt: timestamp('credit_reviewed_at', { withTimezone: true }),
    creditReviewedBy: userRef('credit_reviewed_by'),
    creditReviewNote: text('credit_review_note'),
    /** ADR-0110: what its partner vouchers paid (the VOUCHER tenders); never with credit. */
    voucherTotal: money('voucher_total')
      .notNull()
      .default(sql`0`),
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
    index('pos_sales_customer_idx').on(t.customerId, t.id),
    uniqueIndex('pos_sales_invoice').on(t.invoiceId),
    uniqueIndex('pos_sales_credit_note').on(t.creditNoteId),
    index('pos_sales_credit_excess_idx')
      .on(t.id)
      .where(sql`${t.creditExcess} IS NOT NULL AND ${t.creditReviewedAt} IS NULL`),
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
    check(
      'pos_sales_credit',
      sql`${t.creditTotal} >= 0 AND ${t.creditTotal} <= ${t.total} AND (${t.creditTotal} = 0 OR (${t.customerId} IS NOT NULL AND ${t.receiptType} = 'B2C' AND ${t.ebarimtStatus} = 'NONE'))`,
    ),
    check(
      'pos_sales_credit_docs',
      sql`(${t.invoiceId} IS NULL OR (${t.kind} = 'SALE' AND ${t.creditTotal} > 0)) AND (${t.creditNoteId} IS NULL OR (${t.kind} = 'RETURN' AND ${t.creditTotal} > 0))`,
    ),
    check(
      'pos_sales_credit_review',
      sql`(${t.creditExcess} IS NULL OR ${t.creditExcess} > 0) AND (${t.creditReviewedAt} IS NULL) = (${t.creditReviewedBy} IS NULL) AND (${t.creditReviewedAt} IS NULL OR ${t.creditExcess} IS NOT NULL) AND (${textLength(t.creditReviewNote, POS_LIMITS.maxNote)})`,
    ),
    check(
      'pos_sales_vouchers',
      sql`${t.voucherTotal} >= 0 AND ${t.voucherTotal} <= ${t.total} AND (${t.voucherTotal} = 0 OR (${t.kind} = 'SALE' AND ${t.creditTotal} = 0))`,
    ),
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
    /** ADR-0111: the admin's payment type the cashier chose and its name then; null before it. */
    paymentTypeId: ref('payment_type_id').references((): AnyPgColumn => posPaymentTypes.id),
    paymentTypeName: text('payment_type_name'),
    /** What this tender settles of the sale (a refund: what was given back). */
    amount: money('amount').notNull(),
    /** Cash handed over, at least `amount`; the difference is the change. */
    tendered: money('tendered'),
    terminalId: text('terminal_id'),
    rrn: text('rrn'),
    maskedPan: text('masked_pan'),
    /** A VOUCHER tender's code (ADR-0110). */
    voucherId: ref('voucher_id').references((): AnyPgColumn => posVouchers.id),
  },
  (t) => [
    uniqueIndex('pos_tenders_sale_no').on(t.saleId, t.tenderNo),
    check('pos_tenders_voucher', sql`(${t.kind} = 'VOUCHER') = (${t.voucherId} IS NOT NULL)`),
    check(
      'pos_tenders_payment_type_name',
      sql`(${t.paymentTypeId} IS NULL) = (${t.paymentTypeName} IS NULL) AND (${textLength(t.paymentTypeName, POS_LIMITS.maxPaymentTypeName)})`,
    ),
    check('pos_tenders_kind', inList(t.kind, TENDER_KINDS)),
    check('pos_tenders_amount', sql`${t.amount} > 0`),
    check('pos_tenders_points', sql`${t.kind} <> 'POINTS' OR ${t.amount} = trunc(${t.amount})`),
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

/**
 * The ways to pay the admin offers at the till (ADR-0111), in the till's order: cash, a bank's card
 * terminal, a bank transfer, credit. Never deleted (tenders name them): a type taken off the till
 * is INACTIVE. At most one active CASH and one active CREDIT type.
 */
export const posPaymentTypes = pgTable(
  'pos_payment_types',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind', { enum: PAYMENT_TYPE_KINDS }).notNull(),
    sort: smallint('sort').notNull(),
    status: text('status', { enum: POS_STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_payment_types_name').on(t.name),
    uniqueIndex('pos_payment_types_one_cash')
      .on(t.kind)
      .where(sql`${t.status} = 'ACTIVE' AND ${t.kind} IN ('CASH', 'CREDIT')`),
    check('pos_payment_types_kind', inList(t.kind, PAYMENT_TYPE_KINDS)),
    check('pos_payment_types_status', inList(t.status, POS_STATUSES)),
    check(
      'pos_payment_types_name_length',
      sql`length(${t.name}) BETWEEN 1 AND ${lim(POS_LIMITS.maxPaymentTypeName)}`,
    ),
    check('pos_payment_types_sort_range', sql`${t.sort} >= 0`),
  ],
);

/**
 * A till's banknote count for its day summary (ADR-0111, owner 2026-10-27): kept as counted, never
 * posted; a recount is a new row, the latest of a till and day is the one shown. Append-only.
 */
export const posDayCounts = pgTable(
  'pos_day_counts',
  {
    id: id(),
    clientId: uuid('client_id').notNull(),
    edgeNodeId: ref('edge_node_id')
      .notNull()
      .references(() => posEdgeNodes.id),
    tillId: ref('till_id')
      .notNull()
      .references(() => posTills.id),
    day: text('day').notNull(),
    cashierUserId: ref('cashier_user_id')
      .notNull()
      .references(() => users.id),
    /** [{ note, count }] for the notes counted, largest first. */
    counts: jsonValue('counts').notNull(),
    total: money('total').notNull(),
    countedAt: timestamp('counted_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_day_counts_client').on(t.edgeNodeId, t.clientId),
    index('pos_day_counts_till_day_idx').on(t.tillId, t.day, t.id),
    check('pos_day_counts_day', sql`${t.day} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'`),
    check('pos_day_counts_total', sql`${t.total} >= 0`),
  ],
);

/**
 * A batch of the till's codes the admin created (ADR-0110): discount coupons (a percentage or
 * tugriks off the basket) or a partner's vouchers (a face value the partner is billed in full),
 * valid between two Ulaanbaatar days. Stopped, never deleted.
 */
export const posVoucherBatches = pgTable(
  'pos_voucher_batches',
  {
    id: id(),
    kind: text('kind', { enum: VOUCHER_KINDS }).notNull(),
    name: text('name').notNull(),
    effect: text('effect', { enum: VOUCHER_EFFECTS }).notNull(),
    /** A percentage (0–100] or whole tugriks; a partner voucher's face value. */
    value: money('value').notNull(),
    /** The partner billed for its vouchers (PARTNER only). */
    customerId: ref('customer_id').references(() => customers.id),
    validFrom: date('valid_from').notNull(),
    validTo: date('valid_to').notNull(),
    qty: integer('qty').notNull(),
    status: text('status', { enum: VOUCHER_BATCH_STATUSES }).notNull().default('ACTIVE'),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    stoppedAt: timestamp('stopped_at', { withTimezone: true }),
    stoppedBy: userRef('stopped_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('pos_voucher_batches_created_idx').on(t.createdAt, t.id),
    index('pos_voucher_batches_customer_idx').on(t.customerId),
    check('pos_voucher_batches_kind', inList(t.kind, VOUCHER_KINDS)),
    check('pos_voucher_batches_effect', inList(t.effect, VOUCHER_EFFECTS)),
    check('pos_voucher_batches_status', inList(t.status, VOUCHER_BATCH_STATUSES)),
    check(
      'pos_voucher_batches_shape',
      sql`(${t.kind} = 'PARTNER') = (${t.customerId} IS NOT NULL) AND (${t.kind} = 'COUPON' OR ${t.effect} = 'AMOUNT')`,
    ),
    check(
      'pos_voucher_batches_value',
      sql`(${t.effect} = 'PERCENT' AND ${t.value} > 0 AND ${t.value} <= 100) OR (${t.effect} = 'AMOUNT' AND ${t.value} > 0 AND ${t.value} = round(${t.value}) AND ${t.value} <= ${lim(VOUCHER_LIMITS.maxAmount)})`,
    ),
    check('pos_voucher_batches_dates', sql`${t.validTo} >= ${t.validFrom}`),
    check(
      'pos_voucher_batches_qty',
      sql`${t.qty} BETWEEN 1 AND ${lim(VOUCHER_LIMITS.maxBatchQty)}`,
    ),
    check(
      'pos_voucher_batches_name',
      sql`length(${t.name}) BETWEEN 1 AND ${lim(VOUCHER_LIMITS.maxName)}`,
    ),
    check('pos_voucher_batches_note', sql`${textLength(t.note, POS_LIMITS.maxNote)}`),
    check(
      'pos_voucher_batches_stopped',
      sql`(${t.status} = 'STOPPED') = (${t.stoppedAt} IS NOT NULL) AND (${t.stoppedAt} IS NULL) = (${t.stoppedBy} IS NULL)`,
    ),
  ],
);

/** One printed code of a batch: ISSUED until a till's sale takes it, then REDEEMED. */
export const posVouchers = pgTable(
  'pos_vouchers',
  {
    id: id(),
    batchId: ref('batch_id')
      .notNull()
      .references(() => posVoucherBatches.id),
    seq: integer('seq').notNull(),
    code: text('code').notNull(),
    status: text('status', { enum: VOUCHER_STATUSES }).notNull().default('ISSUED'),
    /** The sale that took it first, when, and what it took off or paid. */
    saleId: ref('sale_id').references((): AnyPgColumn => posSales.id),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    amount: money('amount'),
  },
  (t) => [
    uniqueIndex('pos_vouchers_code').on(t.code),
    uniqueIndex('pos_vouchers_batch_seq').on(t.batchId, t.seq),
    index('pos_vouchers_sale_idx').on(t.saleId),
    check('pos_vouchers_code_shape', sql`${t.code} ~ '^99[12][0-9]{13}$'`),
    check('pos_vouchers_status', inList(t.status, VOUCHER_STATUSES)),
    check(
      'pos_vouchers_redeemed',
      sql`(${t.status} = 'REDEEMED') = (${t.saleId} IS NOT NULL) AND (${t.saleId} IS NULL) = (${t.redeemedAt} IS NULL) AND (${t.saleId} IS NULL) = (${t.amount} IS NULL) AND (${t.amount} IS NULL OR ${t.amount} >= 0)`,
    ),
    check('pos_vouchers_seq', sql`${t.seq} >= 1`),
  ],
);

/**
 * A code a till's sale took (ADR-0110): what it took off or paid, the face value, and what the
 * centre found wrong with it (a code used twice, stopped or past its dates: the sale is kept and
 * the use listed for «Шалгасан»). A partner voucher names the partner's invoice.
 */
export const posSaleVouchers = pgTable(
  'pos_sale_vouchers',
  {
    id: id(),
    saleId: ref('sale_id')
      .notNull()
      .references(() => posSales.id),
    voucherId: ref('voucher_id')
      .notNull()
      .references(() => posVouchers.id),
    kind: text('kind', { enum: VOUCHER_KINDS }).notNull(),
    code: text('code').notNull(),
    face: money('face').notNull(),
    amount: money('amount').notNull(),
    issue: text('issue', { enum: VOUCHER_ISSUES }),
    invoiceId: ref('invoice_id').references(() => invoices.id),
    invoiceNumber: text('invoice_number'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: userRef('reviewed_by'),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_sale_vouchers_sale_voucher').on(t.saleId, t.voucherId),
    index('pos_sale_vouchers_voucher_idx').on(t.voucherId),
    index('pos_sale_vouchers_invoice_idx').on(t.invoiceId),
    index('pos_sale_vouchers_issue_idx')
      .on(t.id)
      .where(sql`${t.issue} IS NOT NULL AND ${t.reviewedAt} IS NULL`),
    check('pos_sale_vouchers_kind', inList(t.kind, VOUCHER_KINDS)),
    check('pos_sale_vouchers_issue', sql`${t.issue} IS NULL OR ${inList(t.issue, VOUCHER_ISSUES)}`),
    check('pos_sale_vouchers_money', sql`${t.face} > 0 AND ${t.amount} >= 0`),
    check(
      'pos_sale_vouchers_invoice',
      sql`(${t.invoiceId} IS NULL) = (${t.invoiceNumber} IS NULL) AND (${t.invoiceId} IS NULL OR ${t.kind} = 'PARTNER')`,
    ),
    check(
      'pos_sale_vouchers_review',
      sql`(${t.reviewedAt} IS NULL) = (${t.reviewedBy} IS NULL) AND (${t.reviewedAt} IS NULL OR ${t.issue} IS NOT NULL) AND (${textLength(t.reviewNote, POS_LIMITS.maxNote)})`,
    ),
  ],
);

/**
 * The bonus card's tiers (ADR-0112): from a lifetime spend, a percentage of what a member pays
 * comes back as points. The admin replaces the list as a whole; a tier is retired, never deleted.
 * No tiers means nobody earns.
 */
export const posLoyaltyTiers = pgTable(
  'pos_loyalty_tiers',
  {
    id: id(),
    name: text('name').notNull(),
    fromAmount: money('from_amount').notNull(),
    percent: percent('percent').notNull(),
    sort: smallint('sort').notNull(),
    status: text('status', { enum: POS_STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_loyalty_tiers_from')
      .on(t.fromAmount)
      .where(sql`${t.status} = 'ACTIVE'`),
    check('pos_loyalty_tiers_status', inList(t.status, POS_STATUSES)),
    check(
      'pos_loyalty_tiers_name',
      sql`length(${t.name}) BETWEEN 1 AND ${lim(LOYALTY_LIMITS.maxTierName)}`,
    ),
    check(
      'pos_loyalty_tiers_terms',
      sql`${t.fromAmount} >= 0 AND ${t.fromAmount} = trunc(${t.fromAmount}) AND ${t.fromAmount} <= ${lim(LOYALTY_LIMITS.maxTierFrom)} AND ${t.percent} > 0 AND ${t.percent} <= 100`,
    ),
  ],
);

/**
 * A bonus card member (ADR-0112): a person registered at the office, found at the till by the phone
 * and spending with a four-digit PIN (its argon2 hash, keyed like a cashier's). `balance` and
 * `lifetime_spend` are caches of the entries, written under the row's lock. Blocked, never deleted.
 */
export const posLoyaltyMembers = pgTable(
  'pos_loyalty_members',
  {
    id: id(),
    name: text('name').notNull(),
    /** E.164, one member per phone. */
    phone: text('phone').notNull(),
    pinHash: text('pin_hash').notNull(),
    /** Grows with every new PIN: the till's lock of the old one no longer applies. */
    pinVersion: integer('pin_version').notNull().default(1),
    pinSetAt: timestamp('pin_set_at', { withTimezone: true }).notNull().defaultNow(),
    regNo: text('reg_no'),
    birthDate: date('birth_date', { mode: 'string' }),
    gender: text('gender', { enum: GENDERS }),
    note: text('note'),
    status: text('status', { enum: LOYALTY_MEMBER_STATUSES }).notNull().default('ACTIVE'),
    balance: money('balance')
      .notNull()
      .default(sql`0`),
    lifetimeSpend: money('lifetime_spend')
      .notNull()
      .default(sql`0`),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('pos_loyalty_members_phone').on(t.phone),
    index('pos_loyalty_members_name_idx').on(t.name, t.id),
    check('pos_loyalty_members_status', inList(t.status, LOYALTY_MEMBER_STATUSES)),
    check('pos_loyalty_members_gender', sql`${t.gender} IS NULL OR ${inList(t.gender, GENDERS)}`),
    check('pos_loyalty_members_phone', sql`${t.phone} ~ '^[+]976[0-9]{8}$'`),
    check(
      'pos_loyalty_members_text',
      sql`length(${t.name}) BETWEEN 1 AND ${lim(LOYALTY_LIMITS.maxName)} AND (${textLength(t.note, LOYALTY_LIMITS.maxNote)}) AND (${textLength(t.regNo, REG_NO_MAX_LENGTH)})`,
    ),
    check('pos_loyalty_members_pin', sql`length(${t.pinHash}) > 0 AND ${t.pinVersion} >= 1`),
    check(
      'pos_loyalty_members_money',
      sql`${t.balance} = trunc(${t.balance}) AND ${t.lifetimeSpend} >= 0`,
    ),
  ],
);

/**
 * A member's points history (ADR-0112), append-only: a sale's earn (with the spend it adds to the
 * lifetime) and spend, a return's points taken back and given back, an admin's adjustment with its
 * reason and journal entry. Σ points = the member's balance; Σ spend_delta = the lifetime spend.
 */
export const posLoyaltyEntries = pgTable(
  'pos_loyalty_entries',
  {
    id: id(),
    memberId: ref('member_id')
      .notNull()
      .references(() => posLoyaltyMembers.id),
    kind: text('kind', { enum: LOYALTY_ENTRY_KINDS }).notNull(),
    /** Signed whole points: + earned or given back or added, − spent or taken back or removed. */
    points: money('points').notNull(),
    spendDelta: money('spend_delta')
      .notNull()
      .default(sql`0`),
    saleId: ref('sale_id').references(() => posSales.id),
    /** The tier's percent an EARN applied. */
    percent: percent('percent'),
    reason: text('reason'),
    /** An ADJUST's journal entry (`fin.journal_entries`): a plain id, no FK leaves `fin`. */
    journalEntryId: ref('journal_entry_id'),
    journalNumber: text('journal_number'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('pos_loyalty_entries_member_idx').on(t.memberId, t.id),
    index('pos_loyalty_entries_sale_idx').on(t.saleId),
    check('pos_loyalty_entries_kind', inList(t.kind, LOYALTY_ENTRY_KINDS)),
    check('pos_loyalty_entries_whole', sql`${t.points} = trunc(${t.points})`),
    check(
      'pos_loyalty_entries_sign',
      sql`(${t.kind} = 'EARN' AND ${t.points} >= 0 AND ${t.spendDelta} >= 0) OR (${t.kind} = 'SPEND' AND ${t.points} < 0 AND ${t.spendDelta} = 0) OR (${t.kind} = 'RETURN_EARN' AND ${t.points} <= 0 AND ${t.spendDelta} <= 0) OR (${t.kind} = 'RETURN_SPEND' AND ${t.points} > 0 AND ${t.spendDelta} = 0) OR (${t.kind} = 'ADJUST' AND ${t.points} <> 0 AND ${t.spendDelta} = 0)`,
    ),
    check(
      'pos_loyalty_entries_source',
      sql`(${t.kind} = 'ADJUST') = (${t.saleId} IS NULL) AND (${t.kind} = 'ADJUST') = (${t.reason} IS NOT NULL) AND (${t.kind} = 'ADJUST') = (${t.createdBy} IS NOT NULL) AND (${t.kind} = 'EARN') = (${t.percent} IS NOT NULL) AND (${t.journalEntryId} IS NULL) = (${t.journalNumber} IS NULL) AND (${t.journalEntryId} IS NULL OR ${t.kind} = 'ADJUST') AND (${textLength(t.reason, LOYALTY_LIMITS.maxReason)})`,
    ),
  ],
);

/**
 * A member's part of a till sale or return (ADR-0112), as the edge sent it: the money base, the
 * tier's percent, the points earned, spent, given back and taken back; and what the centre found
 * wrong (the card blocked, more spent than the balance it knows): the sale is kept and listed for
 * «Шалгасан».
 */
export const posSaleLoyalty = pgTable(
  'pos_sale_loyalty',
  {
    id: id(),
    saleId: ref('sale_id')
      .notNull()
      .references(() => posSales.id),
    memberId: ref('member_id')
      .notNull()
      .references(() => posLoyaltyMembers.id),
    kind: text('kind', { enum: SALE_KINDS }).notNull(),
    earnBase: money('earn_base').notNull(),
    percent: percent('percent').notNull(),
    earned: money('earned').notNull(),
    spent: money('spent').notNull(),
    givenBack: money('given_back').notNull(),
    clawback: money('clawback').notNull(),
    spendDelta: money('spend_delta').notNull(),
    /** The member's balance after this document, as the centre counted it. */
    balanceAfter: money('balance_after').notNull(),
    issue: text('issue', { enum: LOYALTY_ISSUES }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: userRef('reviewed_by'),
    reviewNote: text('review_note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('pos_sale_loyalty_sale').on(t.saleId),
    index('pos_sale_loyalty_member_idx').on(t.memberId, t.id),
    index('pos_sale_loyalty_issue_idx')
      .on(t.id)
      .where(sql`${t.issue} IS NOT NULL AND ${t.reviewedAt} IS NULL`),
    check('pos_sale_loyalty_kind', inList(t.kind, SALE_KINDS)),
    check('pos_sale_loyalty_issue', sql`${t.issue} IS NULL OR ${inList(t.issue, LOYALTY_ISSUES)}`),
    check(
      'pos_sale_loyalty_money',
      sql`${t.earnBase} >= 0 AND ${t.percent} >= 0 AND ${t.earned} >= 0 AND ${t.spent} >= 0 AND ${t.givenBack} >= 0 AND ${t.clawback} >= 0 AND ${t.earned} = trunc(${t.earned}) AND ${t.spent} = trunc(${t.spent}) AND ${t.givenBack} = trunc(${t.givenBack}) AND ${t.clawback} = trunc(${t.clawback}) AND ${t.balanceAfter} = trunc(${t.balanceAfter})`,
    ),
    check(
      'pos_sale_loyalty_shape',
      sql`(${t.kind} = 'SALE' AND ${t.givenBack} = 0 AND ${t.clawback} = 0 AND ${t.spendDelta} = ${t.earnBase}) OR (${t.kind} = 'RETURN' AND ${t.earned} = 0 AND ${t.spent} = 0 AND ${t.spendDelta} <= 0)`,
    ),
    check(
      'pos_sale_loyalty_review',
      sql`(${t.reviewedAt} IS NULL) = (${t.reviewedBy} IS NULL) AND (${t.reviewedAt} IS NULL OR ${t.issue} IS NOT NULL) AND (${textLength(t.reviewNote, POS_LIMITS.maxNote)})`,
    ),
  ],
);
