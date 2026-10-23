import { SETTLEMENT_GROUPS } from '@tugeel/shared/finance';
import { CUSTOMER_KINDS } from '@tugeel/shared/taxpayer';
import { sql } from 'drizzle-orm';
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
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { coordinate, money } from '../../common/db/types';
import { products } from '../catalog/schema';

// Tables owned by the partners module (docs/architecture.md §4, docs/modules/partners.md; ADR-0015,
// ADR-0017, ADR-0028, ADR-0032). Migration 0004_partners adds by hand the REVOKEs that keep
// customers, their addresses and suppliers from being deleted: documents will reference them.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

export const PARTNER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
/** Where a TIN or a payer status came from: the office box (getTinInfo/getInfo) or a person. */
export const TAX_INFO_SOURCES = ['LOOKUP', 'MANUAL'] as const;
/** Who placed a GPS point: the office from a map, or a driver/rep on site (delivery 4–5). */
export const GPS_SOURCES = ['OFFICE', 'FIELD'] as const;

/** Mongolian mobile numbers in E.164 (ADR-0005 #3); `[+]` avoids backslashes in SQL text. */
const phoneCheck = (column: AnyPgColumn) =>
  sql`${column} IS NULL OR ${column} ~ '^[+]976[0-9]{8}$'`;
const lengthCheck = (column: AnyPgColumn, max: number) =>
  sql`${column} IS NULL OR length(${column}) BETWEEN 1 AND ${sql.raw(String(max))}`;

/**
 * Customers (SPEC §5.3, §6.10): every store is its own customer, so registration numbers, TINs and
 * phones may repeat. Kind-specific TIN and registration-number rules live in @tugeel/shared/taxpayer;
 * the database keeps the formats receipts rely on.
 */
export const customers = pgTable(
  'customers',
  {
    id: id(),
    /** The owner's numeric customer code. */
    code: text('code').notNull(),
    kind: text('kind', { enum: CUSTOMER_KINDS }).notNull(),
    name: text('name').notNull(),
    /** Search keys of name and code (ADR-0028), written by the partners service only. */
    searchText: text('search_text').notNull(),
    searchPhonetic: text('search_phonetic').notNull(),
    searchVersion: smallint('search_version').notNull(),
    /** Registration number (регистр), normalised free text. */
    regNo: text('reg_no'),
    tin: text('tin'),
    tinSource: text('tin_source', { enum: TAX_INFO_SOURCES }),
    /** A citizen's e-Barimt consumer number (receipts land in the citizen's account). */
    consumerNo: text('consumer_no'),
    phone: text('phone'),
    /** Payer flags of the customer: false until checked (ADR-0015 #4); informational for now. */
    vatPayer: boolean('vat_payer').notNull().default(false),
    cityPayer: boolean('city_payer').notNull().default(false),
    taxStatusSource: text('tax_status_source', { enum: TAX_INFO_SOURCES }),
    taxStatusCheckedAt: timestamp('tax_status_checked_at', { withTimezone: true }),
    /** NULL = not decided yet (owner answer 2026-10-11); credit control comes in delivery 3. */
    creditLimit: money('credit_limit'),
    /** When the invoices fall due (ADR-0101): DAY_20 «Мөрөн» on the 20th, MONTH_END «Орон нутаг». */
    settlementGroup: text('settlement_group', { enum: SETTLEMENT_GROUPS }).notNull(),
    creditHold: boolean('credit_hold').notNull().default(false),
    creditHoldReason: text('credit_hold_reason'),
    note: text('note'),
    status: text('status', { enum: PARTNER_STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('customers_code_key').on(t.code),
    index('customers_name_idx').on(t.name, t.id),
    index('customers_search_text_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    index('customers_search_phonetic_idx').using('gin', t.searchPhonetic.op('gin_trgm_ops')),
    index('customers_reg_no_idx').on(t.regNo),
    index('customers_tin_idx').on(t.tin),
    index('customers_phone_idx').on(t.phone),
    check('customers_code_format', sql`${t.code} ~ '^[0-9]{1,20}$'`),
    check('customers_kind', sql`${t.kind} IN ('COMPANY', 'INDIVIDUAL')`),
    check('customers_name', sql`length(${t.name}) BETWEEN 1 AND 200`),
    check('customers_reg_no', lengthCheck(t.regNo, 20)),
    check('customers_tin', sql`${t.tin} IS NULL OR ${t.tin} ~ '^[0-9]{11,14}$'`),
    check(
      'customers_tin_source',
      sql`(${t.tin} IS NULL) = (${t.tinSource} IS NULL) AND (${t.tinSource} IS NULL OR ${t.tinSource} IN ('LOOKUP', 'MANUAL'))`,
    ),
    check(
      'customers_consumer_no',
      sql`${t.consumerNo} IS NULL OR (${t.kind} = 'INDIVIDUAL' AND ${t.consumerNo} ~ '^[0-9]{8}$')`,
    ),
    check('customers_phone', phoneCheck(t.phone)),
    check(
      'customers_tax_status',
      sql`(${t.taxStatusSource} IS NULL) = (${t.taxStatusCheckedAt} IS NULL)
        AND (${t.taxStatusSource} IS NULL OR ${t.taxStatusSource} IN ('LOOKUP', 'MANUAL'))
        AND (${t.taxStatusSource} IS NOT NULL OR NOT (${t.vatPayer} OR ${t.cityPayer}))`,
    ),
    check('customers_credit_limit', sql`${t.creditLimit} IS NULL OR ${t.creditLimit} >= 0`),
    check('customers_settlement_group', sql`${t.settlementGroup} IN ('DAY_20', 'MONTH_END')`),
    check(
      'customers_credit_hold_reason',
      sql`${t.creditHoldReason} IS NULL OR (${t.creditHold} AND length(${t.creditHoldReason}) BETWEEN 1 AND 300)`,
    ),
    check('customers_note', lengthCheck(t.note, 1000)),
    check('customers_status', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

/**
 * Delivery addresses: one default per customer (every store is its own customer, so most have one).
 * Archived instead of deleted, because orders will reference them (delivery 2). `zone_id` gets its
 * foreign key to delivery_zones in the delivery module's migration (delivery 5).
 */
export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: id(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    label: text('label'),
    address: text('address'),
    lat: coordinate('lat'),
    lng: coordinate('lng'),
    gpsSource: text('gps_source', { enum: GPS_SOURCES }),
    zoneId: ref('zone_id'),
    /** Landmark or delivery note. */
    note: text('note'),
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customer_addresses_customer_idx').on(t.customerId),
    uniqueIndex('customer_addresses_one_default')
      .on(t.customerId)
      .where(sql`${t.isDefault}`),
    check('customer_addresses_label', lengthCheck(t.label, 60)),
    check('customer_addresses_address', lengthCheck(t.address, 300)),
    check('customer_addresses_somewhere', sql`${t.address} IS NOT NULL OR ${t.lat} IS NOT NULL`),
    check('customer_addresses_gps_pair', sql`(${t.lat} IS NULL) = (${t.lng} IS NULL)`),
    check(
      'customer_addresses_gps_source',
      sql`(${t.lat} IS NULL) = (${t.gpsSource} IS NULL) AND (${t.gpsSource} IS NULL OR ${t.gpsSource} IN ('OFFICE', 'FIELD'))`,
    ),
    // @tugeel/shared/geo MONGOLIA_BOUNDS: catches (0,0), sign errors and points pasted from elsewhere.
    check(
      'customer_addresses_mongolia',
      sql`${t.lat} IS NULL OR (${t.lat} BETWEEN 41.5 AND 52.2 AND ${t.lng} BETWEEN 87.7 AND 120)`,
    ),
    check('customer_addresses_note', lengthCheck(t.note, 300)),
    check(
      'customer_addresses_default_active',
      sql`NOT (${t.isDefault} AND ${t.archivedAt} IS NOT NULL)`,
    ),
  ],
);

/** People to call at a customer; a name or a phone at least (Excel cells may hold only numbers). */
export const customerContacts = pgTable(
  'customer_contacts',
  {
    id: id(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    name: text('name'),
    position: text('position'),
    phone: text('phone'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('customer_contacts_customer_idx').on(t.customerId),
    check('customer_contacts_name', lengthCheck(t.name, 100)),
    check('customer_contacts_position', lengthCheck(t.position, 60)),
    check('customer_contacts_phone', phoneCheck(t.phone)),
    check('customer_contacts_note', lengthCheck(t.note, 300)),
    check('customer_contacts_someone', sql`${t.name} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  ],
);

/** Suppliers (SPEC §5.3): unique names too, so the product sheet's supplier column can match. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    searchText: text('search_text').notNull(),
    searchPhonetic: text('search_phonetic').notNull(),
    searchVersion: smallint('search_version').notNull(),
    regNo: text('reg_no'),
    tin: text('tin'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    bankName: text('bank_name'),
    /** Account number or IBAN, spaces removed and upper case. */
    bankAccount: text('bank_account'),
    paymentTermDays: integer('payment_term_days'),
    /** A VAT payer: its delivery-note prices hold VAT the company takes back (ADR-0078). */
    vatPayer: boolean('vat_payer').notNull().default(false),
    note: text('note'),
    status: text('status', { enum: PARTNER_STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('suppliers_code_key').on(t.code),
    unique('suppliers_name_key_key').on(t.nameKey),
    index('suppliers_name_idx').on(t.name, t.id),
    index('suppliers_search_text_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    index('suppliers_search_phonetic_idx').using('gin', t.searchPhonetic.op('gin_trgm_ops')),
    index('suppliers_tin_idx').on(t.tin),
    check('suppliers_code_format', sql`${t.code} ~ '^[0-9]{1,20}$'`),
    check('suppliers_name', sql`length(${t.name}) BETWEEN 1 AND 200`),
    check('suppliers_reg_no', lengthCheck(t.regNo, 20)),
    check('suppliers_tin', sql`${t.tin} IS NULL OR ${t.tin} ~ '^[0-9]{11,14}$'`),
    check('suppliers_phone', phoneCheck(t.phone)),
    check(
      'suppliers_email',
      sql`${t.email} IS NULL OR (length(${t.email}) <= 254 AND ${t.email} ~ '^[^@[:space:]]+@[^@[:space:]]+$')`,
    ),
    check('suppliers_address', lengthCheck(t.address, 300)),
    check('suppliers_bank_name', lengthCheck(t.bankName, 60)),
    check(
      'suppliers_bank_account',
      sql`${t.bankAccount} IS NULL OR ${t.bankAccount} ~ '^[A-Z0-9]{5,34}$'`,
    ),
    check(
      'suppliers_payment_term',
      sql`${t.paymentTermDays} IS NULL OR ${t.paymentTermDays} BETWEEN 0 AND 365`,
    ),
    check('suppliers_note', lengthCheck(t.note, 1000)),
    check('suppliers_status', sql`${t.status} IN ('ACTIVE', 'INACTIVE')`),
  ],
);

export const supplierContacts = pgTable(
  'supplier_contacts',
  {
    id: id(),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    name: text('name'),
    position: text('position'),
    phone: text('phone'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('supplier_contacts_supplier_idx').on(t.supplierId),
    check('supplier_contacts_name', lengthCheck(t.name, 100)),
    check('supplier_contacts_position', lengthCheck(t.position, 60)),
    check('supplier_contacts_phone', phoneCheck(t.phone)),
    check('supplier_contacts_note', lengthCheck(t.note, 300)),
    check('supplier_contacts_someone', sql`${t.name} IS NOT NULL OR ${t.phone} IS NOT NULL`),
  ],
);

/**
 * Which suppliers deliver a product (ADR-0032): one main supplier per product, the first link being
 * the main one. The service serialises changes per product with an advisory lock.
 */
export const productSuppliers = pgTable(
  'product_suppliers',
  {
    id: id(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    isMain: boolean('is_main').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('product_suppliers_pair_key').on(t.productId, t.supplierId),
    uniqueIndex('product_suppliers_one_main')
      .on(t.productId)
      .where(sql`${t.isMain}`),
    index('product_suppliers_supplier_idx').on(t.supplierId, t.id),
  ],
);
