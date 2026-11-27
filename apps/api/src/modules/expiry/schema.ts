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
import { jsonValue, money, qty } from '../../common/db/types';
import { products, productUnits } from '../catalog/schema';
import { roles, users, warehouses } from '../identity/schema';
import { goodsReceiptLines } from '../inventory/schema';

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

/** Explicit provenance; unknown historic records have no row. */
export const expiryItemSources = pgTable(
  'expiry_item_sources',
  {
    itemId: ref('item_id')
      .primaryKey()
      .references(() => expiryItems.id),
    receiptLineId: ref('receipt_line_id')
      .notNull()
      .references(() => goodsReceiptLines.id),
    qtyBase: qty('qty_base').notNull(),
    version: integer('version').notNull().default(1),
    updatedAt: at('updated_at').notNull().defaultNow(),
    updatedBy: userRef('updated_by'),
  },
  (t) => [
    check('expiry_item_sources_qty', sql`${t.qtyBase} > 0 AND ${t.qtyBase} <> 'NaN'::numeric`),
    check('expiry_item_sources_version', sql`${t.version} > 0`),
  ],
);

/** Immutable approval. Every new barcode freezes cost, source, liable IDs and pay month. */
export const expiryMarkdowns = pgTable(
  'expiry_markdowns',
  {
    id: id(),
    itemId: ref('item_id')
      .notNull()
      .references(() => expiryItems.id),
    revision: integer('revision').notNull(),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    expiryDate: date('expiry_date', { mode: 'string' }).notNull(),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    receiptLineId: ref('receipt_line_id')
      .notNull()
      .references(() => goodsReceiptLines.id),
    costingVersion: integer('costing_version').notNull(),
    /** Store the exact ratio; do not round a unit cost before sold quantity is known. */
    receiptQtyBase: qty('receipt_qty_base').notNull(),
    accountingAmount: money('accounting_amount').notNull(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    channel: text('channel', { enum: ['RETAIL', 'WHOLESALE'] }).notNull(),
    contextId: ref('context_id').notNull(),
    qtyBudget: qty('qty_budget').notNull(),
    unitPrice: money('unit_price').notNull(),
    payrollMonth: text('payroll_month'),
    liableUsers: jsonValue('liable_users').notNull(),
    startsAt: at('starts_at').notNull().defaultNow(),
    createdBy: userRef('created_by'),
  },
  (t) => [
    uniqueIndex('expiry_markdowns_revision_key').on(t.itemId, t.revision),
    index('expiry_markdowns_receipt_idx').on(t.receiptLineId),
    check(
      'expiry_markdowns_positive',
      sql`${t.revision} > 0 AND ${t.costingVersion} > 0 AND ${t.contextId} > 0 AND ${t.qtyBudget} > 0 AND ${t.receiptQtyBase} > 0 AND ${t.unitPrice} > 0 AND ${t.accountingAmount} >= 0 AND ${t.qtyBudget} <> 'NaN'::numeric AND ${t.receiptQtyBase} <> 'NaN'::numeric AND ${t.unitPrice} <> 'NaN'::numeric AND ${t.accountingAmount} <> 'NaN'::numeric`,
    ),
    check('expiry_markdowns_channel', sql`${t.channel} IN ('RETAIL','WHOLESALE')`),
    check(
      'expiry_markdowns_month',
      sql`${t.payrollMonth} IS NULL OR ${t.payrollMonth} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check('expiry_markdowns_users', sql`jsonb_typeof(${t.liableUsers}) = 'array'`),
  ],
);
export const expiryMarkdownStops = pgTable('expiry_markdown_stops', {
  markdownId: ref('markdown_id')
    .primaryKey()
    .references(() => expiryMarkdowns.id),
  stoppedAt: at('stopped_at').notNull().defaultNow(),
  stoppedBy: userRef('stopped_by'),
});
export const expiryMarkdownBalances = pgTable(
  'expiry_markdown_balances',
  {
    markdownId: ref('markdown_id')
      .primaryKey()
      .references(() => expiryMarkdowns.id),
    qtySold: qty('qty_sold').notNull().default(zero),
  },
  (t) => [
    check(
      'expiry_markdown_balances_qty',
      sql`${t.qtySold} >= 0 AND ${t.qtySold} <> 'NaN'::numeric`,
    ),
  ],
);
export const expirySaleAllocations = pgTable(
  'expiry_sale_allocations',
  {
    id: id(),
    markdownId: ref('markdown_id')
      .notNull()
      .references(() => expiryMarkdowns.id),
    sourceKind: text('source_kind', { enum: ['POS', 'WHOLESALE'] }).notNull(),
    saleId: text('sale_id').notNull(),
    lineId: text('line_id').notNull(),
    sourceKey: text('source_key').notNull(),
    qtyBase: qty('qty_base').notNull(),
    costAmount: money('cost_amount').notNull(),
    revenueAmount: money('revenue_amount').notNull(),
    lossAmount: money('loss_amount').notNull(),
    shares: jsonValue('shares').notNull(),
    soldAt: at('sold_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    input: jsonValue('input').notNull(),
  },
  (t) => [
    uniqueIndex('expiry_sale_allocations_source_key').on(t.sourceKey),
    uniqueIndex('expiry_sale_allocations_line_key').on(t.sourceKind, t.saleId, t.lineId),
    check('expiry_sale_allocations_kind', sql`${t.sourceKind} IN ('POS','WHOLESALE')`),
    check(
      'expiry_sale_allocations_values',
      sql`${t.qtyBase} > 0 AND ${t.costAmount} >= 0 AND ${t.revenueAmount} >= 0 AND ${t.lossAmount} >= 0 AND ${t.qtyBase} <> 'NaN'::numeric AND ${t.costAmount} <> 'NaN'::numeric AND ${t.revenueAmount} <> 'NaN'::numeric AND ${t.lossAmount} <> 'NaN'::numeric`,
    ),
  ],
);
export const expiryReturnAllocations = pgTable(
  'expiry_return_allocations',
  {
    id: id(),
    saleAllocationId: ref('sale_allocation_id')
      .notNull()
      .references(() => expirySaleAllocations.id),
    sourceKey: text('source_key').notNull(),
    qtyBase: qty('qty_base').notNull(),
    lossAmount: money('loss_amount').notNull(),
    shares: jsonValue('shares').notNull(),
    returnedAt: at('returned_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('expiry_return_allocations_source_key').on(t.sourceKey),
    check(
      'expiry_return_allocations_values',
      sql`${t.qtyBase} > 0 AND ${t.lossAmount} >= 0 AND ${t.qtyBase} <> 'NaN'::numeric AND ${t.lossAmount} <> 'NaN'::numeric`,
    ),
  ],
);

/** Offline facts survive a refused allocation; replay never silently creates a new charge. */
export const expirySaleExceptions = pgTable(
  'expiry_sale_exceptions',
  {
    id: id(),
    markdownId: ref('markdown_id')
      .notNull()
      .references(() => expiryMarkdowns.id),
    sourceKind: text('source_kind', { enum: ['POS', 'WHOLESALE'] }).notNull(),
    saleId: text('sale_id').notNull(),
    lineId: text('line_id').notNull(),
    reason: text('reason').notNull(),
    input: jsonValue('input').notNull(),
    qtyBase: qty('qty_base').notNull(),
    soldAt: at('sold_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    resolvedAt: at('resolved_at'),
    resolvedBy: userRef('resolved_by'),
    resolutionNote: text('resolution_note'),
  },
  (t) => [
    uniqueIndex('expiry_sale_exceptions_line_key').on(t.sourceKind, t.saleId, t.lineId),
    check('expiry_sale_exceptions_kind', sql`${t.sourceKind} IN ('POS','WHOLESALE')`),
    check(
      'expiry_sale_exceptions_resolution',
      sql`(${t.resolvedAt} IS NULL) = (${t.resolutionNote} IS NULL)`,
    ),
    check('expiry_sale_exceptions_qty', sql`${t.qtyBase} > 0 AND ${t.qtyBase} <> 'NaN'::numeric`),
  ],
);

/** Durable POS diagnostics also exist when expiry provenance cannot be found. */
export const expiryPosExceptions = pgTable(
  'expiry_pos_exceptions',
  {
    id: id(),
    operation: text('operation', { enum: ['SALE', 'RETURN'] }).notNull(),
    documentId: text('document_id').notNull(),
    lineId: text('line_id').notNull(),
    originalSaleId: text('original_sale_id'),
    originalLineId: text('original_line_id'),
    barcode: text('barcode').notNull(),
    productId: ref('product_id').notNull(),
    productUnitId: ref('product_unit_id').notNull(),
    warehouseId: ref('warehouse_id').notNull(),
    contextId: ref('context_id').notNull(),
    code: text('code').notNull(),
    qtyBase: qty('qty_base').notNull(),
    occurredAt: at('occurred_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    acknowledgedAt: at('acknowledged_at'),
    acknowledgedBy: userRef('acknowledged_by'),
    acknowledgementNote: text('acknowledgement_note'),
  },
  (t) => [
    uniqueIndex('expiry_pos_exceptions_line_key').on(t.operation, t.documentId, t.lineId),
    index('expiry_pos_exceptions_created_idx').on(t.createdAt, t.id),
    check('expiry_pos_exceptions_operation', sql`${t.operation} IN ('SALE','RETURN')`),
    check(
      'expiry_pos_exceptions_source',
      sql`(${t.operation} = 'SALE' AND ${t.originalSaleId} IS NULL AND ${t.originalLineId} IS NULL) OR (${t.operation} = 'RETURN' AND ${t.originalSaleId} IS NOT NULL AND ${t.originalLineId} IS NOT NULL AND length(${t.originalSaleId}) BETWEEN 1 AND 160 AND length(${t.originalLineId}) BETWEEN 1 AND 160)`,
    ),
    check(
      'expiry_pos_exceptions_facts',
      sql`length(${t.documentId}) BETWEEN 1 AND 160 AND length(${t.lineId}) BETWEEN 1 AND 160 AND length(${t.barcode}) BETWEEN 1 AND 200 AND ${t.code} ~ '^[A-Z][A-Z0-9_]{0,99}$' AND ${t.productId} > 0 AND ${t.productUnitId} > 0 AND ${t.warehouseId} > 0 AND ${t.contextId} > 0 AND ${t.qtyBase} > 0 AND ${t.qtyBase} <> 'NaN'::numeric`,
    ),
    check(
      'expiry_pos_exceptions_acknowledgement',
      sql`(${t.acknowledgedAt} IS NULL AND ${t.acknowledgedBy} IS NULL AND ${t.acknowledgementNote} IS NULL) OR (${t.acknowledgedAt} IS NOT NULL AND ${t.acknowledgedBy} IS NOT NULL AND ${t.acknowledgementNote} IS NOT NULL AND length(btrim(${t.acknowledgementNote})) BETWEEN 1 AND 500)`,
    ),
  ],
);
