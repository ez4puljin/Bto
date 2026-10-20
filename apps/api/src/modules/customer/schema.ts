import { BANNER_LINK_KINDS, BANNER_TITLE_MAX } from '@tugeel/shared/sales';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { products } from '../catalog/schema';
import { customerUsers, files, users } from '../identity/schema';

// The tables owned by the customer module (docs/modules/customer.md, ADR-0079, ADR-0082).
// Migration 0031_customer_app adds by hand: the REVOKE that keeps the contact list's rows from
// being truncated (they are deleted one by one when an admin removes a contact, with an audit row).
// Migration 0036_customer_app_home adds by hand: the REVOKE that keeps banners from being deleted
// (they are archived) and `app_banners_position` DEFERRABLE INITIALLY IMMEDIATE (Drizzle cannot
// say it), so two banners swap places in one UPDATE; regenerating that constraint would drop it.

const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Limits of a company contact (ADR-0079 #14), shared by the DTO and the CHECKs. */
export const CONTACT_LIMITS = { maxRole: 60, maxName: 80, maxContacts: 30 } as const;

/**
 * A store's ★ products (ADR-0079 #4), kept per customer app account on the server, so a new phone
 * keeps them. Added and removed, never updated.
 */
export const customerFavourites = pgTable(
  'customer_favourites',
  {
    customerUserId: ref('customer_user_id')
      .notNull()
      .references(() => customerUsers.id, { onDelete: 'cascade' }),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.customerUserId, t.productId] })],
);

/**
 * «Холбоо барих» on the app's «Нүүр» (ADR-0079 #14): the company's contact people, the same for
 * every store, kept by admins. `position` orders them; `shown` = false keeps a row off the app.
 */
export const companyContacts = pgTable(
  'company_contacts',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    role: text('role').notNull(),
    name: text('name').notNull(),
    phone: text('phone').notNull(),
    position: smallint('position').notNull(),
    shown: boolean('shown').notNull().default(true),
    createdBy: ref('created_by').references(() => users.id),
    updatedBy: ref('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('company_contacts_position').on(t.position),
    check(
      'company_contacts_role',
      sql`length(btrim(${t.role})) BETWEEN 1 AND ${sql.raw(String(CONTACT_LIMITS.maxRole))}`,
    ),
    check(
      'company_contacts_name',
      sql`length(btrim(${t.name})) BETWEEN 1 AND ${sql.raw(String(CONTACT_LIMITS.maxName))}`,
    ),
    check('company_contacts_phone', sql`${t.phone} ~ '^[+]976[0-9]{8}$'`),
    check('company_contacts_position_range', sql`${t.position} >= 1`),
  ],
);

/**
 * The banners of «Bto300»'s home (ADR-0092 #5): a picture, a short title (its alt text) and what a
 * tap opens, shown from `valid_from` until the day before `valid_to`, in `position` order.
 * `link_id` names a segment, a category or a product without a foreign key: those belong to other
 * modules and every read checks the target again (a gone one leaves the banner without its link).
 * Archived, never deleted.
 */
export const appBanners = pgTable(
  'app_banners',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    imageFileId: ref('image_file_id')
      .notNull()
      .references(() => files.id),
    title: text('title').notNull(),
    linkKind: text('link_kind', { enum: BANNER_LINK_KINDS }).notNull().default('NONE'),
    linkId: ref('link_id'),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    /** Exclusive, like notices and discount programs; null runs until archived. */
    validTo: date('valid_to', { mode: 'string' }),
    position: smallint('position').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: ref('created_by').references(() => users.id),
    updatedBy: ref('updated_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('app_banners_image_file_key').on(t.imageFileId),
    unique('app_banners_position').on(t.position),
    check(
      'app_banners_title',
      sql`length(btrim(${t.title})) BETWEEN 1 AND ${sql.raw(String(BANNER_TITLE_MAX))}`,
    ),
    check(
      'app_banners_link_kind',
      sql`${t.linkKind} IN ('NONE', 'SEGMENT', 'CATEGORY', 'PRODUCT')`,
    ),
    check('app_banners_link', sql`(${t.linkKind} = 'NONE') = (${t.linkId} IS NULL)`),
    check('app_banners_period', sql`${t.validTo} IS NULL OR ${t.validTo} > ${t.validFrom}`),
    check('app_banners_position_range', sql`${t.position} >= 1`),
  ],
);
