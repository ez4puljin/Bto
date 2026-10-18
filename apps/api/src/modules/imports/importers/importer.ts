import {
  type ImportKind,
  ROW_WARNING_CODES,
  type RowErrorCode,
  type RowIssue,
  type RowWarningCode,
} from '@tugeel/shared/imports';
import type { Db, Tx } from '../../../common/db/db.types';
import type { Actor } from '../../identity';
import type { ImportAction, importJobs } from '../schema';

export type ImportJobRow = typeof importJobs.$inferSelect;

/** A stored data row: what the sheet held and the problems of its cells. */
export interface SourceRow {
  rowNo: number;
  raw: Record<string, string | null>;
  cellIssues: RowIssue[];
}

/** A row after the checks: its plan (null when it has errors) and what the commit would do. */
export interface CheckedRow<P = unknown> {
  rowNo: number;
  errors: RowIssue[];
  warnings: RowIssue[];
  action: ImportAction | null;
  /** The record the row creates or changes (null for a new one). */
  targetId: number | null;
  /** What the commit applies; also shown in the preview (changed fields). */
  plan: P | null;
}

/** What the commit did to a row, kept for the revert. */
export interface AppliedRow {
  rowNo: number;
  action: ImportAction;
  targetId: number | null;
  changes: unknown;
}

/** A committed row read back for the revert. */
export interface CommittedRow {
  rowNo: number;
  action: ImportAction | null;
  targetId: number | null;
  changes: unknown;
}

/** Reports rows done to the progress bar (on its own connection, never the commit's). */
export type Progress = (done: number) => Promise<void>;

/**
 * One kind of import (ADR-0036): checks rows in bulk without writing, applies checked rows inside
 * the commit transaction and takes a committed import back.
 */
export interface Importer<P = unknown> {
  readonly kind: ImportKind;
  /** `job` carries the options its dialog chose (a receipts import, ADR-0078 #7). */
  validate(
    rows: readonly SourceRow[],
    executor: Db | Tx,
    job?: ImportJobRow,
  ): Promise<CheckedRow<P>[]>;
  apply(
    tx: Tx,
    actor: Actor,
    job: ImportJobRow,
    rows: readonly CheckedRow<P>[],
    progress: Progress,
  ): Promise<AppliedRow[]>;
  revert(tx: Tx, actor: Actor, job: ImportJobRow, rows: readonly CommittedRow[]): Promise<void>;
  /** Counts beyond the actions for the job summary (e.g. products a price import completed). */
  appliedNotes?(rows: readonly AppliedRow[]): Record<string, number>;
}

const WARNINGS: ReadonlySet<string> = new Set(ROW_WARNING_CODES);

/**
 * The checks of one row: cell problems found while reading come first; a column that already failed
 * reports no further problem.
 */
export class RowCheck {
  readonly errors: RowIssue[] = [];
  readonly warnings: RowIssue[] = [];

  constructor(readonly row: SourceRow) {
    for (const issue of row.cellIssues)
      (WARNINGS.has(issue.code) ? this.warnings : this.errors).push(issue);
  }

  get ok(): boolean {
    return this.errors.length === 0;
  }

  /** The column already has an error (e.g. an unreadable cell). */
  failed(column: string): boolean {
    return this.errors.some((issue) => issue.column === column);
  }

  error(column: string | null, code: RowErrorCode, params?: Record<string, string | number>): void {
    if (column !== null && this.failed(column)) return;
    this.errors.push(params ? { column, code, params } : { column, code });
  }

  warn(
    column: string | null,
    code: RowWarningCode,
    params?: Record<string, string | number>,
  ): void {
    this.warnings.push(params ? { column, code, params } : { column, code });
  }

  /** The cell text; REQUIRED when it must be filled and is empty. */
  text(column: string, required = false): string | null {
    const value = this.row.raw[column] ?? null;
    if (value === null && required) this.error(column, 'REQUIRED');
    return value;
  }

  /** The checked row: the plan only when there is no error. */
  result<P>(action: ImportAction | null, targetId: number | null, plan: P | null): CheckedRow<P> {
    return {
      rowNo: this.row.rowNo,
      errors: this.errors,
      warnings: this.warnings,
      action: this.ok ? action : null,
      targetId,
      plan: this.ok ? plan : null,
    };
  }
}

/**
 * Marks every repeat of a key within the file: DUPLICATE_IN_FILE on the later rows, naming the first
 * row that used the key.
 */
export function markDuplicates<T extends { check: RowCheck }>(
  entries: readonly T[],
  column: string,
  keysOf: (entry: T) => readonly string[],
): void {
  const first = new Map<string, number>();
  for (const entry of entries) {
    for (const key of new Set(keysOf(entry))) {
      const seen = first.get(key);
      if (seen === undefined) first.set(key, entry.check.row.rowNo);
      else entry.check.error(column, 'DUPLICATE_IN_FILE', { row: seen });
    }
  }
}
