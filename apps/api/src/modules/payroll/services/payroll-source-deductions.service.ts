import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import mn from '@tugeel/shared/i18n/mn.json';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { type Actor, actorUserId, type AuthContext, AuditService } from '../../identity';
import { assertMonth, lockMonth } from '../payroll-month';
import { assertPayroll, PAYROLL_MANAGE, PAYROLL_VIEW } from '../payroll.rights';
import {
  payrollLines,
  payrollRuns,
  payrollSourceDeductions,
  payrollSourceSettlements,
} from '../schema';

type SourceRow = typeof payrollSourceDeductions.$inferSelect;
type RunRow = typeof payrollRuns.$inferSelect;
export type PayrollSourceKind = SourceRow['sourceKind'];
export type PayrollSourceState =
  'NEEDS_MONTH' | 'WAITING_RUN' | 'MONTH_CLOSED' | 'MISSING_LINE' | 'READY' | 'SETTLED';
export const EXPIRY_DEDUCTION_LABEL = mn.payroll.web.sourceDeductions.title;

/** Trusted module port only. The caller owns pricing, VAT and the frozen liable employee list. */
export interface PayrollSourceDeductionInput {
  sourceKind: PayrollSourceKind;
  sourceKey: string;
  sourceReference: string;
  requestedMonth: string | null;
  reversesSourceKey?: string;
  allocations: readonly { userId: number; amount: string }[];
}

/** Safe on an employee's own payslip: no purchase price, receipt cost or other employee. */
export interface PayrollSourcePayslipEntry {
  id: number;
  name: string;
  sourceKind: PayrollSourceKind;
  sourceReference: string;
  amount: string;
}

export interface PayrollSourceDeductionView extends PayrollSourcePayslipEntry {
  sourceKey: string;
  userId: number;
  requestedMonth: string | null;
  assignedMonth: string | null;
  reversesId: number | null;
  state: PayrollSourceState;
  createdAt: Date;
  settlements: {
    id: number;
    runId: number;
    amount: string;
    createdAt: Date;
    releasedAt: Date | null;
  }[];
}

export interface PayrollSourceFilter {
  sourceReference?: string;
  sourceKey?: string;
  userId?: number;
  month?: string;
  pendingOnly?: boolean;
}

const ZERO = new Decimal(0);
const sum = (values: readonly Decimal[]) =>
  values.reduce((total, value) => total.plus(value), ZERO);
const unsettledSource = sql`NOT EXISTS (SELECT 1 FROM ${payrollSourceSettlements} WHERE ${payrollSourceSettlements.deductionId} = ${payrollSourceDeductions.id} AND ${payrollSourceSettlements.releasedAt} IS NULL)`;

/**
 * Durable source obligations. Month locks serialize every projection/settlement with payroll.
 * A source gate precedes source/month locks, including repeated calls in a multi-line sale.
 * Run writers acquire only their month lock, so approval never waits for a source gate.
 * Sources and approval history outlive disposable draft lines and never become manual adjustments.
 */
@Injectable()
export class PayrollSourceDeductionsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Commerce prelocks the whole batch before expiry financial row locks (and follows its
   * existing stock lock order). Repeated calls in the same transaction are reentrant. */
  async lockInTx(tx: Tx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${72_026_239}, ${1})`);
  }

  async recordInTx(
    tx: Tx,
    actor: Actor,
    input: PayrollSourceDeductionInput,
  ): Promise<PayrollSourceDeductionView[]> {
    const wanted = normalizeSource(input);
    const keys = [
      ...new Set([wanted.sourceKey, wanted.reversesSourceKey ?? wanted.sourceKey]),
    ].sort();
    for (const key of keys) await this.lockSource(tx, key);
    const existing = await tx
      .select()
      .from(payrollSourceDeductions)
      .where(
        and(
          eq(payrollSourceDeductions.sourceKind, wanted.sourceKind),
          eq(payrollSourceDeductions.sourceKey, wanted.sourceKey),
        ),
      )
      .orderBy(asc(payrollSourceDeductions.userId));
    const originals =
      wanted.sourceKind === 'EXPIRY_RETURN'
        ? await tx
            .select()
            .from(payrollSourceDeductions)
            .where(
              and(
                eq(payrollSourceDeductions.sourceKind, 'EXPIRY_SALE'),
                eq(payrollSourceDeductions.sourceKey, wanted.reversesSourceKey!),
              ),
            )
        : [];
    const originalByUser = new Map(originals.map((row) => [row.userId, row]));
    if (existing.length) {
      const matches =
        existing.length === wanted.allocations.length &&
        existing.every((row, index) => {
          const allocation = wanted.allocations[index];
          return (
            allocation &&
            allocation.userId === row.userId &&
            row.amount.eq(allocation.amount) &&
            row.sourceReference === wanted.sourceReference &&
            row.requestedMonth === wanted.requestedMonth &&
            row.reversesId === (originalByUser.get(row.userId)?.id ?? null)
          );
        });
      if (!matches)
        throw new AppError('DOC_STATE_INVALID', 'source replay payload differs', {
          sourceKind: wanted.sourceKind,
          sourceKey: wanted.sourceKey,
        });
      return this.views(tx, existing);
    }
    if (wanted.sourceKind === 'EXPIRY_RETURN') {
      for (const allocation of wanted.allocations) {
        const original = originalByUser.get(allocation.userId);
        if (!original)
          throw invalid(
            'allocations',
            'sourceExists',
            'a return must reverse its original employee allocation',
          );
        const previous = await tx
          .select({ amount: payrollSourceDeductions.amount })
          .from(payrollSourceDeductions)
          .where(eq(payrollSourceDeductions.reversesId, original.id));
        if (
          original.amount
            .plus(sum(previous.map((row) => row.amount)))
            .plus(allocation.amount)
            .lt(0)
        )
          throw invalid(
            'allocations',
            'notOverReversed',
            'a return cannot exceed its original allocation',
          );
      }
    }
    // Read settlement state only after the original month is locked: approval can race a return.
    await this.lockMonths(tx, [
      wanted.requestedMonth,
      ...originals.map((row) => row.assignedMonth),
    ]);
    const active = originals.length
      ? await tx
          .select({ deductionId: payrollSourceSettlements.deductionId })
          .from(payrollSourceSettlements)
          .where(
            and(
              inArray(
                payrollSourceSettlements.deductionId,
                originals.map((row) => row.id),
              ),
              isNull(payrollSourceSettlements.releasedAt),
            ),
          )
      : [];
    const settledIds = new Set(active.map((row) => row.deductionId));
    const rows = await tx
      .insert(payrollSourceDeductions)
      .values(
        wanted.allocations.map((allocation) => {
          const original = originalByUser.get(allocation.userId);
          return {
            sourceKind: wanted.sourceKind,
            sourceKey: wanted.sourceKey,
            sourceReference: wanted.sourceReference,
            userId: allocation.userId,
            amount: new Decimal(allocation.amount),
            requestedMonth: wanted.requestedMonth,
            assignedMonth: original
              ? settledIds.has(original.id)
                ? null
                : original.assignedMonth
              : wanted.requestedMonth,
            reversesId: original?.id ?? null,
            createdBy: actorUserId(actor),
            assignedBy: actorUserId(actor),
          };
        }),
      )
      .returning();
    for (const row of rows) await this.projectDelta(tx, row, 1);
    await this.audit.record(tx, actor, {
      action: 'CREATE',
      entity: 'payroll_source_deduction',
      entityId: rows[0]!.id,
      after: {
        sourceKind: wanted.sourceKind,
        sourceKey: wanted.sourceKey,
        sourceIds: rows.map((row) => row.id),
        requestedMonth: wanted.requestedMonth,
      },
    });
    return this.views(tx, rows);
  }

  async list(
    ctx: AuthContext,
    filter: PayrollSourceFilter = {},
  ): Promise<PayrollSourceDeductionView[]> {
    assertPayroll(ctx, PAYROLL_VIEW);
    if (filter.month !== undefined) assertMonth(filter.month);
    const rows = await this.db
      .select()
      .from(payrollSourceDeductions)
      .where(
        and(
          filter.sourceReference === undefined
            ? undefined
            : eq(payrollSourceDeductions.sourceReference, filter.sourceReference),
          filter.sourceKey === undefined
            ? undefined
            : eq(payrollSourceDeductions.sourceKey, filter.sourceKey),
          filter.userId === undefined
            ? undefined
            : eq(payrollSourceDeductions.userId, filter.userId),
          filter.month === undefined
            ? undefined
            : eq(payrollSourceDeductions.assignedMonth, filter.month),
          filter.pendingOnly ? unsettledSource : undefined,
        ),
      )
      .orderBy(desc(payrollSourceDeductions.id))
      .limit(2000);
    return this.views(this.db, rows);
  }

  /** Move the employee's pending sale and its pending reversals together. Settled rows never move. */
  async assignMonth(
    ctx: AuthContext,
    id: number,
    month: string,
  ): Promise<PayrollSourceDeductionView[]> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    assertMonth(month);
    return inTransaction(this.db, async (tx) => {
      const [found] = await tx
        .select()
        .from(payrollSourceDeductions)
        .where(eq(payrollSourceDeductions.id, id));
      if (!found) throw notFound('payroll source deduction', id);
      const [root] =
        found.reversesId === null
          ? [found]
          : await tx
              .select()
              .from(payrollSourceDeductions)
              .where(eq(payrollSourceDeductions.id, found.reversesId));
      if (!root) throw notFound('payroll source deduction', found.reversesId!);
      await this.lockSource(tx, root.sourceKey);
      const groupWhere = and(
        eq(payrollSourceDeductions.userId, found.userId),
        or(
          eq(payrollSourceDeductions.id, root.id),
          eq(payrollSourceDeductions.reversesId, root.id),
        ),
      );
      const before = await tx
        .select()
        .from(payrollSourceDeductions)
        .where(and(groupWhere, unsettledSource));
      await this.lockMonths(tx, [month, ...before.map((row) => row.assignedMonth)]);
      const [closed] = await tx
        .select()
        .from(payrollRuns)
        .where(and(eq(payrollRuns.month, month), eq(payrollRuns.status, 'APPROVED')));
      if (closed)
        throw new AppError('DOC_STATE_INVALID', 'chosen payroll month is approved', {
          month,
          status: closed.status,
        });
      // Approval may have settled the requested row while this transaction waited for its month.
      const rows = await tx
        .select()
        .from(payrollSourceDeductions)
        .where(and(groupWhere, unsettledSource));
      if (!rows.some((row) => row.id === id))
        throw new AppError('DOC_STATE_INVALID', 'a settled source cannot be reassigned', {
          id,
          status: 'SETTLED',
        });
      for (const row of rows) {
        if (row.assignedMonth === month) continue;
        await this.projectDelta(tx, row, -1);
        await tx
          .update(payrollSourceDeductions)
          .set({ assignedMonth: month, assignedBy: ctx.userId, assignedAt: sql`now()` })
          .where(eq(payrollSourceDeductions.id, row.id));
        await this.projectDelta(tx, { ...row, assignedMonth: month }, 1);
      }
      await this.audit.record(tx, ctx, {
        action: 'ASSIGN_MONTH',
        entity: 'payroll_source_deduction',
        entityId: id,
        after: { month, sourceIds: rows.map((row) => row.id) },
      });
      return this.views(
        tx,
        rows.map((row) => ({ ...row, assignedMonth: month })),
      );
    });
  }

  /** Called under the run's month lock. Positive deductions and negative refunds stay untaxed. */
  async totalsInTx(
    tx: Tx,
    month: string,
    userId: number,
  ): Promise<{ deductions: Decimal; refunds: Decimal }> {
    const rows = await tx
      .select({ amount: payrollSourceDeductions.amount })
      .from(payrollSourceDeductions)
      .where(
        and(
          eq(payrollSourceDeductions.assignedMonth, month),
          eq(payrollSourceDeductions.userId, userId),
          unsettledSource,
        ),
      );
    return {
      deductions: sum(rows.filter((row) => row.amount.gt(0)).map((row) => row.amount)),
      refunds: sum(rows.filter((row) => row.amount.lt(0)).map((row) => row.amount.negated())),
    };
  }

  async settleInTx(tx: Tx, actor: Actor, run: RunRow): Promise<void> {
    const rows = await tx
      .select({ source: payrollSourceDeductions })
      .from(payrollSourceDeductions)
      .innerJoin(
        payrollLines,
        and(
          eq(payrollLines.runId, run.id),
          eq(payrollLines.userId, payrollSourceDeductions.userId),
        ),
      )
      .where(and(eq(payrollSourceDeductions.assignedMonth, run.month), unsettledSource));
    if (!rows.length) return;
    await tx.insert(payrollSourceSettlements).values(
      rows.map(({ source }) => ({
        deductionId: source.id,
        runId: run.id,
        amount: source.amount,
        createdBy: actorUserId(actor),
      })),
    );
    await this.audit.record(tx, actor, {
      action: 'SETTLE',
      entity: 'payroll_source_deduction',
      entityId: rows[0]!.source.id,
      after: { runId: run.id, month: run.month, sourceIds: rows.map(({ source }) => source.id) },
    });
  }

  /** The run must already be DRAFT. History remains, and a later approval creates new rows. */
  async releaseInTx(tx: Tx, actor: Actor, run: RunRow): Promise<void> {
    const released = await tx
      .update(payrollSourceSettlements)
      .set({ releasedAt: sql`now()`, releasedBy: actorUserId(actor) })
      .where(
        and(
          eq(payrollSourceSettlements.runId, run.id),
          isNull(payrollSourceSettlements.releasedAt),
        ),
      )
      .returning({ id: payrollSourceSettlements.id });
    if (released.length)
      await this.audit.record(tx, actor, {
        action: 'RELEASE',
        entity: 'payroll_source_settlement',
        entityId: released[0]!.id,
        after: { runId: run.id, month: run.month, settlementIds: released.map((row) => row.id) },
      });
  }

  async payslipEntries(
    executor: Db | Tx,
    run: RunRow,
    userIds: readonly number[],
  ): Promise<(PayrollSourcePayslipEntry & { userId: number })[]> {
    if (!userIds.length) return [];
    const rows =
      run.status === 'APPROVED'
        ? await executor
            .select({ source: payrollSourceDeductions })
            .from(payrollSourceDeductions)
            .innerJoin(
              payrollSourceSettlements,
              and(
                eq(payrollSourceSettlements.deductionId, payrollSourceDeductions.id),
                eq(payrollSourceSettlements.runId, run.id),
                isNull(payrollSourceSettlements.releasedAt),
              ),
            )
            .where(inArray(payrollSourceDeductions.userId, [...userIds]))
            .orderBy(asc(payrollSourceDeductions.id))
        : await executor
            .select({ source: payrollSourceDeductions })
            .from(payrollSourceDeductions)
            .where(
              and(
                eq(payrollSourceDeductions.assignedMonth, run.month),
                inArray(payrollSourceDeductions.userId, [...userIds]),
                unsettledSource,
              ),
            )
            .orderBy(asc(payrollSourceDeductions.id));
    return rows.map(({ source }) => ({ ...brief(source), userId: source.userId }));
  }

  private async lockSource(tx: Tx, key: string): Promise<void> {
    // A commerce transaction can call this port for several sale lines after its first month
    // lock. Serialize source batches before their first lock to avoid a month/source inversion
    // against another multi-line sale or a month reassignment. Ordinary payroll stays independent.
    await this.lockInTx(tx);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${'payroll-source:' + key}, 0))`,
    );
  }

  private async lockMonths(tx: Tx, months: readonly (string | null)[]): Promise<void> {
    for (const month of [
      ...new Set(months.filter((value): value is string => value !== null)),
    ].sort())
      await lockMonth(tx, month);
  }

  /** Delta only changes net deductions/refunds. Gross, SI and PIT never change here. */
  private async projectDelta(tx: Tx, row: SourceRow, direction: 1 | -1): Promise<void> {
    if (!row.assignedMonth) return;
    const [run] = await tx
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.month, row.assignedMonth));
    if (!run || run.status !== 'DRAFT') return;
    const debt = Decimal.max(row.amount, 0).mul(direction);
    const refund = Decimal.max(row.amount.negated(), 0).mul(direction);
    await tx
      .update(payrollLines)
      .set({
        deductions: sql`${payrollLines.deductions} + ${debt.toFixed(2)}::numeric`,
        otherAdditions: sql`${payrollLines.otherAdditions} + ${refund.toFixed(2)}::numeric`,
        net: sql`${payrollLines.net} - ${row.amount.mul(direction).toFixed(2)}::numeric`,
        updatedAt: sql`now()`,
      })
      .where(and(eq(payrollLines.runId, run.id), eq(payrollLines.userId, row.userId)));
  }

  private async views(
    executor: Db | Tx,
    rows: readonly SourceRow[],
  ): Promise<PayrollSourceDeductionView[]> {
    if (!rows.length) return [];
    const settlements = await executor
      .select()
      .from(payrollSourceSettlements)
      .where(
        inArray(
          payrollSourceSettlements.deductionId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(payrollSourceSettlements.id));
    const months = [
      ...new Set(rows.flatMap((row) => (row.assignedMonth ? [row.assignedMonth] : []))),
    ];
    const runs = months.length
      ? await executor.select().from(payrollRuns).where(inArray(payrollRuns.month, months))
      : [];
    const lines = runs.length
      ? await executor
          .select({ runId: payrollLines.runId, userId: payrollLines.userId })
          .from(payrollLines)
          .where(
            and(
              inArray(
                payrollLines.runId,
                runs.map((run) => run.id),
              ),
              inArray(
                payrollLines.userId,
                rows.map((row) => row.userId),
              ),
            ),
          )
      : [];
    return rows.map((row) => {
      const history = settlements.filter((settlement) => settlement.deductionId === row.id);
      const run = runs.find((entry) => entry.month === row.assignedMonth);
      const state: PayrollSourceState = history.some((entry) => entry.releasedAt === null)
        ? 'SETTLED'
        : row.assignedMonth === null
          ? 'NEEDS_MONTH'
          : !run
            ? 'WAITING_RUN'
            : run.status === 'APPROVED'
              ? 'MONTH_CLOSED'
              : !lines.some((line) => line.runId === run.id && line.userId === row.userId)
                ? 'MISSING_LINE'
                : 'READY';
      return {
        ...brief(row),
        sourceKey: row.sourceKey,
        userId: row.userId,
        requestedMonth: row.requestedMonth,
        assignedMonth: row.assignedMonth,
        reversesId: row.reversesId,
        state,
        createdAt: row.createdAt,
        settlements: history.map((entry) => ({
          id: entry.id,
          runId: entry.runId,
          amount: entry.amount.toFixed(2),
          createdAt: entry.createdAt,
          releasedAt: entry.releasedAt,
        })),
      };
    });
  }
}

function brief(row: SourceRow): PayrollSourcePayslipEntry {
  return {
    id: row.id,
    name: EXPIRY_DEDUCTION_LABEL,
    sourceKind: row.sourceKind,
    sourceReference: row.sourceReference,
    amount: row.amount.toFixed(2),
  };
}

function normalizeSource(input: PayrollSourceDeductionInput): PayrollSourceDeductionInput {
  if (input.sourceKind !== 'EXPIRY_SALE' && input.sourceKind !== 'EXPIRY_RETURN')
    throw invalid('sourceKind', 'isIn', 'EXPIRY_SALE or EXPIRY_RETURN');
  for (const [path, value] of [
    ['sourceKey', input.sourceKey],
    ['sourceReference', input.sourceReference],
  ] as const) {
    if (
      typeof value !== 'string' ||
      value.trim() !== value ||
      !value.length ||
      [...value].length > 160
    )
      throw invalid(path, 'length', '1 to 160 trimmed characters');
  }
  if (input.requestedMonth !== null) assertMonth(input.requestedMonth, 'requestedMonth');
  if (input.sourceKind === 'EXPIRY_RETURN') {
    if (
      !input.reversesSourceKey ||
      input.reversesSourceKey.trim() !== input.reversesSourceKey ||
      [...input.reversesSourceKey].length > 160
    )
      throw invalid('reversesSourceKey', 'isNotEmpty', 'an original sale source key is required');
  } else if (input.reversesSourceKey !== undefined)
    throw invalid('reversesSourceKey', 'isEmpty', 'only a return reverses a source');
  if (!input.allocations.length || input.allocations.length > 500)
    throw invalid('allocations', 'arraySize', '1 to 500 employee allocations');
  const seen = new Set<number>();
  const allocations = input.allocations
    .map((entry) => {
      if (!Number.isSafeInteger(entry.userId) || entry.userId <= 0 || seen.has(entry.userId))
        throw invalid('allocations.userId', 'unique', 'unique positive employee IDs');
      seen.add(entry.userId);
      if (typeof entry.amount !== 'string' || !/^-?\d{1,12}(?:\.\d{1,2})?$/.test(entry.amount))
        throw invalid('allocations.amount', 'isMoney', 'finite money with at most two decimals');
      const amount = new Decimal(entry.amount);
      if (!amount.isFinite() || (input.sourceKind === 'EXPIRY_SALE' ? amount.lt(0) : amount.gt(0)))
        throw invalid(
          'allocations.amount',
          'sign',
          'sale debt is positive and return credit is negative',
        );
      return { userId: entry.userId, amount: amount.toFixed(2) };
    })
    .sort((a, b) => a.userId - b.userId);
  return { ...input, allocations };
}
