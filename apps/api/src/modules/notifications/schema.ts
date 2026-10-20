import {
  CUSTOMER_NOTIFICATION_KINDS,
  NOTICE_AUDIENCES,
  NOTICE_KINDS,
  NOTICE_LIMITS,
  USER_NOTIFICATION_KINDS,
} from '@tugeel/shared/notifications';
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
import { jsonValue } from '../../common/db/types';
import { products } from '../catalog/schema';
import { invoices } from '../finance/schema';
import { customerUsers, files, users } from '../identity/schema';
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
 * A notification addressed to one user (ADR-0062 #4): today a rep's order that was sold. The
 * payload holds what the app shows, by value (money as strings); one row per order and kind.
 */
export const userNotifications = pgTable(
  'user_notifications',
  {
    id: id(),
    userId: userRef('user_id').notNull(),
    kind: text('kind', { enum: USER_NOTIFICATION_KINDS }).notNull(),
    orderId: ref('order_id').references(() => salesOrders.id),
    payload: jsonValue('payload').notNull(),
    createdAt: createdAt(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    unique('user_notifications_order').on(t.kind, t.orderId),
    index('user_notifications_user_idx').on(t.userId, t.id),
    index('user_notifications_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
    check('user_notifications_kind', inList(t.kind, USER_NOTIFICATION_KINDS)),
    check(
      'user_notifications_order_required',
      sql`${t.kind} <> 'ORDER_SOLD' OR ${t.orderId} IS NOT NULL`,
    ),
  ],
);
