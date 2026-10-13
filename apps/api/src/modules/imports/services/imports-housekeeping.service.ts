import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, lt, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { StorageService } from '../../identity';
import { type ImportStatus, importJobs, importRows } from '../schema';

/** How long imports keep what they no longer need (ADR-0040; sheets: ADR-0014). */
export const IMPORT_RETENTION = {
  /** The rows of an import refused, failed or taken back, after its last change. */
  rowDays: 90,
  /** The uploaded sheet, after the upload: one year. */
  sheetDays: 365,
} as const;

/** Imports whose rows nothing reads again; a committed import keeps them for its revert. */
const ROWS_DONE: readonly ImportStatus[] = ['INVALID', 'FAILED', 'REVERTED'];

/**
 * Imports whose sheet nothing reads again: only the check reads it (UPLOADED, VALIDATING); the
 * commit and the revert work from the stored rows. Jobs in COMMITTING or REVERTING are left alone.
 */
const SHEET_DONE: readonly ImportStatus[] = [
  'VALIDATED',
  'INVALID',
  'FAILED',
  'COMMITTED',
  'REVERTED',
];

export interface ImportsHousekeepingResult {
  /** Imports whose rows were deleted, and how many rows. */
  jobsPruned: number;
  rowsDeleted: number;
  /** Sheets handed to the file cleanup (identity removes the bytes). */
  sheetsDeleted: number;
}

const daysAgo = (days: number): SQL => sql`now() - make_interval(days => ${days})`;
const withFlag = (flag: 'rowsPruned' | 'sheetDeleted'): SQL =>
  sql`coalesce(${importJobs.summary}, '{}'::jsonb) || jsonb_build_object(${flag}::text, true)`;

/**
 * imports.housekeeping (ADR-0040): deletes the rows of old imports that were refused, failed or
 * taken back, and hands sheets past their year to identity's file cleanup. The job itself is never
 * deleted; its summary says what went (`rowsPruned`, `sheetDeleted`). One import per transaction.
 */
@Injectable()
export class ImportsHousekeepingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly storage: StorageService,
  ) {}

  async run(): Promise<ImportsHousekeepingResult> {
    const result: ImportsHousekeepingResult = { jobsPruned: 0, rowsDeleted: 0, sheetsDeleted: 0 };
    const pruneable = await this.db
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(
        and(
          inArray(importJobs.status, [...ROWS_DONE]),
          lt(importJobs.updatedAt, daysAgo(IMPORT_RETENTION.rowDays)),
          // Spelled out: Drizzle leaves a single-table select's columns unqualified.
          sql`EXISTS (SELECT 1 FROM import_rows r WHERE r.job_id = import_jobs.id)`,
        ),
      );
    for (const job of pruneable) {
      result.rowsDeleted += await inTransaction(this.db, async (tx) => {
        const deleted = await tx.delete(importRows).where(eq(importRows.jobId, job.id));
        await tx
          .update(importJobs)
          .set({ summary: withFlag('rowsPruned'), updatedAt: sql`now()` })
          .where(eq(importJobs.id, job.id));
        return deleted.rowCount ?? 0;
      });
      result.jobsPruned += 1;
    }
    const expired = await this.db
      .select({ id: importJobs.id, fileId: importJobs.fileId })
      .from(importJobs)
      .where(
        and(
          inArray(importJobs.status, [...SHEET_DONE]),
          lt(importJobs.createdAt, daysAgo(IMPORT_RETENTION.sheetDays)),
          sql`NOT coalesce((${importJobs.summary} ->> 'sheetDeleted')::boolean, false)`,
        ),
      );
    for (const job of expired) {
      await inTransaction(this.db, async (tx) => {
        await this.storage.markDeleted(tx, job.fileId);
        await tx
          .update(importJobs)
          .set({ summary: withFlag('sheetDeleted'), updatedAt: sql`now()` })
          .where(eq(importJobs.id, job.id));
      });
      result.sheetsDeleted += 1;
    }
    return result;
  }
}
