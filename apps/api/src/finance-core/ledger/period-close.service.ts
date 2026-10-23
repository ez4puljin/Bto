import { Inject, Injectable } from '@nestjs/common';
import type { FinPermission } from '@tugeel/fin-contract';
import { businessDateIn } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import { type CompanyScope, type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import { FIN_DB, type FinDb, type FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { reconcileBooks } from '../posting/reconcile';
import { finCompanies, finFiscalPeriods, finPeriodEvents } from '../schema';
import { monthOf, PERIOD_LOCK } from './periods';

export type FinPeriodStatus = 'OPEN' | 'CLOSED';
export type FinPeriodAction = 'CLOSE' | 'REOPEN';

/** One item a close checked (ADR-0102 #2): the core reconcile's runs, kept in the event row. */
export interface FinCloseCheck {
  item: 'RECONCILE';
  status: 'OK' | 'DRIFT';
  /** The reconcile runs of this company, by kind, with their drift counts. */
  runs: { id: number; kind: string; drifted: number }[];
}

export interface FinPeriodEventView {
  id: number;
  period: string;
  action: FinPeriodAction;
  reason: string | null;
  checks: unknown;
  actorLabel: string;
  createdAt: Date;
}

export interface FinPeriodView {
  id: number;
  /** `YYYY-MM`. */
  code: string;
  startsOn: string;
  endsOn: string;
  status: FinPeriodStatus;
  /** The month's latest close or reopen; null while it was never closed. */
  lastEvent: FinPeriodEventView | null;
}

const PERIOD_CODE = /^\d{4}-(0[1-9]|1[0-2])$/;
const REASON_MAX = 500;

const READ: FinPermission[] = ['finance.read', 'finance.periods.close', 'finance.periods.reopen'];

/**
 * The month close (ADR-0075, reduced by ADR-0083 and built by ADR-0102): a user with
 * `finance.periods.close` closes a month that has ended once every earlier month is closed and the
 * core reconcile is clean; a user with `finance.periods.reopen` reopens the latest closed month with a
 * reason. Each writes an event row and an audit row. A closed month refuses every posting
 * (`openPeriodInTx`); a close and a posting serialise on the company's period lock. No soft close,
 * override, checklist beyond the reconcile, or pending list (after go-live, ADR-0083 #4).
 */
@Injectable()
export class FinPeriodsService {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  /** The company's months that have a row, the newest first, each with its latest event. */
  async periods(
    ctx: FinCallContext,
    query: { company: string },
    executor: FinExecutor = this.db,
  ): Promise<FinPeriodView[]> {
    const scope = await resolveCompany(executor, ctx, query.company, {
      source: false,
      userAnyOf: READ,
    });
    const rows = await executor
      .select({
        id: finFiscalPeriods.id,
        code: finFiscalPeriods.code,
        startsOn: finFiscalPeriods.startsOn,
        endsOn: finFiscalPeriods.endsOn,
        status: finFiscalPeriods.status,
      })
      .from(finFiscalPeriods)
      .where(eq(finFiscalPeriods.companyId, scope.companyId))
      .orderBy(desc(finFiscalPeriods.code));
    const ids = rows.map((row) => row.id);
    const last = new Map<number, FinPeriodEventView>();
    if (ids.length) {
      const events = await executor
        .selectDistinctOn([finPeriodEvents.periodId], eventColumns)
        .from(finPeriodEvents)
        .innerJoin(
          finFiscalPeriods,
          and(
            eq(finFiscalPeriods.companyId, finPeriodEvents.companyId),
            eq(finFiscalPeriods.id, finPeriodEvents.periodId),
          ),
        )
        .where(
          and(
            eq(finPeriodEvents.companyId, scope.companyId),
            inArray(finPeriodEvents.periodId, ids),
          ),
        )
        .orderBy(asc(finPeriodEvents.periodId), desc(finPeriodEvents.id));
      for (const event of events) last.set(event.periodId, eventView(event));
    }
    return rows.map((row) => ({ ...row, lastEvent: last.get(row.id) ?? null }));
  }

  /** The closes and reopens of the company (or one month), the newest first. */
  async events(
    ctx: FinCallContext,
    query: { company: string; period?: string; limit?: number },
    executor: FinExecutor = this.db,
  ): Promise<FinPeriodEventView[]> {
    const scope = await resolveCompany(executor, ctx, query.company, {
      source: false,
      userAnyOf: READ,
    });
    if (query.period !== undefined && !PERIOD_CODE.test(query.period)) {
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'period' });
    }
    const rows = await executor
      .select(eventColumns)
      .from(finPeriodEvents)
      .innerJoin(
        finFiscalPeriods,
        and(
          eq(finFiscalPeriods.companyId, finPeriodEvents.companyId),
          eq(finFiscalPeriods.id, finPeriodEvents.periodId),
        ),
      )
      .where(
        and(
          eq(finPeriodEvents.companyId, scope.companyId),
          query.period === undefined ? undefined : eq(finFiscalPeriods.code, query.period),
        ),
      )
      .orderBy(desc(finPeriodEvents.id))
      .limit(Math.min(Math.max(query.limit ?? 100, 1), 500));
    return rows.map(eventView);
  }

  /**
   * Closes `period` (ADR-0102 #2): refused before its last day has passed in the company's timezone
   * (FIN_PERIOD_NOT_ENDED), while an earlier month is open (FIN_PERIOD_ORDER) or when the core
   * reconcile finds an item or ledger drift (FIN_CHECKLIST_FAILED with its runs; a cache drift is
   * rewritten by the run and only recorded). Closing a closed month changes
   * nothing. A month without a row (no posting yet) gets one, CLOSED.
   */
  async close(
    ctx: FinCallContext,
    input: { company: string; period: string },
  ): Promise<FinPeriodView> {
    const month = this.month(input.period);
    const scope = await resolveCompany(this.db, ctx, input.company, {
      source: false,
      userAnyOf: ['finance.periods.close'],
    });
    const today = await this.today(scope);
    if (month.endsOn >= today) {
      throw new FinError('FIN_PERIOD_NOT_ENDED', undefined, {
        period: month.code,
        endsOn: month.endsOn,
      });
    }
    // The reconcile runs in its own transaction (it rewrites the balance cache) before the close.
    const runs = (await reconcileBooks(this.db, 'MANUAL')).filter(
      (run) => run.companyId === scope.companyId,
    );
    // A drift of the balance cache is rewritten by the run itself; the items and the ledger block.
    const check: FinCloseCheck = {
      item: 'RECONCILE',
      status: runs.some((run) => run.status === 'DRIFT' && run.kind !== 'CACHE') ? 'DRIFT' : 'OK',
      runs: runs.map((run) => ({ id: run.id, kind: run.kind, drifted: run.drifted })),
    };
    if (check.status === 'DRIFT') {
      throw new FinError('FIN_CHECKLIST_FAILED', undefined, {
        items: check.item,
        runs: check.runs
          .filter((run) => run.drifted > 0 && run.kind !== 'CACHE')
          .map((run) => run.kind)
          .join(','),
      });
    }
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PERIOD_LOCK}, ${scope.companyId})`);
      const [earlier] = await tx
        .select({ code: finFiscalPeriods.code })
        .from(finFiscalPeriods)
        .where(
          and(
            eq(finFiscalPeriods.companyId, scope.companyId),
            eq(finFiscalPeriods.status, 'OPEN'),
            lt(finFiscalPeriods.code, month.code),
          ),
        )
        .orderBy(asc(finFiscalPeriods.code))
        .limit(1);
      if (earlier) {
        throw new FinError('FIN_PERIOD_ORDER', undefined, {
          period: month.code,
          open: earlier.code,
        });
      }
      const created = await tx
        .insert(finFiscalPeriods)
        .values({ companyId: scope.companyId, ...month, status: 'CLOSED' })
        .onConflictDoNothing({ target: [finFiscalPeriods.companyId, finFiscalPeriods.code] })
        .returning({ id: finFiscalPeriods.id });
      const row = await this.lockRow(tx, scope, month.code);
      if (row.status === 'CLOSED' && (await this.hasEvent(tx, scope, row.id, 'CLOSE'))) return;
      await tx
        .update(finFiscalPeriods)
        .set({ status: 'CLOSED', updatedAt: sql`now()` })
        .where(
          and(eq(finFiscalPeriods.companyId, scope.companyId), eq(finFiscalPeriods.id, row.id)),
        );
      await this.event(tx, ctx, scope, row.id, 'CLOSE', null, [check]);
      await recordFinAudit(tx, ctx, {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        action: 'CLOSE',
        entity: 'period',
        entityId: month.code,
        before: created.length ? null : { status: row.status },
        after: { status: 'CLOSED' },
      });
    });
    return this.one(ctx, input.company, month.code);
  }

  /**
   * Reopens `period` (ADR-0102 #3): only the company's latest closed month (FIN_PERIOD_ORDER names
   * it otherwise), with a reason of 1–500 characters; the months after it are open already.
   */
  async reopen(
    ctx: FinCallContext,
    input: { company: string; period: string; reason: string },
  ): Promise<FinPeriodView> {
    const month = this.month(input.period);
    const reason = input.reason.trim();
    if (reason.length < 1 || reason.length > REASON_MAX) {
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'reason' });
    }
    const scope = await resolveCompany(this.db, ctx, input.company, {
      source: false,
      userAnyOf: ['finance.periods.reopen'],
    });
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${PERIOD_LOCK}, ${scope.companyId})`);
      const [latest] = await tx
        .select({ code: finFiscalPeriods.code })
        .from(finFiscalPeriods)
        .where(
          and(
            eq(finFiscalPeriods.companyId, scope.companyId),
            eq(finFiscalPeriods.status, 'CLOSED'),
          ),
        )
        .orderBy(desc(finFiscalPeriods.code))
        .limit(1);
      if (!latest || latest.code !== month.code) {
        throw new FinError('FIN_PERIOD_ORDER', undefined, {
          period: month.code,
          latestClosed: latest?.code ?? null,
        });
      }
      const row = await this.lockRow(tx, scope, month.code);
      await tx
        .update(finFiscalPeriods)
        .set({ status: 'OPEN', updatedAt: sql`now()` })
        .where(
          and(eq(finFiscalPeriods.companyId, scope.companyId), eq(finFiscalPeriods.id, row.id)),
        );
      await this.event(tx, ctx, scope, row.id, 'REOPEN', reason, []);
      await recordFinAudit(tx, ctx, {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        action: 'REOPEN',
        entity: 'period',
        entityId: month.code,
        before: { status: 'CLOSED' },
        after: { status: 'OPEN', reason },
      });
    });
    return this.one(ctx, input.company, month.code);
  }

  private month(code: string): ReturnType<typeof monthOf> {
    if (!PERIOD_CODE.test(code))
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'period' });
    return monthOf(`${code}-01`);
  }

  private async today(scope: CompanyScope): Promise<string> {
    const [company] = await this.db
      .select({ timezone: finCompanies.timezone })
      .from(finCompanies)
      .where(eq(finCompanies.id, scope.companyId));
    return businessDateIn(company?.timezone ?? 'Asia/Ulaanbaatar', new Date());
  }

  private async lockRow(
    tx: FinTx,
    scope: CompanyScope,
    code: string,
  ): Promise<{ id: number; status: FinPeriodStatus }> {
    const [row] = await tx
      .select({ id: finFiscalPeriods.id, status: finFiscalPeriods.status })
      .from(finFiscalPeriods)
      .where(and(eq(finFiscalPeriods.companyId, scope.companyId), eq(finFiscalPeriods.code, code)))
      .for('update');
    if (!row) throw new Error('fin period vanished');
    return row;
  }

  /** The month's latest event is of this action (a close that already happened). */
  private async hasEvent(
    tx: FinTx,
    scope: CompanyScope,
    periodId: number,
    action: FinPeriodAction,
  ): Promise<boolean> {
    const [latest] = await tx
      .select({ action: finPeriodEvents.action })
      .from(finPeriodEvents)
      .where(
        and(eq(finPeriodEvents.companyId, scope.companyId), eq(finPeriodEvents.periodId, periodId)),
      )
      .orderBy(desc(finPeriodEvents.id))
      .limit(1);
    return latest?.action === action;
  }

  private async event(
    tx: FinTx,
    ctx: FinCallContext,
    scope: CompanyScope,
    periodId: number,
    action: FinPeriodAction,
    reason: string | null,
    checks: FinCloseCheck[],
  ): Promise<void> {
    await tx.insert(finPeriodEvents).values({
      companyId: scope.companyId,
      periodId,
      action,
      reason,
      checks,
      actorKind: ctx.actor.kind,
      actorRef: ctx.actor.ref,
      actorLabel: ctx.actor.label,
      requestId: ctx.requestId,
    });
  }

  private async one(ctx: FinCallContext, company: string, code: string): Promise<FinPeriodView> {
    const found = (await this.periods(ctx, { company })).find((row) => row.code === code);
    if (!found) throw new Error('fin period vanished');
    return found;
  }
}

const eventColumns = {
  id: finPeriodEvents.id,
  periodId: finPeriodEvents.periodId,
  period: finFiscalPeriods.code,
  action: finPeriodEvents.action,
  reason: finPeriodEvents.reason,
  checks: finPeriodEvents.checks,
  actorLabel: finPeriodEvents.actorLabel,
  createdAt: finPeriodEvents.createdAt,
};

function eventView(row: {
  id: number;
  period: string;
  action: FinPeriodAction;
  reason: string | null;
  checks: unknown;
  actorLabel: string;
  createdAt: Date;
}): FinPeriodEventView {
  return {
    id: row.id,
    period: row.period,
    action: row.action,
    reason: row.reason,
    checks: row.checks,
    actorLabel: row.actorLabel,
    createdAt: row.createdAt,
  };
}
