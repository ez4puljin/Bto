import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { aiReports } from '../schema';
import { ConversationsService } from './conversations.service';

export interface AiReportView {
  id: number;
  name: string;
  sql: string;
  sourceQuestionId: number;
  createdBy: { id: number; fullName: string };
  createdAt: Date;
  updatedAt: Date;
}

type ReportRow = typeof aiReports.$inferSelect;

const MANAGE = 'ai.reports.manage';

/**
 * Saved reports (ADR-0045 #8): a name and SQL copied on the server from one of the author's
 * answered questions, never SQL from a client. Every holder of `ai.ask` sees and runs them; the
 * author or a holder of `ai.reports.manage` renames or deletes one (soft delete, audited).
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly conversations: ConversationsService,
    private readonly names: UserNamesService,
  ) {}

  async list(query: {
    cursor?: string;
    limit?: number;
  }): Promise<{ data: AiReportView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const filters = [isNull(aiReports.deletedAt)];
    if (typeof after?.id === 'number') {
      const last = sql`(SELECT r.updated_at FROM ai_reports r WHERE r.id = ${after.id})`;
      const position = or(
        lt(aiReports.updatedAt, last),
        and(eq(aiReports.updatedAt, last), lt(aiReports.id, after.id)),
      );
      if (position) filters.push(position);
    }
    const rows = await this.db
      .select()
      .from(aiReports)
      .where(and(...filters))
      .orderBy(desc(aiReports.updatedAt), desc(aiReports.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: await this.views(page.data), nextCursor: page.nextCursor };
  }

  async get(id: number): Promise<AiReportView> {
    const [view] = await this.views([await this.live(id)]);
    if (!view) throw notFound('report', id);
    return view;
  }

  async create(
    actor: AuthContext,
    input: { questionId: number; name: string },
  ): Promise<AiReportView> {
    const question = await this.conversations.question(actor, input.questionId);
    if (question.status !== 'ANSWERED' || !question.sql) {
      throw invalid('questionId', 'answered', 'only an answered question becomes a report');
    }
    const sqlText = question.sql;
    const row = await inTransaction(this.db, async (tx) => {
      const [created] = await tx
        .insert(aiReports)
        .values({
          name: input.name.trim(),
          sql: sqlText,
          sourceQuestionId: question.id,
          createdBy: actor.userId,
        })
        .returning();
      if (!created) throw new Error('report not created');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'ai_reports',
        entityId: created.id,
        after: { name: created.name, sourceQuestionId: created.sourceQuestionId },
      });
      return created;
    });
    return this.get(row.id);
  }

  async rename(actor: AuthContext, id: number, name: string): Promise<AiReportView> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.live(id, true, tx);
      this.assertMayChange(actor, before);
      await tx
        .update(aiReports)
        .set({ name: name.trim(), updatedAt: sql`now()` })
        .where(eq(aiReports.id, id));
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'ai_reports',
        entityId: id,
        before: { name: before.name },
        after: { name: name.trim() },
      });
    });
    return this.get(id);
  }

  async remove(actor: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.live(id, true, tx);
      this.assertMayChange(actor, before);
      await tx
        .update(aiReports)
        .set({ deletedAt: sql`now()`, deletedBy: actor.userId })
        .where(eq(aiReports.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'ai_reports',
        entityId: id,
        before: { name: before.name },
      });
    });
  }

  /** The author may change a report; others need ai.reports.manage. */
  canChange(actor: AuthContext, report: { createdBy: number } | AiReportView): boolean {
    const authorId = typeof report.createdBy === 'number' ? report.createdBy : report.createdBy.id;
    return authorId === actor.userId || actor.permissions.has(MANAGE);
  }

  private assertMayChange(actor: AuthContext, row: ReportRow): void {
    if (!this.canChange(actor, row)) {
      throw new AppError('FORBIDDEN', 'only the author or ai.reports.manage changes a report');
    }
  }

  /** A report that is not deleted (locked for an update when asked), else 404. */
  private async live(
    id: number,
    forUpdate = false,
    executor: Db | Tx = this.db,
  ): Promise<ReportRow> {
    const query = executor
      .select()
      .from(aiReports)
      .where(and(eq(aiReports.id, id), isNull(aiReports.deletedAt)));
    const [row] = forUpdate ? await query.for('no key update') : await query;
    if (!row) throw notFound('report', id);
    return row;
  }

  private async views(rows: readonly ReportRow[]): Promise<AiReportView[]> {
    const names = await this.names.namesOf(rows.map((row) => row.createdBy));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sql: row.sql,
      sourceQuestionId: row.sourceQuestionId,
      createdBy: { id: row.createdBy, fullName: names.get(row.createdBy) ?? '' },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
