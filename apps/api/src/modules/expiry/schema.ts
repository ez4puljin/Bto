import {
  EXPIRY_CHANGE_KINDS,
  EXPIRY_LIABILITY_TYPES,
  EXPIRY_STATUSES,
} from '@tugeel/shared/expiry';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { qty } from '../../common/db/types';
import { products } from '../catalog/schema';
import { roles, users } from '../identity/schema';

// Tables owned by the expiry module (ADR-0172, docs/modules/expiry.md): what someone saw on a shelf,
// an observation log that never touches the stock ledger. Nothing is deleted, a record is archived
// (DELETE and TRUNCATE are revoked from the app role), and a quantity's history never changes.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const at = (name: string) => timestamp(name, { withTimezone: true });
const zero = sql`0`;

/**
 * One record: a product, a date, two counted quantities, a status, a liability and a note. Names are
 * text on the row (ADR-0172 #12): the signed-in user's full name at the time, or the old system's
 * username on a carried row, which belongs to no Bto user.
 */
export const expiryItems = pgTable(
  'expiry_items',
  {
    id: id(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    /** Counted on the sales floor, in the product's base unit. */
    qtyFloor: qty('qty_floor').notNull().default(zero),
    /** Counted in the warehouse, in the product's base unit. */
    qtyWarehouse: qty('qty_warehouse').notNull().default(zero),
    status: text('status', { enum: EXPIRY_STATUSES }).notNull().default('REVIEW'),
    liabilityType: text('liability_type', { enum: EXPIRY_LIABILITY_TYPES })
      .notNull()
      .default('NONE'),
    liabilityNote: text('liability_note'),
    note: text('note'),
    /** Bumped by date, quantity and note edits only: a status decision refuses no count (#6). */
    editVersion: integer('edit_version').notNull().default(1),
    createdAt: at('created_at').notNull().defaultNow(),
    createdBy: userRef('created_by'),
    createdByName: text('created_by_name').notNull(),
    updatedAt: at('updated_at').notNull().defaultNow(),
    /** NULL on a carried row nobody has touched in Bto: a later carry may still refresh it (#12). */
    updatedBy: userRef('updated_by'),
    archivedAt: at('archived_at'),
    archivedBy: userRef('archived_by'),
    archivedByName: text('archived_by_name'),
    /** The old system's id: what makes a carry idempotent. */
    legacyId: bigint('legacy_id', { mode: 'number' }),
  },
  (t) => [
    index('expiry_items_date_idx').on(t.expiryDate, t.id),
    index('expiry_items_status_date_idx').on(t.status, t.expiryDate, t.id),
    index('expiry_items_product_idx').on(t.productId),
    uniqueIndex('expiry_items_legacy_key')
      .on(t.legacyId)
      .where(sql`${t.legacyId} IS NOT NULL`),
    check('expiry_items_qty_floor', sql`${t.qtyFloor} >= 0`),
    check('expiry_items_qty_warehouse', sql`${t.qtyWarehouse} >= 0`),
    check(
      'expiry_items_status',
      sql`${t.status} IN ('REVIEW', 'CITY_RETURN', 'INTERNAL_SALE', 'ARCHIVED')`,
    ),
    check(
      'expiry_items_liability_type',
      sql`${t.liabilityType} IN ('NONE', 'SPECIFIC', 'ALL_STAFF')`,
    ),
    check(
      'expiry_items_liability_note',
      sql`${t.liabilityNote} IS NULL OR length(${t.liabilityNote}) BETWEEN 1 AND 500`,
    ),
    check('expiry_items_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 1000`),
    check('expiry_items_edit_version', sql`${t.editVersion} >= 1`),
    check('expiry_items_archived', sql`(${t.status} = 'ARCHIVED') = (${t.archivedAt} IS NOT NULL)`),
  ],
);

/** The quantity history: a record's creation is its first row, a row never changes (ADR-0172 #3). */
export const expiryItemChanges = pgTable(
  'expiry_item_changes',
  {
    id: id(),
    itemId: ref('item_id')
      .notNull()
      .references(() => expiryItems.id),
    kind: text('kind', { enum: EXPIRY_CHANGE_KINDS }).notNull(),
    qtyFloorOld: qty('qty_floor_old').notNull(),
    qtyFloorNew: qty('qty_floor_new').notNull(),
    qtyWarehouseOld: qty('qty_warehouse_old').notNull(),
    qtyWarehouseNew: qty('qty_warehouse_new').notNull(),
    changedAt: at('changed_at').notNull().defaultNow(),
    changedBy: userRef('changed_by'),
    changedByName: text('changed_by_name').notNull(),
    /** The old change's id: a re-carry appends only what is not here yet. */
    legacyId: bigint('legacy_id', { mode: 'number' }),
  },
  (t) => [
    index('expiry_item_changes_item_idx').on(t.itemId, t.changedAt, t.id),
    uniqueIndex('expiry_item_changes_legacy_key')
      .on(t.legacyId)
      .where(sql`${t.legacyId} IS NOT NULL`),
    check('expiry_item_changes_kind', sql`${t.kind} IN ('CREATE', 'UPDATE')`),
  ],
);

/** The roles held liable for a record: replaced whole by a liability save. */
export const expiryItemRoles = pgTable(
  'expiry_item_roles',
  {
    itemId: ref('item_id')
      .notNull()
      .references(() => expiryItems.id),
    roleId: ref('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.roleId] })],
);

/** The people held liable for a record: replaced whole by a liability save. */
export const expiryItemUsers = pgTable(
  'expiry_item_users',
  {
    itemId: ref('item_id')
      .notNull()
      .references(() => expiryItems.id),
    userId: userRef('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.userId] })],
);
