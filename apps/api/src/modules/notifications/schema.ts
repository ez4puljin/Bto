import {
  CUSTOMER_NOTIFICATION_KINDS,
  NOTICE_AUDIENCES,
  NOTICE_KINDS,
  NOTICE_LIMITS,
  USER_NOTIFICATION_KINDS,
  SMS_BATCH_STATUSES,
  SMS_MESSAGE_STATUSES,
  SMS_PURPOSES,
} from '@tugeel/shared/notifications';
import { SETTLEMENT_GROUPS } from '@tugeel/shared/finance';
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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { jsonValue, money } from '../../common/db/types';
import { products } from '../catalog/schema';
import { invoices } from '../finance/schema';
import { customerUsers, files, users } from '../identity/schema';
import { customers } from '../partners/schema';
import { phoneCallbacks } from '../phone-agent/schema';
import { salesOrders } from '../sales/schema';

// The tables owned by the notifications module (docs/modules/notifications.md, ADR-0062).
// Migration 0030_notifications (0028 before the merge with main) adds by hand: the REVOKEs and
// column grants that leave a sent notice, its products and its reads unchangeable except for the
// withdrawal and `read_at`.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;
/** A limit from the shared package, inlined: a bound parameter would not do in a CHECK. */
const lim = (value: number): SQL => sql.raw(String(value));

/**
 * A notice the admin sent to the rep app (ADR-0062 #1): never edited; withdrawn instead. It runs
 * from `valid_from` until the day before `valid_to` (open-ended when null), Ulaanbaatar dates.
 */
export const appNotices = pgTable(
  'app_notices',
  {
    id: id(),
    kind: text('kind', { enum: NOTICE_KINDS }).notNull(),
    /** Who reads it (ADR-0079 #8): the sales reps' app or the customers' «Bto300». */
    audience: text('audience', { enum: NOTICE_AUDIENCES }).notNull().default('SALES_REPS'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    imageFileId: ref('image_file_id').references(() => files.id),
    /** Shown in the middle of the screen when the app opens (until read). */
    popup: boolean('popup').notNull().default(false),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: userRef('withdrawn_by'),
  },
  (t) => [
    uniqueIndex('app_notices_image').on(t.imageFileId),
    index('app_notices_live_idx')
      .on(t.validFrom, t.id)
      .where(sql`${t.withdrawnAt} IS NULL`),
    check('app_notices_kind', inList(t.kind, NOTICE_KINDS)),
    check('app_notices_audience', inList(t.audience, NOTICE_AUDIENCES)),
    check(
      'app_notices_title',
      sql`length(btrim(${t.title})) BETWEEN 1 AND ${lim(NOTICE_LIMITS.titleMax)}`,
    ),
    check(
      'app_notices_body',
      sql`length(btrim(${t.body})) BETWEEN 1 AND ${lim(NOTICE_LIMITS.bodyMax)}`,
    ),
    check('app_notices_dates', sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`),
    check('app_notices_withdrawn', sql`(${t.withdrawnAt} IS NULL) = (${t.withdrawnBy} IS NULL)`),
  ],
);

/** The products a notice links to, in the admin's order (`position` 1…20). */
export const appNoticeProducts = pgTable(
  'app_notice_products',
  {
    noticeId: ref('notice_id')
      .notNull()
      .references(() => appNotices.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    position: smallint('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.noticeId, t.productId] }),
    unique('app_notice_products_position').on(t.noticeId, t.position),
    check(
      'app_notice_products_position_range',
      sql`${t.position} BETWEEN 1 AND ${lim(NOTICE_LIMITS.productsMax)}`,
    ),
  ],
);

/** Who read (or closed) a notice, once (ADR-0062 #3). */
export const appNoticeReads = pgTable(
  'app_notice_reads',
  {
    noticeId: ref('notice_id')
      .notNull()
      .references(() => appNotices.id),
    userId: userRef('user_id').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noticeId, t.userId] })],
);

/** Which store's account read (or closed) a customers' notice, once (ADR-0079 #8). */
export const appNoticeCustomerReads = pgTable(
  'app_notice_customer_reads',
  {
    noticeId: ref('notice_id')
      .notNull()
      .references(() => appNotices.id),
    customerUserId: ref('customer_user_id')
      .notNull()
      .references(() => customerUsers.id),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.noticeId, t.customerUserId] })],
);

/**
 * A notification addressed to a store's customer app account (ADR-0079 #8): its order confirmed,
 * cancelled or sold, a payment recorded, an invoice due soon or overdue. Written once per kind and
 * document (the unique keys), the payload by value (money as strings).
 */
export const customerNotifications = pgTable(
  'customer_notifications',
  {
    id: id(),
    customerUserId: ref('customer_user_id')
      .notNull()
      .references(() => customerUsers.id),
    kind: text('kind', { enum: CUSTOMER_NOTIFICATION_KINDS }).notNull(),
    orderId: ref('order_id').references(() => salesOrders.id),
    invoiceId: ref('invoice_id').references(() => invoices.id),
    /** The voucher: a Finance Core document id (ADR-0090), no FK leaves `fin`. */
    paymentId: ref('payment_id'),
    payload: jsonValue('payload').notNull(),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    unique('customer_notifications_order').on(t.kind, t.orderId),
    unique('customer_notifications_invoice').on(t.kind, t.invoiceId),
    unique('customer_notifications_payment').on(t.kind, t.paymentId),
    index('customer_notifications_account_idx').on(t.customerUserId, t.id),
    index('customer_notifications_unread_idx')
      .on(t.customerUserId)
      .where(sql`${t.readAt} IS NULL`),
    check('customer_notifications_kind', inList(t.kind, CUSTOMER_NOTIFICATION_KINDS)),
    check(
      'customer_notifications_document',
      sql`CASE
        WHEN ${t.kind} IN ('ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_SOLD')
          THEN ${t.orderId} IS NOT NULL AND ${t.paymentId} IS NULL
        WHEN ${t.kind} = 'PAYMENT_RECORDED'
          THEN ${t.paymentId} IS NOT NULL AND ${t.orderId} IS NULL AND ${t.invoiceId} IS NULL
        ELSE ${t.invoiceId} IS NOT NULL AND ${t.orderId} IS NULL AND ${t.paymentId} IS NULL
      END`,
    ),
  ],
);

/**
 * A notification addressed to one user (ADR-0062 #4, ADR-0232 #9): a rep's order that was sold,
 * one row per order; a phone AI order or callback, one row per recipient. The payload holds what
 * the app shows, by value (money as strings).
 */
export const userNotifications = pgTable(
  'user_notifications',
  {
    id: id(),
    userId: userRef('user_id').notNull(),
    kind: text('kind', { enum: USER_NOTIFICATION_KINDS }).notNull(),
    orderId: ref('order_id').references(() => salesOrders.id),
    /** The callback task a PHONE_CALLBACK tells of (ADR-0232 #9). */
    callbackId: ref('callback_id').references(() => phoneCallbacks.id),
    payload: jsonValue('payload').notNull(),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    // One ORDER_SOLD per order (its author); the kinds told to several people keep one row per
    // recipient (migration 0118 replaced the table-wide unique (kind, order_id), ADR-0232 #9).
    uniqueIndex('user_notifications_sold_order')
      .on(t.kind, t.orderId)
      .where(sql`${t.kind} = 'ORDER_SOLD'`),
    uniqueIndex('user_notifications_order_user')
      .on(t.kind, t.orderId, t.userId)
      .where(sql`${t.orderId} IS NOT NULL`),
    uniqueIndex('user_notifications_callback_user')
      .on(t.kind, t.callbackId, t.userId)
      .where(sql`${t.callbackId} IS NOT NULL`),
    index('user_notifications_user_idx').on(t.userId, t.id),
    index('user_notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
    check('user_notifications_kind', inList(t.kind, USER_NOTIFICATION_KINDS)),
    check(
      'user_notifications_phone_order',
      sql`${t.kind} <> 'PHONE_ORDER' OR ${t.orderId} IS NOT NULL`,
    ),
    check(
      'user_notifications_phone_callback',
      sql`(${t.kind} = 'PHONE_CALLBACK') = (${t.callbackId} IS NOT NULL)`,
    ),
    check(
      'user_notifications_order_required',
      sql`${t.kind} <> 'ORDER_SOLD' OR ${t.orderId} IS NOT NULL`,
    ),
  ],
);

// ------------------------------------------------------------------------------------------------
// Settlement SMS (ADR-0216). Migration 0109_settlement_sms adds by hand the REVOKEs and column grants
// that keep a batch's template and a message's text, number and balance as they were written.

const at = (name: string) => timestamp(name, { withTimezone: true });
const SMS_ERROR_CODE = '^[a-z_]{1,64}$';

/** WeSend's key (one row): sealed with ERKHET_KEY_SECRET under its own context, never returned. */
export const smsSettings = pgTable(
  'sms_settings',
  {
    id: smallint('id').primaryKey(),
    apiKeySealed: text('api_key_sealed'),
    /** Off: nothing is sent, a batch waiting is marked FAILED `sms_disabled`. */
    enabled: boolean('enabled').notNull().default(true),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [check('sms_settings_single', sql`${t.id} = 1`)],
);

/** One press of «Илгээх»: the template as typed, who sent it and how it ended. */
export const smsBatches = pgTable(
  'sms_batches',
  {
    id: id(),
    purpose: text('purpose', { enum: SMS_PURPOSES }).notNull(),
    settlementGroup: text('settlement_group', { enum: SETTLEMENT_GROUPS }),
    template: text('template').notNull(),
    status: text('status', { enum: SMS_BATCH_STATUSES }).notNull().default('QUEUED'),
    totalCount: integer('total_count').notNull(),
    sentCount: integer('sent_count').notNull().default(0),
    failedCount: integer('failed_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    /** WeSend's credits the sent texts took. */
    creditsUsed: integer('credits_used').notNull().default(0),
    /** Why the batch stopped early (a refused key, no credits, sending paused). */
    stoppedCode: text('stopped_code'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
  },
  (t) => [
    index('sms_batches_list_idx').on(t.createdAt, t.id),
    check('sms_batches_purpose', inList(t.purpose, SMS_PURPOSES)),
    check('sms_batches_status', inList(t.status, SMS_BATCH_STATUSES)),
    check(
      'sms_batches_group',
      sql`${t.settlementGroup} IS NULL OR ${inList(t.settlementGroup, SETTLEMENT_GROUPS)}`,
    ),
    check('sms_batches_template', sql`length(btrim(${t.template})) BETWEEN 1 AND 1000`),
    check(
      'sms_batches_counts',
      sql`${t.sentCount} + ${t.failedCount} + ${t.skippedCount} <= ${t.totalCount}`,
    ),
    check(
      'sms_batches_stopped',
      sql`${t.stoppedCode} IS NULL OR ${t.stoppedCode} ~ ${sql.raw(`'${SMS_ERROR_CODE}'`)}`,
    ),
  ],
);

/** One customer's text in a batch, frozen as rendered with that customer's balance. */
export const smsMessages = pgTable(
  'sms_messages',
  {
    id: id(),
    batchId: ref('batch_id')
      .notNull()
      .references(() => smsBatches.id),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    customerCode: text('customer_code').notNull(),
    customerName: text('customer_name').notNull(),
    /** E.164 as stored on the customer; null when the customer had none (SKIPPED). */
    phone: text('phone'),
    text: text('text').notNull(),
    /** The receivable balance the text was rendered with. */
    balance: money('balance').notNull(),
    status: text('status', { enum: SMS_MESSAGE_STATUSES }).notNull(),
    /** Sent to WeSend as `Idempotency-Key` on every attempt at this message. */
    idempotencyKey: uuid('idempotency_key').notNull().defaultRandom(),
    providerMessageId: text('provider_message_id'),
    parts: smallint('parts'),
    credits: integer('credits'),
    errorCode: text('error_code'),
    createdAt: createdAt(),
    sentAt: at('sent_at'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('sms_messages_batch_customer').on(t.batchId, t.customerId),
    uniqueIndex('sms_messages_idempotency_key').on(t.idempotencyKey),
    index('sms_messages_batch_idx').on(t.batchId, t.status, t.id),
    index('sms_messages_customer_sent_idx')
      .on(t.customerId, t.sentAt)
      .where(sql`${t.status} = 'SENT'`),
    check('sms_messages_status', inList(t.status, SMS_MESSAGE_STATUSES)),
    check('sms_messages_phone', sql`${t.phone} IS NULL OR ${t.phone} ~ '^\\+976[0-9]{8}$'`),
    check(
      'sms_messages_error',
      sql`${t.errorCode} IS NULL OR ${t.errorCode} ~ ${sql.raw(`'${SMS_ERROR_CODE}'`)}`,
    ),
    check(
      'sms_messages_outcome',
      sql`(${t.status} = 'SENT') = (${t.sentAt} IS NOT NULL AND ${t.providerMessageId} IS NOT NULL)
        AND (${t.status} IN ('FAILED', 'SKIPPED')) = (${t.errorCode} IS NOT NULL)`,
    ),
  ],
);
