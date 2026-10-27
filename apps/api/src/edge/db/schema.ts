import type { EbarimtPaymentCode, EbarimtTaxType } from '@tugeel/shared/mn';
import type {
  EdgeCartLine,
  EdgeReceipt,
  PosCustomerFeed,
  PosSnapshot,
  PosVoucherFeed,
  ReceiptType,
  SaleDocWire,
  SaleKind,
  SyncEventWire,
  VoidDocWire,
  VoidReason,
  VoucherKind,
} from '@tugeel/shared/pos';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jsonValue, money } from '../../common/db/types';

/*
 * The store edge's own database (ADR-0067): what it sells from (the latest snapshot), the browsers
 * bound to its tills, the shifts and sales of its tills, and the outbox it replays to the centre
 * in order. The centre stays the system of record; the edge keeps what a till needs offline.
 */

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** One row: the snapshot in force and how the edge last spoke to the centre. */
export const edgeState = pgTable(
  'edge_state',
  {
    id: smallint('id').primaryKey().default(1),
    snapshotVersion: text('snapshot_version'),
    snapshot: jsonValue('snapshot').$type<PosSnapshot | null>(),
    pulledAt: timestamp('pulled_at', { withTimezone: true }),
    lastPushAt: timestamp('last_push_at', { withTimezone: true }),
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** ADR-0065: the store PosAPI as `GET /rest/info` last answered (never a credential). */
    posapiVersion: text('posapi_version'),
    /** PosAPI's `lastSentDate` verbatim. */
    posapiLastSent: text('posapi_last_sent'),
    posapiLeftLotteries: integer('posapi_left_lotteries'),
    posapiCheckedAt: timestamp('posapi_checked_at', { withTimezone: true }),
    posapiError: text('posapi_error'),
    /** ADR-0109: the customers a till may charge, as the centre's feed last answered. */
    customersVersion: text('customers_version'),
    customers: jsonValue('customers').$type<PosCustomerFeed | null>(),
    customersPulledAt: timestamp('customers_pulled_at', { withTimezone: true }),
    /** ADR-0110: the coupons and partner vouchers a till may take, as the centre's feed answered. */
    vouchersVersion: text('vouchers_version'),
    vouchers: jsonValue('vouchers').$type<PosVoucherFeed | null>(),
    vouchersPulledAt: timestamp('vouchers_pulled_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('edge_state_single_row', sql`${t.id} = 1`)],
);

/** A browser bound to a till with the admin's one-time pairing code. */
export const edgeDevices = pgTable(
  'edge_devices',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tillCode: text('till_code').notNull(),
    tokenHash: text('token_hash').notNull(),
    userAgent: text('user_agent'),
    boundAt: timestamp('bound_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [unique('edge_devices_token_hash_key').on(t.tokenHash)],
);

/** Gapless numbers per till and Ulaanbaatar business day (`К1-261017-0001`, `К1-261017-Э1`). */
export const edgeSequences = pgTable(
  'edge_sequences',
  {
    key: text('key').notNull(),
    day: text('day').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
);

export const EDGE_SHIFT_STATUSES = ['OPEN', 'CLOSED'] as const;

export const edgeShifts = pgTable(
  'edge_shifts',
  {
    clientId: uuid('client_id').primaryKey(),
    tillCode: text('till_code').notNull(),
    cashierUserId: bigint('cashier_user_id', { mode: 'number' }).notNull(),
    cashierName: text('cashier_name').notNull(),
    number: text('number').notNull(),
    status: text('status', { enum: EDGE_SHIFT_STATUSES }).notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    openingFloat: money('opening_float').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    countedCash: money('counted_cash'),
    floatKept: money('float_kept'),
    note: text('note'),
  },
  (t) => [
    unique('edge_shifts_number_key').on(t.number),
    uniqueIndex('edge_shifts_one_open_per_till')
      .on(t.tillCode)
      .where(sql`status = 'OPEN'`),
  ],
);

/** A sale (or a return) as the till made it: the document replayed and the receipt shown. */
export const edgeSales = pgTable(
  'edge_sales',
  {
    clientId: uuid('client_id').primaryKey(),
    kind: text('kind').$type<SaleKind>().notNull().default('SALE'),
    /** On a RETURN: the sale it takes goods back from (ADR-0104). */
    refundsClientId: uuid('refunds_client_id'),
    shiftClientId: uuid('shift_client_id')
      .notNull()
      .references(() => edgeShifts.clientId),
    tillCode: text('till_code').notNull(),
    cashierUserId: bigint('cashier_user_id', { mode: 'number' }).notNull(),
    number: text('number').notNull(),
    soldAt: timestamp('sold_at', { withTimezone: true }).notNull(),
    total: money('total').notNull(),
    /** The part paid in cash (change already given back) and by card. */
    cashAmount: money('cash_amount').notNull(),
    cardAmount: money('card_amount').notNull(),
    /** ADR-0109: the part on credit (a return: taken off the debt) and its customer. */
    creditAmount: money('credit_amount')
      .notNull()
      .default(sql`0`),
    customerId: bigint('customer_id', { mode: 'number' }),
    /** ADR-0110: the part partner vouchers paid (never refunded). */
    voucherAmount: money('voucher_amount')
      .notNull()
      .default(sql`0`),
    vatTotal: money('vat_total').notNull(),
    doc: jsonValue('doc').$type<SaleDocWire>().notNull(),
    receipt: jsonValue('receipt').$type<EdgeReceipt>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('edge_sales_number_key').on(t.number),
    index('edge_sales_shift_idx').on(t.shiftClientId, t.soldAt),
    index('edge_sales_refunds_idx').on(t.refundsClientId),
    check('edge_sales_kind', sql`${t.kind} IN ('SALE', 'RETURN')`),
    index('edge_sales_customer_idx').on(t.customerId),
    check(
      'edge_sales_credit',
      sql`${t.creditAmount} >= 0 AND (${t.creditAmount} = 0 OR ${t.customerId} IS NOT NULL)`,
    ),
  ],
);

/** Goods a supervisor let a till take off a cart before payment (ADR-0104), as replayed. */
export const edgeVoids = pgTable(
  'edge_voids',
  {
    clientId: uuid('client_id').primaryKey(),
    tillCode: text('till_code').notNull(),
    cashierUserId: bigint('cashier_user_id', { mode: 'number' }).notNull(),
    approvedByUserId: bigint('approved_by_user_id', { mode: 'number' }),
    reason: text('reason').$type<VoidReason>().notNull(),
    voidedAt: timestamp('voided_at', { withTimezone: true }).notNull(),
    total: money('total').notNull(),
    doc: jsonValue('doc').$type<VoidDocWire>().notNull(),
  },
  (t) => [index('edge_voids_till_idx').on(t.tillCode, t.voidedAt)],
);

/** A cart set aside on its till (ADR-0104), resumed there at that day's prices. */
export const edgeParked = pgTable(
  'edge_parked',
  {
    clientId: uuid('client_id').primaryKey(),
    tillCode: text('till_code').notNull(),
    cashierUserId: bigint('cashier_user_id', { mode: 'number' }).notNull(),
    cashierName: text('cashier_name').notNull(),
    parkedAt: timestamp('parked_at', { withTimezone: true }).notNull().defaultNow(),
    lines: jsonValue('lines').$type<EdgeCartLine[]>().notNull(),
    itemCount: integer('item_count').notNull(),
    total: money('total').notNull(),
    preview: text('preview').notNull(),
  },
  (t) => [index('edge_parked_till_idx').on(t.tillCode, t.parkedAt)],
);

export const OUTBOX_STATUSES = ['PENDING', 'SENT', 'REJECTED'] as const;
export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/** What the centre has still to hear, in the order it happened (ADR-0063 #4). */
export const edgeOutbox = pgTable(
  'edge_outbox',
  {
    seq: bigint('seq', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    kind: text('kind').notNull(),
    clientId: uuid('client_id').notNull(),
    payload: jsonValue('payload').$type<SyncEventWire>().notNull(),
    status: text('status', { enum: OUTBOX_STATUSES }).notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    /** The centre's refusal (REJECTED) or the last transport error. */
    code: text('code'),
    lastError: text('last_error'),
    createdAt: createdAt(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    unique('edge_outbox_kind_client_key').on(t.kind, t.clientId),
    index('edge_outbox_pending_idx').on(t.status, t.seq),
  ],
);

export const EDGE_RECEIPT_OPS = ['ISSUE', 'CANCEL'] as const;
export type EdgeReceiptOp = (typeof EDGE_RECEIPT_OPS)[number];

/**
 * An operation's state (ADR-0065). SENDING: claimed by one caller, the call under way (found at
 * boot it becomes INDETERMINATE for an ISSUE, PENDING again for a CANCEL). DONE: issued, or the
 * cancellation accepted. ERROR: PosAPI refused (certainly not issued). INDETERMINATE: sent and
 * unanswered — never sent again without a supervisor. ABANDONED: a supervisor found it was not
 * issued; a new operation took its place.
 */
export const EDGE_RECEIPT_STATUSES = [
  'PENDING',
  'SENDING',
  'DONE',
  'ERROR',
  'INDETERMINATE',
  'ABANDONED',
] as const;
export type EdgeReceiptStatus = (typeof EDGE_RECEIPT_STATUSES)[number];

/** One line of a receipt as it was sold, kept to build the PosAPI request (ADR-0065). */
export interface EdgeReceiptLine {
  name: string;
  barCode: string | null;
  barCodeType: 'GS1' | 'ISBN' | 'UNDEFINED';
  classificationCode: string | null;
  taxType: EbarimtTaxType;
  taxProductCode: string | null;
  measureUnit: string;
  qty: string;
  total: string;
  vat: string;
}

/**
 * The store PosAPI's operations, in the order they must happen (ADR-0065): a sale's receipt, a
 * full return's cancellation, a partial return's replacement. Only facts PosAPI answered — never
 * the lottery or the QR data (CLAUDE.md NEVER).
 */
export const edgeReceipts = pgTable(
  'edge_receipts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    op: text('op', { enum: EDGE_RECEIPT_OPS }).notNull(),
    /** The edge sale (SALE or RETURN) this operation was made for. */
    ownerClientId: uuid('owner_client_id')
      .notNull()
      .references(() => edgeSales.clientId),
    /** The first sale of the chain: every receipt of one sale and its returns share it. */
    chainClientId: uuid('chain_client_id').notNull(),
    /** CANCEL: whose receipt it cancels; a replacement ISSUE: whose receipt it makes inactive. */
    targetClientId: uuid('target_client_id'),
    tillCode: text('till_code').notNull(),
    status: text('status', { enum: EDGE_RECEIPT_STATUSES }).notNull().default('PENDING'),
    receiptType: text('receipt_type').$type<ReceiptType>().notNull(),
    customerTin: text('customer_tin'),
    customerName: text('customer_name'),
    /** ISSUE: the lines and payments the receipt is built from; null for a CANCEL. */
    lines: jsonValue('lines').$type<EdgeReceiptLine[] | null>(),
    payments: jsonValue('payments').$type<{ code: EbarimtPaymentCode; amount: string }[] | null>(),
    total: money('total').notNull(),
    vatTotal: money('vat_total').notNull(),
    ddtd: text('ddtd'),
    /** PosAPI's `date` verbatim. */
    posapiDate: text('posapi_date'),
    inactiveId: text('inactive_id'),
    message: text('message'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /** The first try failed: once issued, the receipt waits to be printed (`READY`). */
    late: boolean('late').notNull().default(false),
    resolvedByUserId: bigint('resolved_by_user_id', { mode: 'number' }),
    createdAt: createdAt(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [
    index('edge_receipts_open_idx').on(t.status, t.id),
    index('edge_receipts_owner_idx').on(t.ownerClientId),
    index('edge_receipts_chain_idx').on(t.chainClientId, t.id),
    check('edge_receipts_op', sql`${t.op} IN ('ISSUE', 'CANCEL')`),
    check(
      'edge_receipts_status',
      sql`${t.status} IN ('PENDING', 'SENDING', 'DONE', 'ERROR', 'INDETERMINATE', 'ABANDONED')`,
    ),
    check('edge_receipts_type', sql`${t.receiptType} IN ('B2C', 'B2B')`),
    check('edge_receipts_cancel_target', sql`${t.op} = 'ISSUE' OR ${t.targetClientId} IS NOT NULL`),
    check('edge_receipts_issue_lines', sql`${t.op} = 'CANCEL' OR ${t.lines} IS NOT NULL`),
  ],
);

/**
 * A code a till took (ADR-0110): one row per code, so no two sales of this store take the same
 * code, offline too; the centre learns of it with the sale.
 */
export const edgeVoucherUses = pgTable(
  'edge_voucher_uses',
  {
    code: text('code').primaryKey(),
    voucherId: bigint('voucher_id', { mode: 'number' }).notNull(),
    kind: text('kind').$type<VoucherKind>().notNull(),
    saleClientId: uuid('sale_client_id')
      .notNull()
      .references(() => edgeSales.clientId),
    amount: money('amount').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('edge_voucher_uses_sale_idx').on(t.saleClientId),
    check('edge_voucher_uses_kind', sql`${t.kind} IN ('COUPON', 'PARTNER')`),
    check('edge_voucher_uses_amount', sql`${t.amount} >= 0`),
  ],
);

/** Wrong PINs per cashier on this edge: five in a row lock the cashier for a minute. */
export const edgePinAttempts = pgTable('edge_pin_attempts', {
  userId: bigint('user_id', { mode: 'number' }).primaryKey(),
  failedCount: integer('failed_count').notNull().default(0),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});
