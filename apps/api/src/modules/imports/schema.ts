import { IMPORT_KINDS } from '@tugeel/shared/imports';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { files, users, warehouses } from '../identity/schema';
import { adjustments } from '../inventory/schema';

// Imports (ADR-0015, ADR-0036): a job per uploaded sheet, its rows with their problems and what the
// commit did to them, and the opening-stock adjustments a job posted. Jobs are never deleted.

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

/**
 * UPLOADED → VALIDATING → VALIDATED | INVALID; VALIDATED → COMMITTING → COMMITTED (or back to
 * VALIDATED/INVALID when the commit fails or finds new problems); COMMITTED → REVERTING → REVERTED
 * (or back to COMMITTED). FAILED: the sheet could not be processed at all.
 */
export const IMPORT_STATUSES = [
  'UPLOADED',
  'VALIDATING',
  'VALIDATED',
  'INVALID',
  'COMMITTING',
  'COMMITTED',
  'FAILED',
  'REVERTING',
  'REVERTED',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

export const IMPORT_ACTIONS = ['CREATE', 'UPDATE', 'UNCHANGED'] as const;
export type ImportAction = (typeof IMPORT_ACTIONS)[number];

export const importJobs = pgTable(
  'import_jobs',
  {
    id: id(),
    kind: text('kind', { enum: IMPORT_KINDS }).notNull(),
    fileId: ref('file_id')
      .notNull()
      .references(() => files.id),
    fileName: text('file_name').notNull(),
    status: text('status', { enum: IMPORT_STATUSES }).notNull().default('UPLOADED'),
    /** What the worker is doing now (PARSING, CHECKING, APPLYING, REVERTING), for the progress bar. */
    phase: text('phase'),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    errorRows: integer('error_rows').notNull().default(0),
    warningRows: integer('warning_rows').notNull().default(0),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    /** What the import's dialog chose for the whole file (a receipts import: warehouse, payment). */
    options: jsonb('options'),
    /** Counts by action and code, file-level problems, what the commit did. */
    summary: jsonb('summary'),
    lastError: text('last_error'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    committedAt: timestamp('committed_at', { withTimezone: true }),
    committedBy: userRef('committed_by'),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    revertedBy: userRef('reverted_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('import_jobs_status_idx').on(t.status, t.id),
    check('import_jobs_kind', inList(t.kind, IMPORT_KINDS)),
    check('import_jobs_status', inList(t.status, IMPORT_STATUSES)),
    check(
      'import_jobs_counts',
      sql`${t.totalRows} >= 0 AND ${t.processedRows} >= 0 AND ${t.errorRows} >= 0 AND ${t.warningRows} >= 0`,
    ),
    check('import_jobs_file_name', sql`length(${t.fileName}) BETWEEN 1 AND 255`),
    check(
      'import_jobs_committed',
      sql`(${t.status} IN ('COMMITTED', 'REVERTING', 'REVERTED')) = (${t.committedAt} IS NOT NULL)`,
    ),
    check('import_jobs_reverted', sql`(${t.status} = 'REVERTED') = (${t.revertedAt} IS NOT NULL)`),
    check('import_jobs_last_error', sql`${t.lastError} IS NULL OR length(${t.lastError}) <= 2000`),
  ],
);

/** One data row of a sheet: its cells as read, the checks and what the commit did. */
export const importRows = pgTable(
  'import_rows',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => importJobs.id),
    /** The row number in the sheet, as Excel shows it. */
    rowNo: integer('row_no').notNull(),
    /** Column key → cell text (null when empty or unreadable). */
    raw: jsonb('raw').notNull(),
    /** Problems found while reading the cells (dates, formulas without a value…). */
    cellIssues: jsonb('cell_issues')
      .notNull()
      .default(sql`'[]'::jsonb`),
    normalized: jsonb('normalized'),
    errors: jsonb('errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    warnings: jsonb('warnings')
      .notNull()
      .default(sql`'[]'::jsonb`),
    errorCount: smallint('error_count').notNull().default(0),
    warningCount: smallint('warning_count').notNull().default(0),
    action: text('action', { enum: IMPORT_ACTIONS }),
    /** What the commit changed, for the revert (ids created, values before and after). */
    changes: jsonb('changes'),
    targetId: ref('target_id'),
  },
  (t) => [
    unique('import_rows_job_row_key').on(t.jobId, t.rowNo),
    index('import_rows_errors_idx')
      .on(t.jobId, t.rowNo)
      .where(sql`${t.errorCount} > 0`),
    index('import_rows_warnings_idx')
      .on(t.jobId, t.rowNo)
      .where(sql`${t.warningCount} > 0`),
    check('import_rows_row_no', sql`${t.rowNo} > 0`),
    check('import_rows_action', sql`${t.action} IS NULL OR ${inList(t.action, IMPORT_ACTIONS)}`),
    check('import_rows_counts', sql`${t.errorCount} >= 0 AND ${t.warningCount} >= 0`),
  ],
);

/** The OPENING adjustment an opening-stock import posted per warehouse (one active per warehouse). */
export const importDocuments = pgTable(
  'import_documents',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => importJobs.id),
    warehouseId: ref('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    adjustmentId: ref('adjustment_id')
      .notNull()
      .references(() => adjustments.id),
    reversalAdjustmentId: ref('reversal_adjustment_id').references(() => adjustments.id),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('import_documents_active_warehouse')
      .on(t.warehouseId)
      .where(sql`${t.active}`),
    index('import_documents_job_idx').on(t.jobId),
    check('import_documents_reversal', sql`${t.active} = (${t.reversalAdjustmentId} IS NULL)`),
  ],
);
