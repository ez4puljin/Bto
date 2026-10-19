import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { products } from '../catalog/schema';
import { customerUsers, users } from '../identity/schema';

// The tables owned by the customer module (docs/modules/customer.md, ADR-0079, ADR-0082).
// Migration 0031_customer_app adds by hand: the REVOKE that keeps the contact list's rows from
// being truncated (they are deleted one by one when an admin removes a contact, with an audit row).

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
