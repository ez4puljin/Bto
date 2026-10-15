import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ImportKind, RowIssue } from '@tugeel/shared/imports';
import { and, asc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError } from '../../../common/errors/app-error';
import { toProblem } from '../../../common/errors/problem-details';
import { type Actor, AuditService, StorageService, systemActor } from '../../identity';
import { CustomersImporter } from '../importers/customers.importer';
import type {
  AppliedRow,
  CheckedRow,
  CommittedRow,
  Importer,
  ImportJobRow,
  SourceRow,
} from '../importers/importer';
import { LevelsImporter } from '../importers/levels.importer';
import { OpeningStockImporter } from '../importers/opening-stock.importer';
import { PricesImporter } from '../importers/prices.importer';
import { ProductsImporter } from '../importers/products.importer';
import { SuppliersImporter } from '../importers/suppliers.importer';
import { type ImportAction, importJobs, importRows } from '../schema';
import { readSheet } from './sheet-reader';

/** pg_advisory_xact_lock key: one import commits or reverts at a time (ADR-0036 #3). */
export const IMPORT_LOCK = 72_029_001;
const CHUNK = 1_000;

/** The commit's fresh checks differ from the preview: the commit rolls back and shows them. */
class PreviewChanged extends Error {
  constructor(readonly checked: CheckedRow[]) {
    super('the import no longer matches its preview');
  }
}

/**
 * The worker side of imports (ADR-0036): reads and checks a sheet, commits it in one transaction
 * (checked again first) and takes it back. Every step is idempotent by the job's status, so a
 * retried pg-boss job never applies twice. Logs carry counts only (customer data never).
 */
@Injectable()
export class ImportPipelineService {
  private readonly logger = new Logger('Imports');
  private readonly importers: ReadonlyMap<ImportKind, Importer>;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    products: ProductsImporter,
    customers: CustomersImporter,
    suppliers: SuppliersImporter,
    opening: OpeningStockImporter,
    levels: LevelsImporter,
    prices: PricesImporter,
  ) {
    this.importers = new Map<ImportKind, Importer>([
      ['PRODUCTS', products],
      ['CUSTOMERS', customers],
      ['SUPPLIERS', suppliers],
      ['OPENING_STOCK', opening],
      ['LEVELS', levels],
      ['PRICES', prices],
    ]);
  }

  /** imports.validate: UPLOADED/VALIDATING → VALIDATED, INVALID or FAILED. */
  async validate(jobId: number): Promise<void> {
    const job = await this.job(jobId);
    if (!job || (job.status !== 'UPLOADED' && job.status !== 'VALIDATING')) return;
    await this.update(jobId, {
      status: 'VALIDATING',
      phase: 'PARSING',
      processedRows: 0,
      lastError: null,
    });
    let opened: Awaited<ReturnType<StorageService['openPrivate']>>;
    try {
      opened = await this.storage.openPrivate(job.fileId, 'imports.source');
    } catch (error) {
      await this.update(jobId, { status: 'FAILED', phase: null, lastError: problemText(error) });
      return;
    }
    const sheet = await readSheet(opened.body, job.kind);
    if (!sheet.ok) {
      await this.update(jobId, {
        status: 'INVALID',
        phase: null,
        totalRows: 0,
        errorRows: 0,
        warningRows: 0,
        summary: { fileIssues: [sheet.issue] },
        validatedAt: sql`now()`,
      });
      this.logger.log(
        { jobId, kind: job.kind, fileIssue: sheet.issue.code },
        'import sheet refused',
      );
      return;
    }
    const sources: SourceRow[] = sheet.rows.map((row) => ({
      rowNo: row.rowNo,
      raw: row.values,
      cellIssues: row.issues,
    }));
    await inTransaction(this.db, async (tx) => {
      await tx.delete(importRows).where(eq(importRows.jobId, jobId));
      for (let start = 0; start < sources.length; start += CHUNK) {
        await tx.insert(importRows).values(
          sources.slice(start, start + CHUNK).map((row) => ({
            jobId,
            rowNo: row.rowNo,
            raw: row.raw,
            cellIssues: row.cellIssues,
          })),
        );
      }
    });
    await this.update(jobId, { phase: 'CHECKING', totalRows: sources.length });
    const checked = await this.importerOf(job.kind).validate(sources, this.db);
    await this.storeChecks(this.db, jobId, checked);
    const summary = summarize(checked);
    await this.update(jobId, {
      status: summary.errorRows > 0 ? 'INVALID' : 'VALIDATED',
      phase: null,
      processedRows: sources.length,
      errorRows: summary.errorRows,
      warningRows: summary.warningRows,
      summary: summary.counts,
      validatedAt: sql`now()`,
    });
    this.logger.log(
      { jobId, kind: job.kind, rows: sources.length, errorRows: summary.errorRows },
      'import checked',
    );
  }

  /**
   * imports.commit: COMMITTING → COMMITTED in one transaction, after checking every row again. A
   * different result rolls back and replaces the preview (INVALID or VALIDATED); any other failure
   * rolls back and returns the job to VALIDATED with the problem.
   */
  async commit(jobId: number): Promise<void> {
    const job = await this.job(jobId);
    if (!job || job.status !== 'COMMITTING') return;
    const actor = actorOf(job.committedBy);
    const importer = this.importerOf(job.kind);
    const sources = await this.sources(jobId);
    const preview = new Map(
      (
        await this.db
          .select({ rowNo: importRows.rowNo, action: importRows.action })
          .from(importRows)
          .where(eq(importRows.jobId, jobId))
      ).map((row) => [row.rowNo, row.action]),
    );
    try {
      await inTransaction(this.db, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${IMPORT_LOCK})`);
        await this.progress(jobId, 'CHECKING', 0);
        const checked = await importer.validate(sources, tx);
        if (checked.some((row) => row.errors.length > 0 || row.action !== preview.get(row.rowNo))) {
          throw new PreviewChanged(checked);
        }
        await this.progress(jobId, 'APPLYING', 0);
        const applied = await importer.apply(tx, actor, job, checked, (done) =>
          this.progress(jobId, 'APPLYING', done),
        );
        await this.storeApplied(tx, jobId, applied);
        const { rows: locks } = await tx.execute<{ count: string }>(
          sql`SELECT count(*)::text AS count FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`,
        );
        const counts = { ...countActions(applied), ...importer.appliedNotes?.(applied) };
        await tx
          .update(importJobs)
          .set({
            status: 'COMMITTED',
            phase: null,
            processedRows: sources.length,
            committedAt: sql`now()`,
            lastError: null,
            summary: {
              ...(isRecord(job.summary) ? job.summary : {}),
              applied: counts,
              advisoryLocks: Number.parseInt(locks[0]?.count ?? '0', 10),
            },
            updatedAt: sql`now()`,
          })
          .where(eq(importJobs.id, jobId));
        await this.audit.record(tx, actor, {
          action: 'COMMIT',
          entity: 'import_jobs',
          entityId: jobId,
          after: { kind: job.kind, fileName: job.fileName, applied: counts },
        });
      });
      this.logger.log({ jobId, kind: job.kind, rows: sources.length }, 'import committed');
    } catch (error) {
      if (error instanceof PreviewChanged) {
        await this.storeChecks(this.db, jobId, error.checked);
        const summary = summarize(error.checked);
        await this.update(jobId, {
          status: summary.errorRows > 0 ? 'INVALID' : 'VALIDATED',
          phase: null,
          errorRows: summary.errorRows,
          warningRows: summary.warningRows,
          summary: { ...summary.counts, refreshed: true },
          validatedAt: sql`now()`,
          lastError: JSON.stringify({
            code: 'IMPORT_STATE_INVALID',
            params: { reason: 'CHANGED' },
          }),
        });
        return;
      }
      this.logger.warn(
        { jobId, kind: job.kind, code: toProblem(error, {}).code },
        'import commit failed',
      );
      await this.update(jobId, { status: 'VALIDATED', phase: null, lastError: problemText(error) });
    }
  }

  /**
   * imports.revert: REVERTING → REVERTED for the most recent committed import, in one transaction;
   * a failure changes nothing and returns the job to COMMITTED with the problem.
   */
  async revert(jobId: number): Promise<void> {
    const job = await this.job(jobId);
    if (!job || job.status !== 'REVERTING') return;
    const actor = actorOf(job.revertedBy);
    try {
      await inTransaction(this.db, async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${IMPORT_LOCK})`);
        await this.progress(jobId, 'REVERTING', 0);
        if (job.committedAt) {
          const [later] = await tx
            .select({ id: importJobs.id })
            .from(importJobs)
            .where(
              and(
                inArray(importJobs.status, ['COMMITTED', 'REVERTING']),
                gt(importJobs.committedAt, job.committedAt),
                ne(importJobs.id, jobId),
              ),
            )
            .limit(1);
          if (later) {
            throw new AppError('IMPORT_REVERT_BLOCKED', 'a later import must be reverted first', {
              reason: 'NOT_LATEST',
              id: later.id,
            });
          }
        }
        const rows: CommittedRow[] = await tx
          .select({
            rowNo: importRows.rowNo,
            action: importRows.action,
            targetId: importRows.targetId,
            changes: importRows.changes,
          })
          .from(importRows)
          .where(eq(importRows.jobId, jobId))
          .orderBy(asc(importRows.rowNo));
        await this.importerOf(job.kind).revert(tx, actor, job, rows);
        await tx
          .update(importJobs)
          .set({
            status: 'REVERTED',
            phase: null,
            revertedAt: sql`now()`,
            lastError: null,
            updatedAt: sql`now()`,
          })
          .where(eq(importJobs.id, jobId));
        await this.audit.record(tx, actor, {
          action: 'REVERT',
          entity: 'import_jobs',
          entityId: jobId,
          after: { kind: job.kind, fileName: job.fileName },
        });
      });
      this.logger.log({ jobId, kind: job.kind }, 'import reverted');
    } catch (error) {
      this.logger.warn(
        { jobId, kind: job.kind, code: toProblem(error, {}).code },
        'import revert failed',
      );
      await this.update(jobId, { status: 'COMMITTED', phase: null, lastError: problemText(error) });
    }
  }

  // -------------------------------------------------------------------------------------------

  private importerOf(kind: ImportKind): Importer {
    const importer = this.importers.get(kind);
    if (!importer) throw new Error(`no importer for ${kind}`);
    return importer;
  }

  private async job(id: number): Promise<ImportJobRow | undefined> {
    const [row] = await this.db.select().from(importJobs).where(eq(importJobs.id, id));
    return row;
  }

  private async sources(jobId: number): Promise<SourceRow[]> {
    const rows = await this.db
      .select({ rowNo: importRows.rowNo, raw: importRows.raw, cellIssues: importRows.cellIssues })
      .from(importRows)
      .where(eq(importRows.jobId, jobId))
      .orderBy(asc(importRows.rowNo));
    return rows.map((row) => ({
      rowNo: row.rowNo,
      raw: row.raw as Record<string, string | null>,
      cellIssues: row.cellIssues as RowIssue[],
    }));
  }

  /** Job columns, written through the pool (never inside a commit's transaction). */
  private async update(id: number, values: PgUpdateSetSource<typeof importJobs>): Promise<void> {
    await this.db
      .update(importJobs)
      .set({ ...values, heartbeatAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(importJobs.id, id));
  }

  /** Progress on its own connection: the commit's transaction never touches the job row early. */
  private async progress(id: number, phase: string, done: number): Promise<void> {
    await this.update(id, { phase, processedRows: done });
  }

  private async storeChecks(
    executor: Db | Tx,
    jobId: number,
    rows: readonly CheckedRow[],
  ): Promise<void> {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const part = rows.slice(start, start + CHUNK);
      await executor.execute(sql`
        UPDATE import_rows r
           SET errors = v.errors, warnings = v.warnings, error_count = v.error_count,
               warning_count = v.warning_count, action = v.action, target_id = v.target_id,
               normalized = v.normalized
          FROM (VALUES ${sql.join(
            part.map(
              (row) =>
                sql`(${row.rowNo}::int, ${JSON.stringify(row.errors)}::jsonb, ${JSON.stringify(row.warnings)}::jsonb, ${row.errors.length}::smallint, ${row.warnings.length}::smallint, ${row.action}::text, ${row.targetId}::bigint, ${row.plan === null ? null : JSON.stringify(row.plan)}::jsonb)`,
            ),
            sql`, `,
          )}) AS v (row_no, errors, warnings, error_count, warning_count, action, target_id, normalized)
         WHERE r.job_id = ${jobId} AND r.row_no = v.row_no`);
    }
  }

  private async storeApplied(tx: Tx, jobId: number, rows: readonly AppliedRow[]): Promise<void> {
    for (let start = 0; start < rows.length; start += CHUNK) {
      const part = rows.slice(start, start + CHUNK);
      await tx.execute(sql`
        UPDATE import_rows r
           SET action = v.action, target_id = v.target_id, changes = v.changes
          FROM (VALUES ${sql.join(
            part.map(
              (row) =>
                sql`(${row.rowNo}::int, ${row.action}::text, ${row.targetId}::bigint, ${row.changes === null ? null : JSON.stringify(row.changes)}::jsonb)`,
            ),
            sql`, `,
          )}) AS v (row_no, action, target_id, changes)
         WHERE r.job_id = ${jobId} AND r.row_no = v.row_no`);
    }
  }
}

/** The staff member who asked for the step, else the import itself. */
function actorOf(userId: number | null): Actor {
  return userId === null ? systemActor('imports') : { kind: 'STAFF', userId };
}

/** A problem as stored in `last_error`: its code and parameters, read by the screens. */
function problemText(error: unknown): string {
  const problem = toProblem(error, {});
  return JSON.stringify({
    code: problem.code,
    ...(problem.params ? { params: problem.params } : {}),
  }).slice(0, 2_000);
}

function countActions(rows: readonly { action: ImportAction | null }[]): Record<string, number> {
  const counts: Record<string, number> = { CREATE: 0, UPDATE: 0, UNCHANGED: 0 };
  for (const row of rows) if (row.action) counts[row.action] = (counts[row.action] ?? 0) + 1;
  return counts;
}

/** Rows with errors and warnings, and how often each action and code occurs. */
function summarize(rows: readonly CheckedRow[]) {
  const errors: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  for (const row of rows) {
    for (const issue of row.errors) errors[issue.code] = (errors[issue.code] ?? 0) + 1;
    for (const issue of row.warnings) warnings[issue.code] = (warnings[issue.code] ?? 0) + 1;
  }
  return {
    errorRows: rows.filter((row) => row.errors.length > 0).length,
    warningRows: rows.filter((row) => row.warnings.length > 0).length,
    counts: { actions: countActions(rows), errors, warnings },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
