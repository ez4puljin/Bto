import { Inject, Injectable } from '@nestjs/common';
import type { ImportKind, ReceiptImportOptions, RowIssue } from '@tugeel/shared/imports';
import { and, asc, desc, eq, gt, inArray, lt, ne, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { JobsService } from '../../../common/jobs/jobs.service';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import {
  type AuthContext,
  AuditService,
  OrgService,
  ScopeService,
  StorageService,
} from '../../identity';
import { ReceiptsService } from '../../inventory';
import { type ImportAction, type ImportStatus, importJobs, importRows } from '../schema';
import { PricesImporter } from '../importers/prices.importer';
import type { StoredReceiptOptions } from '../importers/receipts.importer';
import { buildTemplate } from './import-template';

type JobRow = typeof importJobs.$inferSelect;

/** pg_advisory_xact_lock key serialising commit and revert requests (the busy check). */
const REQUEST_LOCK = 72_029_002;

export interface ImportProblem {
  code: string;
  params?: Record<string, unknown>;
}

export interface ImportJob {
  id: number;
  kind: ImportKind;
  fileName: string;
  status: ImportStatus;
  phase: string | null;
  totalRows: number;
  processedRows: number;
  errorRows: number;
  warningRows: number;
  summary: unknown;
  /** What the dialog chose for the whole file (a receipts import: warehouse and payment). */
  options: unknown;
  lastError: ImportProblem | null;
  /** The most recent committed import: the only one that can be reverted (ADR-0036 #7). */
  canRevert: boolean;
  createdAt: Date;
  validatedAt: Date | null;
  committedAt: Date | null;
  revertedAt: Date | null;
  updatedAt: Date;
}

export interface ImportRow {
  rowNo: number;
  raw: Record<string, string | null>;
  errors: RowIssue[];
  warnings: RowIssue[];
  action: ImportAction | null;
  /** What an UPDATE row changes, by field. */
  changed: string[];
}

export type RowFilter = 'ERRORS' | 'WARNINGS' | 'ALL';

/**
 * The api side of imports (ADR-0036): templates, a job per uploaded sheet (checked by the worker),
 * the preview, and the commit and revert requests the worker carries out. Admins only.
 */
@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
    private readonly storage: StorageService,
    private readonly prices: PricesImporter,
    private readonly org: OrgService,
    private readonly scope: ScopeService,
    private readonly receipts: ReceiptsService,
  ) {}

  /** The template of a kind; the price sheet starts from every active product (ADR-0054 #2). */
  async template(kind: ImportKind): Promise<Buffer> {
    return buildTemplate(kind, kind === 'PRICES' ? await this.prices.template() : undefined);
  }

  /** Attaches an uploaded sheet and queues its check (POST /imports). */
  async create(
    ctx: AuthContext,
    input: {
      kind: ImportKind;
      fileId: number;
      fileName: string;
      receiptOptions?: ReceiptImportOptions | null;
    },
  ): Promise<ImportJob> {
    const options =
      input.kind === 'RECEIPTS' ? await this.receiptOptions(ctx, input.receiptOptions) : null;
    await this.storage.verifyUploaded(input.fileId, 'imports.source');
    return inTransaction(this.db, async (tx) => {
      await this.storage.confirm(tx, input.fileId, 'imports.source');
      const [job] = await tx
        .insert(importJobs)
        .values({
          kind: input.kind,
          fileId: input.fileId,
          fileName: input.fileName.trim().slice(0, 255) || 'import.xlsx',
          options,
          createdBy: ctx.userId,
        })
        .returning();
      if (!job) throw new Error('import job insert returned no row');
      await this.jobs.enqueue(tx, 'imports.validate', { jobId: job.id }, singleton(job.id));
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'import_jobs',
        entityId: job.id,
        after: { kind: job.kind, fileName: job.fileName, fileId: job.fileId, options },
      });
      return this.view(job, tx);
    });
  }

  /**
   * A receipts import's options (ADR-0078 #7): a wholesale warehouse the user writes for, how the
   * notes are paid, and whether the sheet's prices are taken (cost holders only).
   */
  private async receiptOptions(
    ctx: AuthContext,
    options: ReceiptImportOptions | null | undefined,
  ): Promise<StoredReceiptOptions> {
    if (!options) {
      throw invalid('receiptOptions', 'required', 'a receipts import names its warehouse');
    }
    const warehouse = await this.org.getWarehouse(options.warehouseId);
    if (warehouse.kind !== 'WHOLESALE') {
      throw new AppError(
        'WAREHOUSE_KIND_NOT_ALLOWED',
        'goods are received into wholesale warehouses',
        { kind: warehouse.kind },
      );
    }
    this.scope.assertCanWriteWarehouse(ctx, warehouse.id);
    if (options.paymentMethod === 'CREDIT' && options.moneyAccountId) {
      throw invalid(
        'receiptOptions.moneyAccountId',
        'credit',
        'a receipt on credit names no account',
      );
    }
    const accountId = options.paymentMethod === 'CREDIT' ? null : options.moneyAccountId;
    if (options.paymentMethod !== 'CREDIT') {
      const account = (await this.receipts.paymentAccounts()).find((row) => row.id === accountId);
      if (!account || account.kind !== options.paymentMethod) {
        throw invalid(
          'receiptOptions.moneyAccountId',
          'kind',
          'an active account of the payment kind',
        );
      }
    }
    return {
      warehouseId: warehouse.id,
      paymentMethod: options.paymentMethod,
      moneyAccountId: accountId,
      withPrices: ctx.permissions.has('inventory.costs.manage'),
    };
  }

  async get(id: number, executor: Db | Tx = this.db): Promise<ImportJob> {
    const [job] = await executor.select().from(importJobs).where(eq(importJobs.id, id));
    if (!job) throw notFound('import', id);
    return this.view(job, executor);
  }

  async list(query: {
    kind?: ImportKind;
    status?: ImportStatus;
    cursor?: string;
    limit?: number;
  }): Promise<{ data: ImportJob[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [];
    if (query.kind) filters.push(eq(importJobs.kind, query.kind));
    if (query.status) filters.push(eq(importJobs.status, query.status));
    const after = decodeCursor(query.cursor);
    if (typeof after?.id === 'number') filters.push(lt(importJobs.id, after.id));
    const rows = await this.db
      .select()
      .from(importJobs)
      .where(and(...filters))
      .orderBy(desc(importJobs.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    const latest = await this.latestCommitted(this.db);
    return {
      data: page.data.map((row) => toView(row, latest)),
      nextCursor: page.nextCursor,
    };
  }

  /** The rows of a job in sheet order: all, or only those with errors or warnings. */
  async rows(
    id: number,
    query: { filter?: RowFilter; cursor?: string; limit?: number },
  ): Promise<{ data: ImportRow[]; nextCursor: string | null }> {
    await this.get(id);
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const filters: SQL[] = [eq(importRows.jobId, id)];
    if (query.filter === 'ERRORS') filters.push(gt(importRows.errorCount, 0));
    if (query.filter === 'WARNINGS') filters.push(gt(importRows.warningCount, 0));
    const after = decodeCursor(query.cursor);
    if (typeof after?.rowNo === 'number') filters.push(gt(importRows.rowNo, after.rowNo));
    const rows = await this.db
      .select()
      .from(importRows)
      .where(and(...filters))
      .orderBy(asc(importRows.rowNo))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ rowNo: row.rowNo }));
    return {
      data: page.data.map((row) => ({
        rowNo: row.rowNo,
        raw: row.raw as Record<string, string | null>,
        errors: row.errors as RowIssue[],
        warnings: row.warnings as RowIssue[],
        action: row.action,
        changed: changedOf(row.normalized),
      })),
      nextCursor: page.nextCursor,
    };
  }

  /** VALIDATED → COMMITTING; the worker commits (one import at a time, IMPORT_BUSY otherwise). */
  requestCommit(ctx: AuthContext, id: number): Promise<ImportJob> {
    return inTransaction(this.db, async (tx) => {
      const job = await this.lockForRequest(tx, id);
      if (job.status === 'INVALID') {
        throw new AppError('IMPORT_HAS_ERRORS', `import ${id} has rows with errors`, {
          errorRows: job.errorRows,
        });
      }
      assertState(job, 'VALIDATED');
      await this.assertIdle(tx, id);
      await tx
        .update(importJobs)
        .set({
          status: 'COMMITTING',
          committedBy: ctx.userId,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(importJobs.id, id));
      await this.jobs.enqueue(tx, 'imports.commit', { jobId: id }, singleton(id));
      return this.get(id, tx);
    });
  }

  /** COMMITTED → REVERTING for the most recent committed import only. */
  requestRevert(ctx: AuthContext, id: number): Promise<ImportJob> {
    return inTransaction(this.db, async (tx) => {
      const job = await this.lockForRequest(tx, id);
      assertState(job, 'COMMITTED');
      await this.assertIdle(tx, id);
      const latest = await this.latestCommitted(tx);
      if (latest !== id) {
        throw new AppError('IMPORT_REVERT_BLOCKED', 'a later import must be reverted first', {
          reason: 'NOT_LATEST',
        });
      }
      await tx
        .update(importJobs)
        .set({
          status: 'REVERTING',
          revertedBy: ctx.userId,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(importJobs.id, id));
      await this.jobs.enqueue(tx, 'imports.revert', { jobId: id }, singleton(id));
      return this.get(id, tx);
    });
  }

  // -------------------------------------------------------------------------------------------

  private async lockForRequest(tx: Tx, id: number): Promise<JobRow> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${REQUEST_LOCK})`);
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, id)).for('update');
    if (!job) throw notFound('import', id);
    return job;
  }

  /** IMPORT_BUSY while another import commits or reverts. */
  private async assertIdle(tx: Tx, id: number): Promise<void> {
    const [busy] = await tx
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(and(inArray(importJobs.status, ['COMMITTING', 'REVERTING']), ne(importJobs.id, id)))
      .limit(1);
    if (busy) throw new AppError('IMPORT_BUSY', `import ${busy.id} is running`, { id: busy.id });
  }

  /** The id of the most recently committed import still in force, if any. */
  private async latestCommitted(executor: Db | Tx): Promise<number | null> {
    const [row] = await executor
      .select({ id: importJobs.id })
      .from(importJobs)
      .where(inArray(importJobs.status, ['COMMITTED', 'REVERTING']))
      .orderBy(desc(importJobs.committedAt), desc(importJobs.id))
      .limit(1);
    return row?.id ?? null;
  }

  private async view(job: JobRow, executor: Db | Tx): Promise<ImportJob> {
    return toView(job, await this.latestCommitted(executor));
  }
}

function singleton(jobId: number) {
  return { singletonKey: `import-${jobId}` };
}

function assertState(job: JobRow, expected: ImportStatus): void {
  if (job.status !== expected) {
    throw new AppError('IMPORT_STATE_INVALID', `import ${job.id} is ${job.status}`, {
      status: job.status,
    });
  }
}

function toView(job: JobRow, latestCommitted: number | null): ImportJob {
  return {
    id: job.id,
    kind: job.kind,
    fileName: job.fileName,
    status: job.status,
    phase: job.phase,
    totalRows: job.totalRows,
    processedRows: job.processedRows,
    errorRows: job.errorRows,
    warningRows: job.warningRows,
    summary: job.summary,
    options: job.options,
    lastError: parseProblem(job.lastError),
    canRevert: job.status === 'COMMITTED' && latestCommitted === job.id,
    createdAt: job.createdAt,
    validatedAt: job.validatedAt,
    committedAt: job.committedAt,
    revertedAt: job.revertedAt,
    updatedAt: job.updatedAt,
  };
}

function parseProblem(text: string | null): ImportProblem | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value === 'object' && value !== null && 'code' in value) {
      const problem = value as { code: unknown; params?: unknown };
      return {
        code: String(problem.code),
        ...(typeof problem.params === 'object' && problem.params !== null
          ? { params: problem.params as Record<string, unknown> }
          : {}),
      };
    }
  } catch {
    // an older plain-text message
  }
  return { code: 'INTERNAL_ERROR' };
}

/** The fields an UPDATE row changes, from its stored plan. */
function changedOf(plan: unknown): string[] {
  if (typeof plan !== 'object' || plan === null || !('changed' in plan)) return [];
  const changed = plan.changed;
  return Array.isArray(changed)
    ? changed.filter((entry): entry is string => typeof entry === 'string')
    : [];
}
