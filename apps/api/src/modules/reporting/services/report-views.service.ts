import { Inject, Injectable } from '@nestjs/common';
import {
  type PeriodPreset,
  REPORT_VIEW_LIMIT,
  REPORT_VIEW_PAGES,
  type ReportViewPage,
  storedViewQuery,
} from '@tugeel/shared/reports';
import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, notFound } from '../../../common/errors/app-error';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { reportViews } from '../schema';

export interface ReportView {
  id: number;
  page: ReportViewPage;
  name: string;
  query: string;
  period: PeriodPreset | null;
  shared: boolean;
  mine: boolean;
  /** Whether the caller may change it (its author), and delete it (the author, or a tidier of shared views). */
  editable: boolean;
  removable: boolean;
  createdBy: { id: number; fullName: string };
  updatedAt: Date;
}

export interface ReportViewInput {
  name: string;
  query: string;
  period: PeriodPreset | null;
  shared: boolean;
}

type ViewRow = typeof reportViews.$inferSelect;

/** Removes another person's shared view (someone who left, a name nobody wants). */
const TIDY = 'identity.settings.manage';

/**
 * Saved views of the report pages (ADR-0194): a page's address parameters under a name. A view is
 * its author's, or shared with everyone who may open the page; only the author changes it. What a
 * view shows is still decided by the report's own rights at the moment it is opened: a view is a
 * prompt, never a result.
 */
@Injectable()
export class ReportViewsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
  ) {}

  /** The caller's views of a page and the shared ones: own first, then by name. */
  async list(actor: AuthContext, page: ReportViewPage): Promise<ReportView[]> {
    this.assertMayOpen(actor, page);
    const rows = await this.db
      .select()
      .from(reportViews)
      .where(
        and(
          eq(reportViews.page, page),
          or(eq(reportViews.createdBy, actor.userId), reportViews.shared),
        ),
      )
      .orderBy(
        desc(sql`${reportViews.createdBy} = ${actor.userId}`),
        asc(sql`lower(${reportViews.name})`),
        asc(reportViews.id),
      );
    return this.views(actor, rows);
  }

  async create(
    actor: AuthContext,
    page: ReportViewPage,
    input: ReportViewInput,
  ): Promise<ReportView> {
    this.assertMayOpen(actor, page);
    const row = await inTransaction(this.db, async (tx) => {
      const [own] = await tx
        .select({ n: count() })
        .from(reportViews)
        .where(and(eq(reportViews.page, page), eq(reportViews.createdBy, actor.userId)));
      if ((own?.n ?? 0) >= REPORT_VIEW_LIMIT) {
        throw new AppError('REPORT_VIEW_LIMIT', 'the views of this page are full', {
          limit: REPORT_VIEW_LIMIT,
        });
      }
      const [created] = await tx
        .insert(reportViews)
        .values({
          page,
          name: input.name.trim(),
          query: storedViewQuery(input.query, input.period),
          period: input.period,
          shared: input.shared,
          createdBy: actor.userId,
        })
        .returning();
      if (!created) throw new Error('report view not created');
      await this.audit.record(tx, actor, {
        action: 'CREATE',
        entity: 'report_views',
        entityId: created.id,
        after: { page, name: created.name, shared: created.shared },
      });
      return created;
    });
    return this.one(actor, row);
  }

  /** The author's change: any of the name, the kept address with its period, the sharing. */
  async update(
    actor: AuthContext,
    id: number,
    patch: Partial<ReportViewInput>,
  ): Promise<ReportView> {
    const row = await inTransaction(this.db, async (tx) => {
      const before = await this.locked(tx, id);
      if (before.createdBy !== actor.userId) {
        throw new AppError('FORBIDDEN', 'only its author changes a report view');
      }
      const period =
        patch.period === undefined ? (before.period as PeriodPreset | null) : patch.period;
      const [after] = await tx
        .update(reportViews)
        .set({
          ...(patch.name === undefined ? {} : { name: patch.name.trim() }),
          // A new address, or the old one fitted to a changed period.
          query: storedViewQuery(patch.query ?? before.query, period),
          period,
          ...(patch.shared === undefined ? {} : { shared: patch.shared }),
          updatedAt: sql`now()`,
        })
        .where(eq(reportViews.id, id))
        .returning();
      if (!after) throw notFound('report view', id);
      await this.audit.record(tx, actor, {
        action: 'UPDATE',
        entity: 'report_views',
        entityId: id,
        before: { name: before.name, shared: before.shared },
        after: { name: after.name, shared: after.shared },
      });
      return after;
    });
    return this.one(actor, row);
  }

  async remove(actor: AuthContext, id: number): Promise<void> {
    await inTransaction(this.db, async (tx) => {
      const before = await this.locked(tx, id);
      if (!this.mayRemove(actor, before)) {
        throw new AppError('FORBIDDEN', 'only its author removes a report view');
      }
      await tx.delete(reportViews).where(eq(reportViews.id, id));
      await this.audit.record(tx, actor, {
        action: 'DELETE',
        entity: 'report_views',
        entityId: id,
        before: { page: before.page, name: before.name, shared: before.shared },
      });
    });
  }

  private assertMayOpen(actor: AuthContext, page: ReportViewPage): void {
    if (!actor.permissions.has(REPORT_VIEW_PAGES[page])) {
      throw new AppError('FORBIDDEN', `the page ${page} needs ${REPORT_VIEW_PAGES[page]}`);
    }
  }

  private mayRemove(actor: AuthContext, row: ViewRow): boolean {
    return row.createdBy === actor.userId || (row.shared && actor.permissions.has(TIDY));
  }

  /** The view, locked for the change. */
  private async locked(tx: Tx, id: number): Promise<ViewRow> {
    const [row] = await tx
      .select()
      .from(reportViews)
      .where(eq(reportViews.id, id))
      .for('no key update');
    if (!row) throw notFound('report view', id);
    return row;
  }

  private async one(actor: AuthContext, row: ViewRow): Promise<ReportView> {
    const [view] = await this.views(actor, [row]);
    if (!view) throw notFound('report view', row.id);
    return view;
  }

  private async views(actor: AuthContext, rows: readonly ViewRow[]): Promise<ReportView[]> {
    const names = await this.names.namesOf(rows.map((row) => row.createdBy));
    return rows.map((row) => ({
      id: row.id,
      page: row.page as ReportViewPage,
      name: row.name,
      query: row.query,
      period: row.period as PeriodPreset | null,
      shared: row.shared,
      mine: row.createdBy === actor.userId,
      editable: row.createdBy === actor.userId,
      removable: this.mayRemove(actor, row),
      createdBy: { id: row.createdBy, fullName: names.get(row.createdBy) ?? '' },
      updatedAt: row.updatedAt,
    }));
  }
}
