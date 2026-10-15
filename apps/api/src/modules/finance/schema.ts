import {
  ALLOCATION_SOURCES,
  AR_ENTRY_KINDS,
  FINANCE_LIMITS,
  GL_ACCOUNT_KINDS,
  GL_ROLES,
  INVOICE_STATUSES,
  JOURNAL_SOURCES,
  MONEY_ACCOUNT_KINDS,
  PAYMENT_DIRECTIONS,
  PAYMENT_KINDS,
  PAYMENT_STATUSES,
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
import { branches, users, warehouses } from '../identity/schema';
import { bins } from '../inventory/schema';
import { customers } from '../partners/schema';
import { salesOrders } from '../sales/schema';

// The tables owned by the finance module (docs/modules/finance.md, ADR-0060). Migration
// 0026_finance adds by hand: the REVOKEs that keep every document from being deleted, the
// append-only guards of the receivables ledger and the journal lines, the deferred trigger that
// refuses an unbalanced journal entry, the seeded chart of accounts, and the assistant's views.

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
const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const DOC_TYPES = ['INVOICE', 'PAYMENT', 'CREDIT_NOTE', 'JOURNAL'] as const;
/** A number format: as the order format (ADR-0057 #3), never ending in a digit or a token. */
const patternCheck = (column: AnyPgColumn): SQL =>
  sql`length(${column}) BETWEEN 1 AND 24 AND ${column} !~ '[0-9}]$'`;

/**
 * The chart of accounts (ADR-0060 #7): a code in Erkhet's style, a kind, and at most one role an
 * automatic entry looks the account up by.
 */
export const glAccounts = pgTable(
  'gl_accounts',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: GL_ACCOUNT_KINDS }).notNull(),
    role: text('role', { enum: GL_ROLES }),
    status: text('status', { enum: STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('gl_accounts_code').on(t.code),
    uniqueIndex('gl_accounts_role').on(t.role),
    check('gl_accounts_code_shape', sql`${t.code} ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$'`),
    check('gl_accounts_name', sql`length(${t.name}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxName)}`),
    check('gl_accounts_kind', inList(t.kind, GL_ACCOUNT_KINDS)),
    check('gl_accounts_role_value', sql`${t.role} IS NULL OR ${inList(t.role, GL_ROLES)}`),
    check('gl_accounts_status', inList(t.status, STATUSES)),
  ],
);

/** A cash box or a bank account (ADR-0060 #5), on a branch, mapped to a journal account. */
export const moneyAccounts = pgTable(
  'money_accounts',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind', { enum: MONEY_ACCOUNT_KINDS }).notNull(),
    branchId: ref('branch_id').references(() => branches.id),
    bankName: text('bank_name'),
    bankAccountNo: text('bank_account_no'),
    glAccountId: ref('gl_account_id')
      .notNull()
      .references(() => glAccounts.id),
    status: text('status', { enum: STATUSES }).notNull().default('ACTIVE'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('money_accounts_code').on(t.code),
    check('money_accounts_code_shape', sql`${t.code} ~ '^[0-9A-Za-z][0-9A-Za-z._-]{0,15}$'`),
    check(
      'money_accounts_name',
      sql`length(${t.name}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxName)}`,
    ),
    check('money_accounts_kind', inList(t.kind, MONEY_ACCOUNT_KINDS)),
    check('money_accounts_status', inList(t.status, STATUSES)),
    check(
      'money_accounts_bank',
      sql`(${t.bankName} IS NULL OR length(${t.bankName}) BETWEEN 1 AND 120) AND (${t.bankAccountNo} IS NULL OR length(${t.bankAccountNo}) BETWEEN 1 AND 40)`,
    ),
  ],
);

/** The four number formats (ADR-0060 #8); a single row, the shared defaults until it is saved. */
export const financeSettings = pgTable(
  'finance_settings',
  {
    id: smallint('id').primaryKey(),
    invoicePattern: text('invoice_pattern').notNull(),
    invoiceDigits: smallint('invoice_digits').notNull(),
    paymentPattern: text('payment_pattern').notNull(),
    paymentDigits: smallint('payment_digits').notNull(),
    creditNotePattern: text('credit_note_pattern').notNull(),
    creditNoteDigits: smallint('credit_note_digits').notNull(),
    journalPattern: text('journal_pattern').notNull(),
    journalDigits: smallint('journal_digits').notNull(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('finance_settings_single', sql`${t.id} = 1`),
    check('finance_settings_invoice', patternCheck(t.invoicePattern)),
    check('finance_settings_payment', patternCheck(t.paymentPattern)),
    check('finance_settings_credit_note', patternCheck(t.creditNotePattern)),
    check('finance_settings_journal', patternCheck(t.journalPattern)),
    check(
      'finance_settings_digits',
      sql`${t.invoiceDigits} BETWEEN 1 AND 8 AND ${t.paymentDigits} BETWEEN 1 AND 8 AND ${t.creditNoteDigits} BETWEEN 1 AND 8 AND ${t.journalDigits} BETWEEN 1 AND 8`,
    ),
  ],
);

/**
 * A journal entry (ADR-0060 #7): numbered, dated, from a document or typed; never changed, only
 * reversed by another entry that names it.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    number: text('number').notNull(),
    entryDate: date('entry_date').notNull(),
    description: text('description').notNull(),
    source: text('source', { enum: JOURNAL_SOURCES }).notNull(),
    sourceType: text('source_type', { enum: DOC_TYPES }),
    sourceId: ref('source_id'),
    reversesId: ref('reverses_id').references((): AnyPgColumn => journalEntries.id),
    postedBy: userRef('posted_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_number').on(t.number),
    index('journal_entries_date_idx').on(t.entryDate, t.id),
    index('journal_entries_source_idx').on(t.sourceType, t.sourceId),
    check(
      'journal_entries_description',
      sql`length(${t.description}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxDescription)}`,
    ),
    check('journal_entries_source', inList(t.source, JOURNAL_SOURCES)),
    check(
      'journal_entries_source_doc',
      sql`(${t.sourceType} IS NULL) = (${t.sourceId} IS NULL) AND (${t.sourceType} IS NULL OR ${inList(t.sourceType, DOC_TYPES)})`,
    ),
  ],
);

/** One side of an entry; the trigger of 0026 keeps Σ debit = Σ credit per entry at commit. */
export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    entryId: ref('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    lineNo: smallint('line_no').notNull(),
    accountId: ref('account_id')
      .notNull()
      .references(() => glAccounts.id),
    debit: money('debit')
      .notNull()
      .default(sql`0`),
    credit: money('credit')
      .notNull()
      .default(sql`0`),
    customerId: ref('customer_id').references(() => customers.id),
    moneyAccountId: ref('money_account_id').references(() => moneyAccounts.id),
    description: text('description'),
  },
  (t) => [
    uniqueIndex('journal_lines_entry_line').on(t.entryId, t.lineNo),
    index('journal_lines_account_idx').on(t.accountId, t.id),
    index('journal_lines_customer_idx').on(t.customerId, t.id),
    check(
      'journal_lines_amounts',
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0) AND (${t.debit} <> 0 OR ${t.credit} <> 0)`,
    ),
    check(
      'journal_lines_description',
      sql`${t.description} IS NULL OR length(${t.description}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxDescription)}`,
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
    journalEntryId: ref('journal_entry_id').references(() => journalEntries.id),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: userRef('voided_by'),
    voidReason: text('void_reason'),
    voidJournalEntryId: ref('void_journal_entry_id').references(() => journalEntries.id),
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
    journalEntryId: ref('journal_entry_id').references(() => journalEntries.id),
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

/**
 * A voucher of the cash or bank book (ADR-0060 #5): money in or out of a money account; from or
 * to a customer, or against a journal account. Immutable; voided by a reversing entry.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    number: text('number').notNull(),
    status: text('status', { enum: PAYMENT_STATUSES }).notNull().default('POSTED'),
    kind: text('kind', { enum: PAYMENT_KINDS }).notNull(),
    direction: text('direction', { enum: PAYMENT_DIRECTIONS }).notNull(),
    moneyAccountId: ref('money_account_id')
      .notNull()
      .references(() => moneyAccounts.id),
    customerId: ref('customer_id').references(() => customers.id),
    glAccountId: ref('gl_account_id').references(() => glAccounts.id),
    amount: money('amount').notNull(),
    paidOn: date('paid_on').notNull(),
    description: text('description'),
    reference: text('reference'),
    counterpartyName: text('counterparty_name'),
    collectedBy: userRef('collected_by'),
    journalEntryId: ref('journal_entry_id').references(() => journalEntries.id),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: userRef('voided_by'),
    voidReason: text('void_reason'),
    voidJournalEntryId: ref('void_journal_entry_id').references(() => journalEntries.id),
  },
  (t) => [
    uniqueIndex('payments_number').on(t.number),
    index('payments_account_idx').on(t.moneyAccountId, t.paidOn, t.id),
    index('payments_customer_idx').on(t.customerId, t.id),
    check('payments_status', inList(t.status, PAYMENT_STATUSES)),
    check('payments_kind', inList(t.kind, PAYMENT_KINDS)),
    check('payments_direction', inList(t.direction, PAYMENT_DIRECTIONS)),
    check('payments_amount', sql`${t.amount} > 0`),
    check(
      'payments_party',
      sql`CASE ${t.kind} WHEN 'CUSTOMER_PAYMENT' THEN ${t.customerId} IS NOT NULL AND ${t.glAccountId} IS NULL WHEN 'CUSTOMER_REFUND' THEN ${t.customerId} IS NOT NULL AND ${t.glAccountId} IS NULL ELSE ${t.customerId} IS NULL AND ${t.glAccountId} IS NOT NULL END`,
    ),
    check(
      'payments_texts',
      sql`(${t.description} IS NULL OR length(${t.description}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxDescription)}) AND (${t.reference} IS NULL OR length(${t.reference}) BETWEEN 1 AND ${lim(FINANCE_LIMITS.maxReference)}) AND (${t.counterpartyName} IS NULL OR length(${t.counterpartyName}) BETWEEN 1 AND 120)`,
    ),
    check(
      'payments_void',
      sql`(${t.status} = 'VOID') = (${t.voidedAt} IS NOT NULL) AND (${t.voidedAt} IS NULL) = (${t.voidReason} IS NULL)`,
    ),
  ],
);

/** What a payment or a credit note settles of an invoice; undone (voided) with its source. */
export const allocations = pgTable(
  'allocations',
  {
    id: id(),
    sourceType: text('source_type', { enum: ALLOCATION_SOURCES }).notNull(),
    sourceId: ref('source_id').notNull(),
    invoiceId: ref('invoice_id')
      .notNull()
      .references(() => invoices.id),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
  },
  (t) => [
    index('allocations_source_idx').on(t.sourceType, t.sourceId),
    index('allocations_invoice_idx').on(t.invoiceId),
    check('allocations_source', inList(t.sourceType, ALLOCATION_SOURCES)),
    check('allocations_amount', sql`${t.amount} > 0`),
  ],
);

/** The receivables ledger (ADR-0060 #4): append-only; a customer's balance is Σ debit − Σ credit. */
export const arEntries = pgTable(
  'ar_entries',
  {
    id: id(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    entryDate: date('entry_date').notNull(),
    kind: text('kind', { enum: AR_ENTRY_KINDS }).notNull(),
    docType: text('doc_type', { enum: DOC_TYPES }).notNull(),
    docId: ref('doc_id').notNull(),
    docNumber: text('doc_number').notNull(),
    debit: money('debit')
      .notNull()
      .default(sql`0`),
    credit: money('credit')
      .notNull()
      .default(sql`0`),
    createdAt: createdAt(),
  },
  (t) => [
    index('ar_entries_customer_idx').on(t.customerId, t.id),
    index('ar_entries_doc_idx').on(t.docType, t.docId),
    check('ar_entries_kind', inList(t.kind, AR_ENTRY_KINDS)),
    check('ar_entries_doc_type', inList(t.docType, DOC_TYPES)),
    check(
      'ar_entries_amounts',
      sql`${t.debit} >= 0 AND ${t.credit} >= 0 AND (${t.debit} = 0 OR ${t.credit} = 0)`,
    ),
  ],
);

/** The cache of the ledger per customer, rewritten with every entry and checked nightly. */
export const customerBalances = pgTable(
  'customer_balances',
  {
    customerId: ref('customer_id')
      .primaryKey()
      .references(() => customers.id),
    balance: money('balance')
      .notNull()
      .default(sql`0`),
    openInvoices: integer('open_invoices').notNull().default(0),
    overdueAmount: money('overdue_amount')
      .notNull()
      .default(sql`0`),
    oldestDueDate: date('oldest_due_date'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('customer_balances_counts', sql`${t.openInvoices} >= 0 AND ${t.overdueAmount} >= 0`),
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
