import { EBARIMT_FILE_STATUSES } from '@tugeel/shared/ebarimt-check';
import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import { money } from '../../common/db/types';
import { files, users } from '../identity/schema';
import { suppliers } from '../partners/schema';

// Tables owned by the ebarimt-check module (ADR-0168, docs/modules/ebarimt-check.md): a month's
// purchases come from inventory's posted receipts and are never copied here; what lives here is
// e-Barimt's file, what people wrote beside it and which accounts count. Nothing is deleted: a file
// replaced or removed stays with its rows, a link undone keeps its row.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const period = () => integer('period').notNull();
const at = (name: string) => timestamp(name, { withTimezone: true });

const isPeriod = (column: AnyPgColumn) =>
  sql`${column} BETWEEN 200001 AND 210012 AND ${column} % 100 BETWEEN 1 AND 12`;

/**
 * The accounts whose receipts count as the month's purchases, by code in the chart (inventory
 * names a receipt's account by code too). No row: the key AP's account alone.
 */
export const ebarimtCheckAccounts = pgTable('ebarimt_check_accounts', {
  accountCode: text('account_code').primaryKey(),
  addedBy: userRef('added_by'),
  addedAt: at('added_at').notNull().defaultNow(),
});

/** A month's e-Barimt export as it was uploaded: one ACTIVE per month, every older one kept. */
export const ebarimtCheckFiles = pgTable(
  'ebarimt_check_files',
  {
    id: id(),
    period: period(),
    fileId: ref('file_id')
      .notNull()
      .references(() => files.id),
    fileName: text('file_name').notNull(),
    rowCount: integer('row_count').notNull(),
    vatAmount: money('vat_amount').notNull(),
    totalAmount: money('total_amount').notNull(),
    status: text('status', { enum: EBARIMT_FILE_STATUSES }).notNull().default('ACTIVE'),
    uploadedBy: userRef('uploaded_by'),
    uploadedAt: at('uploaded_at').notNull().defaultNow(),
    /** Who replaced or removed it, and when. */
    closedBy: userRef('closed_by'),
    closedAt: at('closed_at'),
  },
  (t) => [
    uniqueIndex('ebarimt_check_files_active_key')
      .on(t.period)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('ebarimt_check_files_period_idx').on(t.period, t.id),
    check('ebarimt_check_files_period', isPeriod(t.period)),
    check('ebarimt_check_files_name', sql`length(${t.fileName}) BETWEEN 1 AND 300`),
    check('ebarimt_check_files_rows', sql`${t.rowCount} >= 0`),
    check('ebarimt_check_files_status', sql`${t.status} IN ('ACTIVE', 'REPLACED', 'REMOVED')`),
    check('ebarimt_check_files_closed', sql`(${t.status} = 'ACTIVE') = (${t.closedAt} IS NULL)`),
  ],
);

/** One line of a file: one receipt as e-Barimt shows it. */
export const ebarimtCheckEntries = pgTable(
  'ebarimt_check_entries',
  {
    id: id(),
    ebarimtFileId: ref('ebarimt_file_id')
      .notNull()
      .references(() => ebarimtCheckFiles.id),
    rowNo: integer('row_no').notNull(),
    /** What a link names across file versions: ДДТД, else the delivery note, date, TTD and total. */
    receiptKey: text('receipt_key').notNull(),
    ddtd: text('ddtd'),
    deliveryNoteNo: text('delivery_note_no'),
    docDate: date('doc_date', { mode: 'string' }).notNull(),
    partnerName: text('partner_name'),
    /** The partner's taxpayer number, normalized (`normalizeTaxId`). */
    ttd: text('ttd').notNull(),
    vatAmount: money('vat_amount').notNull(),
    netAmount: money('net_amount').notNull(),
    totalAmount: money('total_amount').notNull(),
    /** «Төрөл» as printed. */
    kind: text('kind'),
  },
  (t) => [index('ebarimt_check_entries_file_idx').on(t.ebarimtFileId, t.rowNo)],
);

/** What people wrote for a supplier's month: the amount exempt from VAT and a note. */
export const ebarimtCheckMonthValues = pgTable(
  'ebarimt_check_month_values',
  {
    period: period(),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    exemptAmount: money('exempt_amount').notNull(),
    note: text('note'),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.period, t.supplierId] }),
    check('ebarimt_check_month_values_period', isPeriod(t.period)),
    check(
      'ebarimt_check_month_values_note',
      sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 500`,
    ),
  ],
);

/**
 * A supplier given to another employee on this page, from this month on until the next such row.
 * NULL: back to the supplier's own orderer. The orderer on the supplier's page is never touched.
 */
export const ebarimtCheckAssignments = pgTable(
  'ebarimt_check_assignments',
  {
    period: period(),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    userId: userRef('user_id'),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.period, t.supplierId] }),
    index('ebarimt_check_assignments_supplier_idx').on(t.supplierId, t.period),
    check('ebarimt_check_assignments_period', isPeriod(t.period)),
  ],
);

/**
 * A supplier's values on this page, kept apart from its record so a typing here changes nothing
 * there. NULL: the record's register and phone; a text: these instead (several registers allowed).
 */
export const ebarimtCheckSupplierProfiles = pgTable(
  'ebarimt_check_supplier_profiles',
  {
    supplierId: ref('supplier_id')
      .primaryKey()
      .references(() => suppliers.id),
    registers: text('registers'),
    phone: text('phone'),
    remark: text('remark'),
    updatedBy: userRef('updated_by'),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'ebarimt_check_supplier_profiles_lengths',
      sql`(${t.registers} IS NULL OR length(${t.registers}) <= 200)
        AND (${t.phone} IS NULL OR length(${t.phone}) <= 60)
        AND (${t.remark} IS NULL OR length(${t.remark}) <= 300)`,
    ),
  ],
);

/**
 * A receipt of a register no supplier holds, counted for a chosen supplier. The link wins over
 * registers, so the same receipt never counts twice; it outlives a new version of the file while
 * the receipt is still there.
 */
export const ebarimtCheckReceiptLinks = pgTable(
  'ebarimt_check_receipt_links',
  {
    id: id(),
    period: period(),
    receiptKey: text('receipt_key').notNull(),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    ttd: text('ttd').notNull(),
    /** The receipt's total when linked, for a link whose receipt left the file. */
    amount: money('amount').notNull(),
    createdBy: userRef('created_by'),
    createdAt: at('created_at').notNull().defaultNow(),
    removedBy: userRef('removed_by'),
    removedAt: at('removed_at'),
  },
  (t) => [
    uniqueIndex('ebarimt_check_receipt_links_live_key')
      .on(t.period, t.receiptKey)
      .where(sql`${t.removedAt} IS NULL`),
    index('ebarimt_check_receipt_links_period_idx').on(t.period, t.id),
    check('ebarimt_check_receipt_links_period', isPeriod(t.period)),
  ],
);

/** How a supplier's month changed: its employee, its e-Barimt total, its exempt amount. */
export const ebarimtCheckHistory = pgTable(
  'ebarimt_check_history',
  {
    id: id(),
    period: period(),
    supplierId: ref('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    field: text('field').notNull(),
    userId: userRef('user_id'),
    amount: money('amount'),
    kind: text('kind').notNull(),
    /** A file's name or the register linked. */
    source: text('source'),
    changedBy: userRef('changed_by'),
    changedAt: at('changed_at').notNull().defaultNow(),
  },
  (t) => [
    index('ebarimt_check_history_period_idx').on(t.period, t.supplierId, t.field, t.id),
    check('ebarimt_check_history_period', isPeriod(t.period)),
    check('ebarimt_check_history_field', sql`${t.field} IN ('EMPLOYEE', 'EBARIMT', 'EXEMPT')`),
    check(
      'ebarimt_check_history_kind',
      sql`${t.kind} IN ('INIT', 'FILE', 'MANUAL', 'REVERT', 'LINK', 'UNLINK', 'EDIT', 'REMOVE')`,
    ),
  ],
);
