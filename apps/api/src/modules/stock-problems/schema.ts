import {
  STOCK_PROBLEM_OUTCOMES,
  STOCK_PROBLEM_RESOLUTION_KINDS,
  STOCK_PROBLEM_RESOLUTION_STATUSES,
  STOCK_PROBLEM_SHEET_STATUSES,
} from '@tugeel/shared';
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';
import { qty } from '../../common/db/types';
import { products } from '../catalog/schema';
import { users, warehouses } from '../identity/schema';
import { adjustments, goodsIssues, issueExpenseTypes } from '../inventory/schema';
import { customers } from '../partners/schema';

// Tables owned by the stock-problems module (ADR-0230, docs/modules/stock-problems.md). The problem
// events themselves are never copied here: the list reads the tills' open shortfalls and the orders'
// cut lines where they live. These tables keep only the decisions: a warehouse's defaults, what
// took a product off the list, and the morning sheets with their counts. Nothing is deleted
// (DELETE and TRUNCATE are revoked from the app role).

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const at = (name: string) => timestamp(name, { withTimezone: true });

/**
 * A warehouse's fixed party and expense type: each warehouse has its own keeper, so a balance that
 * is zeroed, and a count's shortage, are issued to that warehouse's customer and booked to its type.
 */
export const stockProblemSettings = pgTable('stock_problem_settings', {
  warehouseId: ref('warehouse_id')
    .primaryKey()
    .references(() => warehouses.id),
  customerId: ref('customer_id').references(() => customers.id),
  expenseTypeId: ref('expense_type_id').references(() => issueExpenseTypes.id),
  updatedAt: at('updated_at').notNull().defaultNow(),
  updatedBy: userRef('updated_by'),
});

/**
 * A morning sheet: the problem products of one warehouse on one day, with the system's quantity
 * when it was built. `built_by` is null for the 07:00 job. An approval sends the shortages as one
 * goods issue and the surpluses as one adjustment (their ids are kept here).
 */
export const stockProblemSheets = pgTable(
  'stock_problem_sheets',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    sheetDate: date('sheet_date', { mode: 'string' }).notNull(),
    status: text('status', { enum: STOCK_PROBLEM_SHEET_STATUSES }).notNull().default('OPEN'),
    builtAt: at('built_at').notNull().defaultNow(),
    builtBy: userRef('built_by'),
    approvedAt: at('approved_at'),
    approvedBy: userRef('approved_by'),
    issueId: ref('issue_id').references(() => goodsIssues.id),
    adjustmentId: ref('adjustment_id').references(() => adjustments.id),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('stock_problem_sheets_day').on(t.warehouseId, t.sheetDate),
    index('stock_problem_sheets_status_idx').on(t.status, t.sheetDate),
    check('stock_problem_sheets_status', sql`${t.status} IN ('OPEN', 'APPROVED', 'CLOSED')`),
    check(
      'stock_problem_sheets_approved',
      sql`(${t.status} = 'APPROVED') = (${t.approvedAt} IS NOT NULL) AND (${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL)`,
    ),
  ],
);

/**
 * What took a product off a warehouse's list. Events at or before `covers_until` are answered by a
 * DONE row; a PENDING row waits for its goods issue or adjustment to post, a CANCELLED row for a
 * document that was cancelled instead (the product is back on the list).
 */
export const stockProblemResolutions = pgTable(
  'stock_problem_resolutions',
  {
    id: id(),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    kind: text('kind', { enum: STOCK_PROBLEM_RESOLUTION_KINDS }).notNull(),
    status: text('status', { enum: STOCK_PROBLEM_RESOLUTION_STATUSES }).notNull(),
    /** The decision's moment (a sheet line: when it was counted). */
    coversUntil: at('covers_until').notNull().defaultNow(),
    /** Base units issued (zero-out, a shortage) or adjusted in (a surplus); null otherwise. */
    qtyBase: qty('qty_base'),
    /** The warehouse's on-hand when the decision was made. */
    onHand: qty('on_hand'),
    note: text('note'),
    issueId: ref('issue_id').references(() => goodsIssues.id),
    adjustmentId: ref('adjustment_id').references(() => adjustments.id),
    sheetId: ref('sheet_id').references(() => stockProblemSheets.id),
    /** When the tills' shortfalls this row answers were marked checked in the pos module. */
    posResolvedAt: at('pos_resolved_at'),
    createdAt: at('created_at').notNull().defaultNow(),
    createdBy: userRef('created_by'),
    closedAt: at('closed_at'),
  },
  (t) => [
    index('stock_problem_resolutions_product_idx').on(t.warehouseId, t.productId, t.status),
    index('stock_problem_resolutions_pending_idx')
      .on(t.id)
      .where(sql`${t.status} = 'PENDING'`),
    check('stock_problem_resolutions_kind', sql`${t.kind} IN ('LEGIT', 'ZERO_OUT', 'COUNT')`),
    check('stock_problem_resolutions_status', sql`${t.status} IN ('PENDING', 'DONE', 'CANCELLED')`),
    check(
      'stock_problem_resolutions_closed',
      sql`(${t.status} = 'PENDING') = (${t.closedAt} IS NULL)`,
    ),
    check(
      'stock_problem_resolutions_pending_doc',
      sql`${t.status} <> 'PENDING' OR ${t.issueId} IS NOT NULL OR ${t.adjustmentId} IS NOT NULL`,
    ),
    check('stock_problem_resolutions_qty', sql`${t.qtyBase} IS NULL OR ${t.qtyBase} > 0`),
    check(
      'stock_problem_resolutions_note',
      sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`,
    ),
  ],
);

/**
 * A product on a sheet. `system_qty`, `red_qty` and `cut_qty` are as the sheet was built; the count
 * stores the warehouse's on-hand at the moment it was entered and the difference against it.
 */
export const stockProblemSheetLines = pgTable(
  'stock_problem_sheet_lines',
  {
    id: id(),
    sheetId: ref('sheet_id')
      .notNull()
      .references(() => stockProblemSheets.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    systemQty: qty('system_qty').notNull(),
    redQty: qty('red_qty').notNull(),
    cutQty: qty('cut_qty').notNull(),
    countedQty: qty('counted_qty'),
    onHandAtCount: qty('on_hand_at_count'),
    /** counted − on-hand at the count. */
    difference: qty('difference'),
    countedAt: at('counted_at'),
    countedBy: userRef('counted_by'),
    /** Set by the approval, for the lines it took. */
    outcome: text('outcome', { enum: STOCK_PROBLEM_OUTCOMES }),
    resolutionId: ref('resolution_id').references(() => stockProblemResolutions.id),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('stock_problem_sheet_lines_product').on(t.sheetId, t.productId),
    check(
      'stock_problem_sheet_lines_count',
      sql`(${t.countedQty} IS NULL) = (${t.onHandAtCount} IS NULL) AND (${t.countedQty} IS NULL) = (${t.difference} IS NULL) AND (${t.countedQty} IS NULL) = (${t.countedAt} IS NULL) AND (${t.countedQty} IS NULL OR (${t.countedQty} >= 0 AND ${t.difference} = ${t.countedQty} - ${t.onHandAtCount}))`,
    ),
    check(
      'stock_problem_sheet_lines_outcome',
      sql`${t.outcome} IS NULL OR (${t.outcome} IN ('EQUAL', 'SHORTAGE', 'SURPLUS') AND ${t.countedQty} IS NOT NULL)`,
    ),
  ],
);
