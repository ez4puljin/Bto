import { FINANCE_LIMITS, INVOICE_STATUSES } from '@tugeel/shared/finance';
import { PRICE_BASES } from '@tugeel/shared/pricing';
import { PAYMENT_METHODS } from '@tugeel/shared/sales';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { factor, jsonValue, money, percent, qty } from '../../common/db/types';
import { productUnits, products, VAT_TYPES } from '../catalog/schema';
import { branches, users, warehouses } from '../identity/schema';
import { bins } from '../inventory/schema';
import { customers } from '../partners/schema';
import { salesOrders } from '../sales/schema';

// The tables owned by the finance module (docs/modules/finance.md, ADR-0060). Migration
// 0026_finance adds by hand: the REVOKEs that keep every document from being deleted, the
// append-only guards of the receivables ledger, and the assistant's views. Since F1's ledger
// (ADR-0089, migration 0033) the chart, the money accounts and the journal are the Finance Core's
// (`fin.accounts`, `fin.money_accounts`, `fin.journal_*`); the ids here point there without an FK.

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
/** A number format: as the order format (ADR-0057 #3), never ending in a digit or a token. */
const patternCheck = (column: AnyPgColumn): SQL =>
  sql`length(${column}) BETWEEN 1 AND 24 AND ${column} !~ '[0-9}]$'`;

/** The four number formats (ADR-0060 #8); a single row, the shared defaults until it is saved. */
export const financeSettings = pgTable(
  'finance_settings',
  {
    id: smallint('id').primaryKey(),
    invoicePattern: text('invoice_pattern').notNull(),
    invoiceDigits: smallint('invoice_digits').notNull(),
    creditNotePattern: text('credit_note_pattern').notNull(),
    creditNoteDigits: smallint('credit_note_digits').notNull(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('finance_settings_single', sql`${t.id} = 1`),
    check('finance_settings_invoice', patternCheck(t.invoicePattern)),
    check('finance_settings_credit_note', patternCheck(t.creditNotePattern)),
    check(
      'finance_settings_digits',
      sql`${t.invoiceDigits} BETWEEN 1 AND 8 AND ${t.creditNoteDigits} BETWEEN 1 AND 8`,
    ),
  ],
);

/**
 * An invoice (ADR-0060 #3): one per sold order, the delivered quantities at the frozen prices,
 * the tax split per line, its open amount kept by the allocations. Immutable; voided by a
 * reversing entry while nothing is allocated to it.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    number: text('number').notNull(),
    status: text('status', { enum: INVOICE_STATUSES }).notNull().default('ISSUED'),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    orderId: ref('order_id').references(() => salesOrders.id),
    orderNumber: text('order_number'),
    branchId: ref('branch_id').references(() => branches.id),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    paymentMethod: text('payment_method', { enum: PAYMENT_METHODS }).notNull(),
    subtotal: money('subtotal').notNull(),
    discountTotal: money('discount_total').notNull(),
    total: money('total').notNull(),
    vatTotal: money('vat_total').notNull(),
    cityTaxTotal: money('city_tax_total').notNull(),
    openAmount: money('open_amount').notNull(),
    note: text('note'),
    /** The core's journal entry (`fin.journal_entries`, ADR-0089): a plain id, no FK leaves `fin`. */
    journalEntryId: ref('journal_entry_id'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: userRef('voided_by'),
    voidReason: text('void_reason'),
    voidJournalEntryId: ref('void_journal_entry_id'),
  },
  (t) => [
    uniqueIndex('invoices_number').on(t.number),
    uniqueIndex('invoices_order').on(t.orderId),
    index('invoices_customer_idx').on(t.customerId, t.dueDate),
    index('invoices_date_idx').on(t.invoiceDate, t.id),
    index('invoices_open_idx')
      .on(t.customerId, t.dueDate)
      .where(sql`${t.status} = 'ISSUED' AND ${t.openAmount} > 0`),
    check('invoices_status', inList(t.status, INVOICE_STATUSES)),
    check('invoices_payment_method', inList(t.paymentMethod, PAYMENT_METHODS)),
    check(
      'invoices_totals',
      sql`${t.total} = ${t.subtotal} - ${t.discountTotal} AND ${t.total} >= 0 AND ${t.vatTotal} >= 0 AND ${t.cityTaxTotal} >= 0`,
    ),
    check('invoices_open', sql`${t.openAmount} >= 0 AND ${t.openAmount} <= ${t.total}`),
    check('invoices_due', sql`${t.dueDate} >= ${t.invoiceDate}`),
    check(
      'invoices_void',
      sql`(${t.status} = 'VOID') = (${t.voidedAt} IS NOT NULL) AND (${t.voidedAt} IS NULL) = (${t.voidReason} IS NULL)`,
    ),
    check(
      'invoices_void_reason',
      sql`${t.voidReason} IS NULL OR length(${t.voidReason}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxReason)}`,
    ),
  ],
);

/** A line per priced part of a delivered line, with its tax split (ADR-0010 #4). */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    invoiceId: ref('invoice_id')
      .notNull()
      .references(() => invoices.id),
    lineNo: smallint('line_no').notNull(),
    orderLineId: ref('order_line_id'),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    productSku: text('product_sku').notNull(),
    productName: text('product_name').notNull(),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    uomName: text('uom_name').notNull(),
    basis: text('basis', { enum: PRICE_BASES }).notNull(),
    qty: qty('qty').notNull(),
    factorSnapshot: factor('factor_snapshot').notNull(),
    qtyBase: qty('qty_base').notNull(),
    warehouseId: ref('warehouse_id').references(() => warehouses.id),
    listPrice: money('list_price').notNull(),
    unitPrice: money('unit_price').notNull(),
    subtotal: money('subtotal').notNull(),
    discountAmount: money('discount_amount').notNull(),
    total: money('total').notNull(),
    vatType: text('vat_type', { enum: VAT_TYPES }).notNull(),
    vatRatePct: percent('vat_rate_pct').notNull(),
    cityTaxRatePct: percent('city_tax_rate_pct').notNull(),
    vatAmount: money('vat_amount').notNull(),
    cityTaxAmount: money('city_tax_amount').notNull(),
    /** Base units taken back by credit notes so far. */
    returnedBase: qty('returned_base')
      .notNull()
      .default(sql`0`),
  },
  (t) => [
    uniqueIndex('invoice_lines_invoice_line').on(t.invoiceId, t.lineNo),
    index('invoice_lines_product_idx').on(t.productId),
    check('invoice_lines_basis', inList(t.basis, PRICE_BASES)),
    check('invoice_lines_vat_type', inList(t.vatType, VAT_TYPES)),
    check(
      'invoice_lines_qty',
      sql`${t.qty} > 0 AND ${t.factorSnapshot} > 0 AND ${t.qtyBase} > 0 AND ${t.returnedBase} >= 0 AND ${t.returnedBase} <= ${t.qtyBase}`,
    ),
    check(
      'invoice_lines_money',
      sql`${t.total} = ${t.subtotal} - ${t.discountAmount} AND ${t.unitPrice} >= 0 AND ${t.vatAmount} >= 0 AND ${t.cityTaxAmount} >= 0`,
    ),
  ],
);

/** A credit note (ADR-0060 #6): goods of an invoice taken back, the receivable reduced. */
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: id(),
    number: text('number').notNull(),
    invoiceId: ref('invoice_id')
      .notNull()
      .references(() => invoices.id),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    noteDate: date('note_date').notNull(),
    reason: text('reason').notNull(),
    warehouseId: ref('warehouse_id').references(() => warehouses.id),
    binId: ref('bin_id').references(() => bins.id),
    subtotal: money('subtotal').notNull(),
    discountTotal: money('discount_total').notNull(),
    total: money('total').notNull(),
    vatTotal: money('vat_total').notNull(),
    cityTaxTotal: money('city_tax_total').notNull(),
    journalEntryId: ref('journal_entry_id'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('credit_notes_number').on(t.number),
    index('credit_notes_invoice_idx').on(t.invoiceId),
    index('credit_notes_customer_idx').on(t.customerId, t.id),
    check(
      'credit_notes_reason',
      sql`length(${t.reason}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxReason)}`,
    ),
    check(
      'credit_notes_totals',
      sql`${t.total} = ${t.subtotal} - ${t.discountTotal} AND ${t.total} > 0`,
    ),
    check('credit_notes_restock', sql`(${t.warehouseId} IS NULL) = (${t.binId} IS NULL)`),
  ],
);

export const creditNoteLines = pgTable(
  'credit_note_lines',
  {
    id: id(),
    creditNoteId: ref('credit_note_id')
      .notNull()
      .references(() => creditNotes.id),
    lineNo: smallint('line_no').notNull(),
    invoiceLineId: ref('invoice_line_id')
      .notNull()
      .references(() => invoiceLines.id),
    productId: ref('product_id')
      .notNull()
      .references(() => products.id),
    productUnitId: ref('product_unit_id')
      .notNull()
      .references(() => productUnits.id),
    uomName: text('uom_name').notNull(),
    qty: qty('qty').notNull(),
    factorSnapshot: factor('factor_snapshot').notNull(),
    qtyBase: qty('qty_base').notNull(),
    unitPrice: money('unit_price').notNull(),
    subtotal: money('subtotal').notNull(),
    discountAmount: money('discount_amount').notNull(),
    total: money('total').notNull(),
    vatAmount: money('vat_amount').notNull(),
    cityTaxAmount: money('city_tax_amount').notNull(),
  },
  (t) => [
    uniqueIndex('credit_note_lines_note_line').on(t.creditNoteId, t.lineNo),
    check(
      'credit_note_lines_qty',
      sql`${t.qty} > 0 AND ${t.factorSnapshot} > 0 AND ${t.qtyBase} > 0`,
    ),
    check('credit_note_lines_money', sql`${t.total} = ${t.subtotal} - ${t.discountAmount}`),
  ],
);

/** One run of the ledger-against-cache check (nightly or by hand), like the stock reconciliation. */
export const financeReconcileRuns = pgTable(
  'finance_reconcile_runs',
  {
    id: id(),
    kind: text('kind', { enum: ['NIGHTLY', 'MANUAL'] }).notNull(),
    status: text('status', { enum: ['OK', 'DRIFT'] }).notNull(),
    checked: integer('checked').notNull(),
    drifted: integer('drifted').notNull(),
    details: jsonValue('details')
      .notNull()
      .default(sql`'[]'::jsonb`),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('finance_reconcile_runs_kind', sql`${t.kind} IN ('NIGHTLY', 'MANUAL')`),
    check('finance_reconcile_runs_status', sql`${t.status} IN ('OK', 'DRIFT')`),
  ],
);
