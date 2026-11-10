import {
  BANK_EXPORT_TYPES,
  BANK_LINE_ACTIONS,
  BANK_LINE_KINDS,
  COLLECTION_METHODS,
  COLLECTION_STATUSES,
  FINANCE_LIMITS,
  INVOICE_STATUSES,
} from '@tugeel/shared/finance';
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
import { branches, files, users, warehouses } from '../identity/schema';
import { bins } from '../inventory/schema';
import { customers, suppliers } from '../partners/schema';
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

/**
 * «Банкны хуулга хаах» (ADR-0169): one uploaded bank statement, its account as the bank wrote it. The money
 * account is worked out from the number; `money_account_id` holds the accountant's own link when the
 * number could not be recognised. Deleted (with its lines) only while nothing of it is in the books.
 */
export const bankStatements = pgTable(
  'bank_statements',
  {
    id: id(),
    accountNumber: text('account_number').notNull(),
    currency: text('currency').notNull(),
    statementDate: date('statement_date', { mode: 'string' }).notNull(),
    dateTo: date('date_to', { mode: 'string' }).notNull(),
    fileName: text('file_name').notNull(),
    fileId: ref('file_id').references(() => files.id),
    moneyAccountId: ref('money_account_id'),
    uploadedBy: userRef('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('bank_statements_account', sql`length(${t.accountNumber}) BETWEEN 1 AND 40`),
    check('bank_statements_dates', sql`${t.dateTo} >= ${t.statementDate}`),
    index('bank_statements_date_idx').on(t.statementDate),
    index('bank_statements_account_idx').on(t.accountNumber),
  ],
);

/**
 * A statement's line: what the bank wrote, what the accountant adds, and the document it became.
 * `dedupe_key` makes a re-upload of the same lines harmless. Exactly one of debit and credit is
 * positive: debit is money out of the account, credit money in. A posted line has its document
 * (`payment_id` for a customer's voucher, `journal_entry_id` for an entry), and `post_attempt`
 * gives each posting after a reversal a source key of its own in the Finance Core.
 */
export const bankStatementLines = pgTable(
  'bank_statement_lines',
  {
    id: id(),
    statementId: ref('statement_id')
      .notNull()
      .references(() => bankStatements.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    txnAt: timestamp('txn_at', { withTimezone: true }).notNull(),
    businessDate: date('business_date', { mode: 'string' }).notNull(),
    debit: money('debit').notNull(),
    credit: money('credit').notNull(),
    bankDescription: text('bank_description').notNull(),
    bankCounterpart: text('bank_counterpart').notNull(),
    kind: text('kind', { enum: BANK_LINE_KINDS }).notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    customerId: ref('customer_id').references(() => customers.id),
    supplierId: ref('supplier_id').references(() => suppliers.id),
    counterAccountId: ref('counter_account_id'),
    description: text('description').notNull(),
    action: text('action', { enum: BANK_LINE_ACTIONS }),
    exportType: text('export_type', { enum: BANK_EXPORT_TYPES }),
    paymentId: ref('payment_id'),
    journalEntryId: ref('journal_entry_id'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: userRef('posted_by'),
    postAttempt: integer('post_attempt').notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('bank_statement_lines_dedupe_uq').on(t.dedupeKey),
    uniqueIndex('bank_statement_lines_no_uq').on(t.statementId, t.lineNo),
    index('bank_statement_lines_counterpart_idx').on(t.bankCounterpart, t.id),
    index('bank_statement_lines_date_idx').on(t.businessDate),
    check('bank_statement_lines_kind', inList(t.kind, BANK_LINE_KINDS)),
    check(
      'bank_statement_lines_action',
      sql`${t.action} IS NULL OR ${inList(t.action, BANK_LINE_ACTIONS)}`,
    ),
    check(
      'bank_statement_lines_export',
      sql`${t.exportType} IS NULL OR ${inList(t.exportType, BANK_EXPORT_TYPES)}`,
    ),
    check(
      'bank_statement_lines_side',
      sql`(${t.debit} > 0 AND ${t.credit} = 0) OR (${t.credit} > 0 AND ${t.debit} = 0)`,
    ),
    check(
      'bank_statement_lines_one_party',
      sql`${t.customerId} IS NULL OR ${t.supplierId} IS NULL`,
    ),
    check(
      'bank_statement_lines_posted',
      sql`(${t.postedAt} IS NULL) = (${t.postedBy} IS NULL) AND (${t.postedAt} IS NULL OR ${t.paymentId} IS NOT NULL OR ${t.journalEntryId} IS NOT NULL)`,
    ),
  ],
);

/**
 * «Банкны хуулга хаах»'s rules, one row, absent until saved (ADR-0169 #5): what a card settlement and a bank
 * fee are filled with, the accounts offered first, and the Erkhet party code of a line without a party.
 */
export const bankStatementSettings = pgTable(
  'bank_statement_settings',
  {
    id: smallint('id').primaryKey(),
    settlementAccountId: ref('settlement_account_id'),
    settlementDescription: text('settlement_description').notNull(),
    settlementAction: text('settlement_action', { enum: BANK_LINE_ACTIONS }).notNull(),
    feeAccountId: ref('fee_account_id'),
    feeDescription: text('fee_description').notNull(),
    feeAction: text('fee_action', { enum: BANK_LINE_ACTIONS }).notNull(),
    feeExportType: text('fee_export_type', { enum: BANK_EXPORT_TYPES }).notNull(),
    partyCode: text('party_code').notNull(),
    counterAccountIds: bigint('counter_account_ids', { mode: 'number' })
      .array()
      .notNull()
      .default(sql`'{}'::bigint[]`),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [check('bank_statement_settings_single', sql`${t.id} = 1`)],
);

/**
 * Money a rep says a store handed over (ADR-0183). A report changes nothing in the books; the
 * accountant records it as a customer payment voucher (`payment_id`, the Finance Core's document,
 * no FK) or refuses it with `decision_note`. Never changed after the decision, never removed.
 */
export const repCollections = pgTable(
  'rep_collections',
  {
    id: id(),
    userId: userRef('user_id').notNull(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    amount: money('amount').notNull(),
    method: text('method', { enum: COLLECTION_METHODS }).notNull(),
    note: text('note'),
    /** The Ulaanbaatar business date the rep reported it. */
    collectedOn: date('collected_on', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
    status: text('status', { enum: COLLECTION_STATUSES }).notNull().default('PENDING'),
    paymentId: ref('payment_id'),
    paymentNumber: text('payment_number'),
    decidedBy: userRef('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
  },
  (t) => [
    index('rep_collections_status_idx').on(t.status, t.id),
    index('rep_collections_user_idx').on(t.userId, t.id),
    index('rep_collections_customer_idx').on(t.customerId, t.id),
    uniqueIndex('rep_collections_payment_key')
      .on(t.paymentId)
      .where(sql`${t.paymentId} IS NOT NULL`),
    check('rep_collections_amount', sql`${t.amount} > 0`),
    check('rep_collections_method', inList(t.method, COLLECTION_METHODS)),
    check('rep_collections_status', inList(t.status, COLLECTION_STATUSES)),
    check(
      'rep_collections_decided',
      sql`(${t.status} = 'PENDING') = (${t.decidedBy} IS NULL)
        AND (${t.decidedBy} IS NULL) = (${t.decidedAt} IS NULL)
        AND (${t.status} = 'RECORDED') = (${t.paymentId} IS NOT NULL)
        AND (${t.paymentId} IS NULL) = (${t.paymentNumber} IS NULL)
        AND (${t.status} = 'REJECTED') = (${t.decisionNote} IS NOT NULL)`,
    ),
  ],
);

/**
 * The accountant's own place for an account on the statements СТ-1 and СТ-2 (ADR-0184): the row's
 * code of the shared template. An account without a row here lands by its code's prefix. The
 * account is the Finance Core's (`fin.accounts.id`, no FK); a setting, so a row may be removed.
 */
export const statementRowLinks = pgTable(
  'statement_row_links',
  {
    accountId: bigint('account_id', { mode: 'number' }).primaryKey(),
    rowCode: text('row_code').notNull(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [check('statement_row_links_row', sql`length(${t.rowCode}) BETWEEN 1 AND 16`)],
);
