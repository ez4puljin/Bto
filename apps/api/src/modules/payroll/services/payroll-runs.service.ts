import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from '@tugeel/shared/money';
import {
  attendanceCounts,
  attendanceScore,
  isAutomaticKpiSource,
  isPayrollMonth,
  type KpiSource,
  kpiEarned,
  type PayrollAdjustmentKind,
  type PayrollAttendanceCounts,
  type PayrollAttendanceDay,
  PAYROLL_LIMITS,
  PAYROLL_PERCENT_PATTERN,
  type PayrollRunStatus,
  type PayrollSettings,
  payrollMonthRange,
  payslipTotals,
} from '@tugeel/shared/payroll';
import { businessDate } from '@tugeel/shared/time';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { HrReportsService } from '../../hr';
import { type AuthContext, AuditService, UserNamesService } from '../../identity';
import { amountOf, type KpiSheetItem } from '../kpi-sheet';
import { assertPayroll, PAYROLL_MANAGE, PAYROLL_SCORE } from '../payroll.rights';
import {
  payrollAdvances,
  payrollLineAdjustments,
  payrollLineItems,
  payrollLines,
  payrollRuns,
} from '../schema';
import { employedIn, PayrollPeopleService, type PayrollPerson } from './payroll-people.service';
import { PayrollSettingsService, settingsOf } from './payroll-settings.service';
import { PayrollTermsService } from './payroll-terms.service';

type RunRow = typeof payrollRuns.$inferSelect;
type LineRow = typeof payrollLines.$inferSelect;
type ItemRow = typeof payrollLineItems.$inferSelect;
type AdjustmentRow = typeof payrollLineAdjustments.$inferSelect;

export interface PayrollItemView {
  id: number;
  key: string;
  name: string;
  source: KpiSource;
  amount: string;
  /** NULL: a MANUAL item nobody scored yet. */
  scorePercent: string | null;
  /** ATTENDANCE: attended ÷ workdays, and what the late days took off. */
  basePercent: string | null;
  penaltyPercent: string | null;
  earned: string;
  note: string | null;
  scoredBy: number | null;
  scoredByName: string | null;
  scoredAt: Date | null;
}

export interface PayrollAdjustmentView {
  id: number;
  kind: PayrollAdjustmentKind;
  name: string;
  amount: string;
  taxable: boolean;
  createdAt: Date;
}

export interface PayrollAdvanceBrief {
  id: number;
  amount: string;
  paidOn: string;
  note: string | null;
}

/** One payslip. `employerSi` and `totalCost` are HR's side: the employee's own view drops them. */
export interface PayrollLineView {
  id: number;
  runId: number;
  month: string;
  runStatus: PayrollRunStatus;
  approvedAt: Date | null;
  userId: number;
  fullName: string;
  position: string | null;
  divisionName: string | null;
  baseSalary: string;
  paysSocialInsurance: boolean;
  attendanceMeasured: boolean;
  workdays: number | null;
  attendedDays: number | null;
  lateDays: number | null;
  items: PayrollItemView[];
  adjustments: PayrollAdjustmentView[];
  advances: PayrollAdvanceBrief[];
  /** MANUAL items without a score. */
  unscoredCount: number;
  kpiTotal: string;
  taxableAdditions: string;
  gross: string;
  siBase: string;
  employeeSi: string;
  pitCredit: string;
  pit: string;
  advance: string;
  otherAdditions: string;
  deductions: string;
  net: string;
  employerSi: string;
  /** Gross + the untaxed additions + the employer's insurance. */
  totalCost: string;
}

export interface PayrollRunTotals {
  baseSalary: string;
  kpiTotal: string;
  gross: string;
  employeeSi: string;
  employerSi: string;
  pit: string;
  advance: string;
  otherAdditions: string;
  deductions: string;
  net: string;
  totalCost: string;
}

export interface PayrollRunView {
  id: number;
  month: string;
  status: PayrollRunStatus;
  note: string | null;
  settings: PayrollSettings;
  attendanceTo: string | null;
  computedAt: Date;
  createdAt: Date;
  createdByName: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  reopenedAt: Date | null;
  reopenedByName: string | null;
  reopenReason: string | null;
  lineCount: number;
  unscoredCount: number;
  totals: PayrollRunTotals;
}

export interface PayrollRunDetail extends PayrollRunView {
  lines: PayrollLineView[];
}

/** What a scorer sees (ADR-0235 #10): who, which items, the scores. No amount, no pay. */
export interface PayrollScoringView {
  runId: number;
  month: string;
  status: PayrollRunStatus;
  lines: {
    lineId: number;
    userId: number;
    fullName: string;
    position: string | null;
    divisionName: string | null;
    items: {
      itemId: number;
      name: string;
      scorePercent: string | null;
      note: string | null;
      scoredByName: string | null;
      scoredAt: Date | null;
    }[];
  }[];
}

export interface PayrollScoringRun {
  runId: number;
  month: string;
  status: PayrollRunStatus;
  manualCount: number;
  unscoredCount: number;
}

export interface ScoreInput {
  itemId: number;
  /** A percent 0–100 as text, or null to take the score back. */
  scorePercent: string | null;
  note?: string | null;
}

export interface AdjustmentInput {
  kind: PayrollAdjustmentKind;
  name: string;
  amount: string;
  taxable: boolean;
}

/** What the attendance system says of one person's month; `measured` false = not tracked. */
type Attendance = { measured: true; counts: PayrollAttendanceCounts } | { measured: false };

/** Everything read outside the transaction before a run is built or recomputed. */
interface MonthFacts {
  settings: PayrollSettings;
  people: Map<number, PayrollPerson>;
  /** By user, for the tracked people the time report covers. */
  attendance: Map<number, PayrollAttendanceCounts>;
  attendanceTo: string | null;
}

/** The advisory-lock space of this module: one lock per payroll month (YYYYMM). */
const PAYROLL_LOCK_SPACE = 72_026_235;
const ZERO = new Decimal(0);
const money = (value: Decimal): string => value.toFixed(2);
const percentText = (value: Decimal | null): string | null =>
  value === null ? null : value.toString();
const sum = (values: readonly Decimal[]): Decimal =>
  values.reduce((total, value) => total.plus(value), ZERO);

/**
 * The monthly payroll runs (ADR-0235 #8): a DRAFT holds a line per employed person with active pay
 * terms — a snapshot of the salary and the KPI sheet — with the attendance score read from the time
 * report; HR and managers score the work-evaluation items; recomputing re-reads attendance,
 * advances and the rates. APPROVED freezes it (the database refuses any change of its lines);
 * reopening needs a reason. Every write of a month runs under that month's advisory lock.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly names: UserNamesService,
    private readonly reports: HrReportsService,
    private readonly people: PayrollPeopleService,
    private readonly settings: PayrollSettingsService,
    private readonly terms: PayrollTermsService,
  ) {}

  // ── reads ─────────────────────────────────────────────────────────────────

  async list(): Promise<PayrollRunView[]> {
    const runs = await this.db.select().from(payrollRuns).orderBy(desc(payrollRuns.month));
    const details = await this.details(this.db, runs);
    return details.map(({ lines: _lines, ...run }) => run);
  }

  async get(id: number): Promise<PayrollRunDetail> {
    const run = await this.runRow(this.db, id);
    const [detail] = await this.details(this.db, [run]);
    if (!detail) throw notFound('payroll run', id);
    return detail;
  }

  async line(runId: number, lineId: number): Promise<PayrollLineView> {
    const run = await this.runRow(this.db, runId);
    const [line] = await this.lineViews(this.db, [run], { lineId });
    if (!line) throw notFound('payroll line', lineId);
    return line;
  }

  /** The caller's own payslips, approved runs only (ADR-0235 #8), newest first. */
  async myPayslips(ctx: AuthContext): Promise<PayrollLineView[]> {
    const runs = await this.db
      .select()
      .from(payrollRuns)
      .where(eq(payrollRuns.status, 'APPROVED'))
      .orderBy(desc(payrollRuns.month));
    return this.lineViews(this.db, runs, { userId: ctx.userId });
  }

  async myPayslip(ctx: AuthContext, month: string): Promise<PayrollLineView> {
    assertMonth(month);
    const [run] = await this.db
      .select()
      .from(payrollRuns)
      .where(and(eq(payrollRuns.month, month), eq(payrollRuns.status, 'APPROVED')));
    const [line] = run ? await this.lineViews(this.db, [run], { userId: ctx.userId }) : [];
    // The same answer whether the month has no run, a draft, or no line for the caller.
    if (!line) throw new AppError('NOT_FOUND', `no approved payslip for ${month}`, { month });
    return line;
  }

  /** The runs a scorer may open: counts only. */
  async scoringRuns(ctx: AuthContext): Promise<PayrollScoringRun[]> {
    assertPayroll(ctx, PAYROLL_SCORE, PAYROLL_MANAGE);
    const { rows } = await this.db.execute<{
      id: string;
      month: string;
      status: PayrollRunStatus;
      manual: string;
      unscored: string;
    }>(sql`
      SELECT r.id::text, r.month, r.status,
             count(i.id)::text AS manual,
             count(i.id) FILTER (WHERE i.score_percent IS NULL)::text AS unscored
        FROM payroll_runs r
        LEFT JOIN payroll_lines l ON l.run_id = r.id
        LEFT JOIN payroll_line_items i ON i.line_id = l.id AND i.source = 'MANUAL'
       GROUP BY r.id
       ORDER BY r.month DESC`);
    return rows.map((row) => ({
      runId: Number.parseInt(row.id, 10),
      month: row.month,
      status: row.status,
      manualCount: Number.parseInt(row.manual, 10),
      unscoredCount: Number.parseInt(row.unscored, 10),
    }));
  }

  async scoring(ctx: AuthContext, runId: number): Promise<PayrollScoringView> {
    assertPayroll(ctx, PAYROLL_SCORE, PAYROLL_MANAGE);
    const run = await this.runRow(this.db, runId);
    const lines = await this.lineViews(this.db, [run], {});
    return {
      runId: run.id,
      month: run.month,
      status: run.status,
      lines: lines
        .map((line) => ({
          lineId: line.id,
          userId: line.userId,
          fullName: line.fullName,
          position: line.position,
          divisionName: line.divisionName,
          items: line.items
            .filter((item) => !isAutomaticKpiSource(item.source))
            .map((item) => ({
              itemId: item.id,
              name: item.name,
              scorePercent: item.scorePercent,
              note: item.note,
              scoredByName: item.scoredByName,
              scoredAt: item.scoredAt,
            })),
        }))
        .filter((line) => line.items.length > 0),
    };
  }

  // ── writes ────────────────────────────────────────────────────────────────

  /** Builds the month's DRAFT: a line per employed person with active terms. */
  async create(
    ctx: AuthContext,
    input: { month: string; note: string | null },
  ): Promise<PayrollRunDetail> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    assertMonth(input.month);
    if (input.month > businessDate().slice(0, 7)) {
      throw invalid('month', 'notFuture', 'a run is made for this month or an earlier one');
    }
    const note = cleanNote('note', input.note);
    const facts = await this.facts(input.month);
    const id = await inTransaction(this.db, async (tx) => {
      await lockMonth(tx, input.month);
      const [taken] = await tx
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(eq(payrollRuns.month, input.month));
      if (taken) {
        throw new AppError('DUPLICATE_VALUE', `a payroll run for ${input.month} exists`, {
          field: 'month',
          id: taken.id,
        });
      }
      const [run] = await tx
        .insert(payrollRuns)
        .values({
          month: input.month,
          note,
          settings: facts.settings,
          attendanceTo: facts.attendanceTo,
          createdBy: ctx.userId,
        })
        .returning();
      if (!run) throw new Error('payroll run insert returned no row');
      const changed = await this.syncTermsInTx(tx, run, facts);
      await this.computeRunInTx(tx, run, facts);
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'payroll_run',
        entityId: run.id,
        after: { month: run.month, note, lines: changed.added.length, settings: facts.settings },
      });
      return run.id;
    });
    return this.get(id);
  }

  /**
   * Recomputes a DRAFT: attendance, advances and the rates are read again. With `refreshTerms` the
   * snapshot follows the terms as they are now — salaries, items and who is on the run — and an
   * item that is still on the sheet keeps its score.
   */
  async recompute(ctx: AuthContext, id: number, refreshTerms: boolean): Promise<PayrollRunDetail> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const { month } = await this.runRow(this.db, id);
    const facts = await this.facts(month);
    await inTransaction(this.db, async (tx) => {
      const run = await this.draftInTx(tx, id);
      const changed = refreshTerms
        ? await this.syncTermsInTx(tx, run, facts)
        : { added: [], removed: [] };
      await tx
        .update(payrollRuns)
        .set({ settings: facts.settings, attendanceTo: facts.attendanceTo, computedAt: sql`now()` })
        .where(eq(payrollRuns.id, id));
      await this.computeRunInTx(tx, run, facts);
      await this.audit.record(tx, ctx, {
        action: 'RECOMPUTE',
        entity: 'payroll_run',
        entityId: id,
        after: { refreshTerms, ...changed, settings: facts.settings },
      });
    });
    return this.get(id);
  }

  /** Scores MANUAL items of a DRAFT (ADR-0235 #4): a percent 0–100 with an optional note. */
  async score(
    ctx: AuthContext,
    id: number,
    scores: readonly ScoreInput[],
  ): Promise<PayrollScoringView> {
    assertPayroll(ctx, PAYROLL_SCORE, PAYROLL_MANAGE);
    if (scores.length === 0) throw invalid('scores', 'arrayNotEmpty', 'at least one score');
    if (scores.length > PAYROLL_LIMITS.maxScores) {
      throw invalid('scores', 'arrayMaxSize', `at most ${PAYROLL_LIMITS.maxScores} scores`);
    }
    const wanted = scores.map((entry, index) => {
      if (entry.scorePercent !== null && !PAYROLL_PERCENT_PATTERN.test(entry.scorePercent)) {
        throw invalid(`scores[${index}].scorePercent`, 'isPercent', '0 to 100, two decimals');
      }
      return {
        itemId: entry.itemId,
        scorePercent: entry.scorePercent === null ? null : new Decimal(entry.scorePercent),
        note: cleanNote(`scores[${index}].note`, entry.note ?? null),
      };
    });
    if (new Set(wanted.map((entry) => entry.itemId)).size !== wanted.length) {
      throw invalid('scores', 'unique', 'an item is scored once in a request');
    }
    await inTransaction(this.db, async (tx) => {
      const run = await this.draftInTx(tx, id);
      const items = await tx
        .select({ item: payrollLineItems, line: payrollLines })
        .from(payrollLineItems)
        .innerJoin(payrollLines, eq(payrollLines.id, payrollLineItems.lineId))
        .where(
          and(
            eq(payrollLines.runId, id),
            inArray(
              payrollLineItems.id,
              wanted.map((entry) => entry.itemId),
            ),
          ),
        );
      const found = new Map(items.map((row) => [row.item.id, row]));
      const touched = new Map<number, LineRow>();
      for (const [index, entry] of wanted.entries()) {
        const row = found.get(entry.itemId);
        if (!row) {
          throw invalid(
            `scores[${index}].itemId`,
            'exists',
            `item ${entry.itemId} is not on this run`,
          );
        }
        if (isAutomaticKpiSource(row.item.source)) {
          throw invalid(
            `scores[${index}].itemId`,
            'manualOnly',
            'the attendance item is scored by the attendance system',
          );
        }
        await tx
          .update(payrollLineItems)
          .set({
            scorePercent: entry.scorePercent,
            note: entry.note,
            scoredBy: entry.scorePercent === null ? null : ctx.userId,
            scoredAt: entry.scorePercent === null ? null : sql`now()`,
          })
          .where(eq(payrollLineItems.id, entry.itemId));
        await this.audit.record(tx, ctx, {
          action: 'SCORE',
          entity: 'payroll_line_item',
          entityId: entry.itemId,
          before: { scorePercent: row.item.scorePercent, note: row.item.note },
          after: { scorePercent: entry.scorePercent, note: entry.note, userId: row.line.userId },
        });
        touched.set(row.line.id, row.line);
      }
      for (const line of touched.values()) {
        await this.computeLineInTx(tx, run.month, line, settingsOf(run.settings));
      }
    });
    return this.scoring(ctx, id);
  }

  async addAdjustment(
    ctx: AuthContext,
    runId: number,
    lineId: number,
    input: AdjustmentInput,
  ): Promise<PayrollLineView> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const name = input.name.trim();
    if (name.length === 0) throw invalid('name', 'isNotEmpty', 'a line needs a name');
    if ([...name].length > PAYROLL_LIMITS.maxName) {
      throw invalid('name', 'maxLength', `at most ${PAYROLL_LIMITS.maxName} characters`);
    }
    const amount = amountOf('amount', input.amount);
    if (amount.lte(0)) throw invalid('amount', 'isPositive', 'an amount above zero');
    if (input.kind === 'DEDUCTION' && input.taxable) {
      throw invalid('taxable', 'additionOnly', 'only an addition is taxed with the pay');
    }
    await inTransaction(this.db, async (tx) => {
      const run = await this.draftInTx(tx, runId);
      const line = await this.lineInTx(tx, runId, lineId);
      const [row] = await tx
        .insert(payrollLineAdjustments)
        .values({
          lineId,
          kind: input.kind,
          name,
          amount,
          taxable: input.taxable,
          createdBy: ctx.userId,
        })
        .returning({ id: payrollLineAdjustments.id });
      if (!row) throw new Error('adjustment insert returned no row');
      await this.audit.record(tx, ctx, {
        action: 'CREATE',
        entity: 'payroll_line_adjustment',
        entityId: row.id,
        after: {
          lineId,
          userId: line.userId,
          kind: input.kind,
          name,
          amount,
          taxable: input.taxable,
        },
      });
      await this.computeLineInTx(tx, run.month, line, settingsOf(run.settings));
    });
    return this.line(runId, lineId);
  }

  async removeAdjustment(
    ctx: AuthContext,
    runId: number,
    lineId: number,
    adjustmentId: number,
  ): Promise<PayrollLineView> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    await inTransaction(this.db, async (tx) => {
      const run = await this.draftInTx(tx, runId);
      const line = await this.lineInTx(tx, runId, lineId);
      const [before] = await tx
        .select()
        .from(payrollLineAdjustments)
        .where(
          and(
            eq(payrollLineAdjustments.id, adjustmentId),
            eq(payrollLineAdjustments.lineId, lineId),
          ),
        );
      if (!before) throw notFound('payroll adjustment', adjustmentId);
      await tx.delete(payrollLineAdjustments).where(eq(payrollLineAdjustments.id, adjustmentId));
      await this.audit.record(tx, ctx, {
        action: 'DELETE',
        entity: 'payroll_line_adjustment',
        entityId: adjustmentId,
        before: {
          lineId,
          userId: line.userId,
          kind: before.kind,
          name: before.name,
          amount: before.amount,
          taxable: before.taxable,
        },
      });
      await this.computeLineInTx(tx, run.month, line, settingsOf(run.settings));
    });
    return this.line(runId, lineId);
  }

  /** Freezes the run: every MANUAL item must be scored first. */
  async approve(ctx: AuthContext, id: number): Promise<PayrollRunDetail> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    await inTransaction(this.db, async (tx) => {
      const run = await this.draftInTx(tx, id);
      const lines = await this.lineViews(tx, [run], {});
      if (lines.length === 0) {
        throw new AppError('DOC_STATE_INVALID', 'a run without lines is not approved', {
          status: run.status,
          lines: 0,
        });
      }
      const unscored = lines.reduce((count, line) => count + line.unscoredCount, 0);
      if (unscored > 0) {
        throw new AppError('DOC_STATE_INVALID', `${unscored} KPI items are not scored`, {
          status: run.status,
          unscored,
        });
      }
      await tx
        .update(payrollRuns)
        .set({ status: 'APPROVED', approvedBy: ctx.userId, approvedAt: sql`now()` })
        .where(eq(payrollRuns.id, id));
      await this.audit.record(tx, ctx, {
        action: 'APPROVE',
        entity: 'payroll_run',
        entityId: id,
        after: { month: run.month, lines: lines.length, totals: totalsOf(lines) },
      });
    });
    return this.get(id);
  }

  /** Back to DRAFT, with a reason (ADR-0235 #8). */
  async reopen(ctx: AuthContext, id: number, reason: string): Promise<PayrollRunDetail> {
    assertPayroll(ctx, PAYROLL_MANAGE);
    const text = cleanNote('reason', reason);
    if (text === null) throw invalid('reason', 'isNotEmpty', 'reopening needs a reason');
    await inTransaction(this.db, async (tx) => {
      const run = await this.lockedInTx(tx, id);
      if (run.status !== 'APPROVED') {
        throw new AppError('DOC_STATE_INVALID', `payroll run ${id} is ${run.status}`, {
          status: run.status,
        });
      }
      await tx
        .update(payrollRuns)
        .set({
          status: 'DRAFT',
          approvedBy: null,
          approvedAt: null,
          reopenedBy: ctx.userId,
          reopenedAt: sql`now()`,
          reopenReason: text,
        })
        .where(eq(payrollRuns.id, id));
      await this.audit.record(tx, ctx, {
        action: 'REOPEN',
        entity: 'payroll_run',
        entityId: id,
        before: { approvedBy: run.approvedBy, approvedAt: run.approvedAt },
        after: { month: run.month, reason: text },
      });
    });
    return this.get(id);
  }

  /**
   * For the advances (same transaction, the month's lock held by the caller): refuses when the
   * month's run is APPROVED, and brings the person's DRAFT line up to the advances as they now are.
   */
  async advanceChangedInTx(tx: Tx, month: string, userId: number): Promise<void> {
    const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.month, month));
    if (!run) return;
    if (run.status === 'APPROVED') {
      throw new AppError('DOC_STATE_INVALID', `the payroll of ${month} is approved`, {
        status: run.status,
        month,
      });
    }
    const [line] = await tx
      .select()
      .from(payrollLines)
      .where(and(eq(payrollLines.runId, run.id), eq(payrollLines.userId, userId)));
    if (line) await this.computeLineInTx(tx, month, line, settingsOf(run.settings));
  }

  // ── inside ────────────────────────────────────────────────────────────────

  /** The rates, the staff and the month's attendance, read before the transaction opens. */
  private async facts(month: string): Promise<MonthFacts> {
    const range = payrollMonthRange(month);
    const today = businessDate();
    const [settings, people, report] = await Promise.all([
      this.settings.get(),
      this.people.byId(),
      range.from > today
        ? Promise.resolve({ rows: [] })
        : this.reports.days({ from: range.from, to: range.to }),
    ]);
    const days = new Map<number, PayrollAttendanceDay[]>();
    for (const row of report.rows) {
      const list = days.get(row.userId) ?? [];
      list.push({
        status: row.status,
        // A day the schedule plans: it asks for minutes, or the report already calls it missed.
        planned: row.scheduledMinutes > 0 || row.status === 'ABSENT',
        lateMinutes: row.lateMinutes,
      });
      days.set(row.userId, list);
    }
    return {
      settings,
      people,
      attendance: new Map([...days].map(([userId, list]) => [userId, attendanceCounts(list)])),
      attendanceTo: range.from > today ? null : range.to > today ? today : range.to,
    };
  }

  private attendanceOf(facts: MonthFacts, userId: number): Attendance {
    const person = facts.people.get(userId);
    if (person && !person.tracked) return { measured: false };
    return {
      measured: true,
      counts: facts.attendance.get(userId) ?? { workdays: 0, attendedDays: 0, lateDays: 0 },
    };
  }

  /**
   * Brings the run's lines to the terms as they are: adds the people who belong on the month and
   * have none, removes those who no longer do, and rewrites each snapshot, an item keeping its
   * score by its key. Returns who came and went, for the audit.
   */
  private async syncTermsInTx(
    tx: Tx,
    run: RunRow,
    facts: MonthFacts,
  ): Promise<{ added: number[]; removed: number[] }> {
    const range = payrollMonthRange(run.month);
    const terms = await this.terms.activeByUser(tx);
    const lines = await tx.select().from(payrollLines).where(eq(payrollLines.runId, run.id));
    const byUser = new Map(lines.map((line) => [line.userId, line]));
    const added: number[] = [];
    const removed: number[] = [];
    for (const line of lines) {
      const person = facts.people.get(line.userId);
      if (terms.has(line.userId) && person && employedIn(person, range.from, range.to)) continue;
      await tx.delete(payrollLineItems).where(eq(payrollLineItems.lineId, line.id));
      await tx.delete(payrollLineAdjustments).where(eq(payrollLineAdjustments.lineId, line.id));
      await tx.delete(payrollLines).where(eq(payrollLines.id, line.id));
      byUser.delete(line.userId);
      removed.push(line.userId);
    }
    const userIds = [...terms.keys()].sort((a, b) => a - b);
    for (const userId of userIds) {
      const person = facts.people.get(userId);
      const own = terms.get(userId);
      if (!person || !own || !employedIn(person, range.from, range.to)) continue;
      const snapshot = {
        fullName: person.fullName,
        position: person.position,
        divisionName: person.divisionName,
        baseSalary: new Decimal(own.baseSalary),
        paysSocialInsurance: own.paysSocialInsurance,
      };
      let line = byUser.get(userId);
      if (line) {
        await tx
          .update(payrollLines)
          .set({ ...snapshot, updatedAt: sql`now()` })
          .where(eq(payrollLines.id, line.id));
      } else {
        [line] = await tx
          .insert(payrollLines)
          .values({
            runId: run.id,
            userId,
            ...snapshot,
            kpiTotal: ZERO,
            taxableAdditions: ZERO,
            gross: ZERO,
            siBase: ZERO,
            employeeSi: ZERO,
            employerSi: ZERO,
            pitCredit: ZERO,
            pit: ZERO,
            advance: ZERO,
            otherAdditions: ZERO,
            deductions: ZERO,
            net: ZERO,
          })
          .returning();
        if (!line) throw new Error('payroll line insert returned no row');
        added.push(userId);
      }
      await this.syncItemsInTx(tx, line.id, own.items);
    }
    return { added, removed };
  }

  private async syncItemsInTx(
    tx: Tx,
    lineId: number,
    sheet: readonly KpiSheetItem[],
  ): Promise<void> {
    const existing = await tx
      .select()
      .from(payrollLineItems)
      .where(eq(payrollLineItems.lineId, lineId));
    const byKey = new Map(existing.map((item) => [item.key, item]));
    const keys = new Set(sheet.map((item) => item.key));
    for (const item of existing) {
      if (!keys.has(item.key)) {
        await tx.delete(payrollLineItems).where(eq(payrollLineItems.id, item.id));
      }
    }
    for (const item of sheet) {
      const before = byKey.get(item.key);
      const values = {
        name: item.name,
        source: item.source,
        amount: new Decimal(item.amount),
        sort: item.sort,
      };
      if (!before) {
        await tx
          .insert(payrollLineItems)
          .values({ lineId, key: item.key, ...values, earned: ZERO });
      } else if (before.source !== item.source) {
        // Another source is another score: a person's percent is not the attendance system's.
        await tx
          .update(payrollLineItems)
          .set({
            ...values,
            scorePercent: null,
            basePercent: null,
            penaltyPercent: null,
            note: null,
            scoredBy: null,
            scoredAt: null,
          })
          .where(eq(payrollLineItems.id, before.id));
      } else {
        await tx.update(payrollLineItems).set(values).where(eq(payrollLineItems.id, before.id));
      }
    }
  }

  private async computeRunInTx(tx: Tx, run: RunRow, facts: MonthFacts): Promise<void> {
    const lines = await tx
      .select()
      .from(payrollLines)
      .where(eq(payrollLines.runId, run.id))
      .orderBy(asc(payrollLines.id));
    for (const line of lines) {
      await this.computeLineInTx(
        tx,
        run.month,
        line,
        facts.settings,
        this.attendanceOf(facts, line.userId),
      );
    }
  }

  /**
   * One line's arithmetic, all of it through @tugeel/shared/payroll: each item's earned amount,
   * the adjustment lines, the month's live advances, then the totals. With `attendance` the
   * attendance item is scored anew; without it the counts and that score stay as they were.
   */
  private async computeLineInTx(
    tx: Tx,
    month: string,
    line: LineRow,
    settings: PayrollSettings,
    attendance?: Attendance,
  ): Promise<void> {
    const [items, adjustments, advances] = await Promise.all([
      tx.select().from(payrollLineItems).where(eq(payrollLineItems.lineId, line.id)),
      tx.select().from(payrollLineAdjustments).where(eq(payrollLineAdjustments.lineId, line.id)),
      tx
        .select({ amount: payrollAdvances.amount })
        .from(payrollAdvances)
        .where(
          and(
            eq(payrollAdvances.month, month),
            eq(payrollAdvances.userId, line.userId),
            isNull(payrollAdvances.voidedAt),
          ),
        ),
    ]);
    const earned: Decimal[] = [];
    for (const item of items) {
      let score = item.scorePercent;
      let base = item.basePercent;
      let penalty = item.penaltyPercent;
      if (item.source === 'ATTENDANCE' && attendance) {
        if (attendance.measured) {
          const result = attendanceScore(attendance.counts, settings.latePenaltyPercent);
          score = result.scorePercent;
          base = result.basePercent;
          penalty = Decimal.min(result.penaltyPercent, 100);
        } else {
          // Not tracked by the attendance system: nothing to take off.
          score = new Decimal(100);
          base = null;
          penalty = null;
        }
      }
      const amount = score === null ? ZERO : kpiEarned(item.amount, score);
      earned.push(amount);
      await tx
        .update(payrollLineItems)
        .set({ scorePercent: score, basePercent: base, penaltyPercent: penalty, earned: amount })
        .where(eq(payrollLineItems.id, item.id));
    }
    const of = (kind: PayrollAdjustmentKind, taxable: boolean) =>
      sum(
        adjustments
          .filter((row) => row.kind === kind && row.taxable === taxable)
          .map((row) => row.amount),
      );
    const totals = payslipTotals(
      {
        baseSalary: line.baseSalary,
        kpiEarned: earned,
        taxableAdditions: of('ADDITION', true),
        otherAdditions: of('ADDITION', false),
        deductions: of('DEDUCTION', false),
        advance: sum(advances.map((row) => row.amount)),
        paysSocialInsurance: line.paysSocialInsurance,
      },
      settings,
    );
    const hasAttendanceItem = items.some((item) => item.source === 'ATTENDANCE');
    await tx
      .update(payrollLines)
      .set({
        ...(attendance
          ? {
              attendanceMeasured: attendance.measured,
              workdays:
                attendance.measured && hasAttendanceItem ? attendance.counts.workdays : null,
              attendedDays:
                attendance.measured && hasAttendanceItem ? attendance.counts.attendedDays : null,
              lateDays:
                attendance.measured && hasAttendanceItem ? attendance.counts.lateDays : null,
            }
          : {}),
        kpiTotal: totals.kpiTotal,
        taxableAdditions: of('ADDITION', true),
        gross: totals.gross,
        siBase: totals.siBase,
        employeeSi: totals.employeeSi,
        employerSi: totals.employerSi,
        pitCredit: totals.pitCredit,
        pit: totals.pit,
        advance: totals.advance,
        otherAdditions: totals.otherAdditions,
        deductions: totals.deductions,
        net: totals.net,
        updatedAt: sql`now()`,
      })
      .where(eq(payrollLines.id, line.id));
  }

  private async runRow(executor: Db | Tx, id: number): Promise<RunRow> {
    const [run] = await executor.select().from(payrollRuns).where(eq(payrollRuns.id, id));
    if (!run) throw notFound('payroll run', id);
    return run;
  }

  /** The run under its month's lock, read after the lock is held. */
  private async lockedInTx(tx: Tx, id: number): Promise<RunRow> {
    const { month } = await this.runRow(tx, id);
    await lockMonth(tx, month);
    return this.runRow(tx, id);
  }

  private async draftInTx(tx: Tx, id: number): Promise<RunRow> {
    const run = await this.lockedInTx(tx, id);
    if (run.status !== 'DRAFT') {
      throw new AppError('DOC_STATE_INVALID', `payroll run ${id} is ${run.status}`, {
        status: run.status,
      });
    }
    return run;
  }

  private async lineInTx(tx: Tx, runId: number, lineId: number): Promise<LineRow> {
    const [line] = await tx
      .select()
      .from(payrollLines)
      .where(and(eq(payrollLines.id, lineId), eq(payrollLines.runId, runId)));
    if (!line) throw notFound('payroll line', lineId);
    return line;
  }

  private async details(executor: Db | Tx, runs: readonly RunRow[]): Promise<PayrollRunDetail[]> {
    if (runs.length === 0) return [];
    const lines = await this.lineViews(executor, runs, {});
    const names = await this.names.namesOf(
      runs.flatMap((run) =>
        [run.createdBy, run.approvedBy, run.reopenedBy].filter((id): id is number => id !== null),
      ),
      executor,
    );
    return runs.map((run) => {
      const own = lines.filter((line) => line.runId === run.id);
      return {
        id: run.id,
        month: run.month,
        status: run.status,
        note: run.note,
        settings: settingsOf(run.settings),
        attendanceTo: run.attendanceTo,
        computedAt: run.computedAt,
        createdAt: run.createdAt,
        createdByName: names.get(run.createdBy) ?? null,
        approvedAt: run.approvedAt,
        approvedByName: run.approvedBy === null ? null : (names.get(run.approvedBy) ?? null),
        reopenedAt: run.reopenedAt,
        reopenedByName: run.reopenedBy === null ? null : (names.get(run.reopenedBy) ?? null),
        reopenReason: run.reopenReason,
        lineCount: own.length,
        unscoredCount: own.reduce((count, line) => count + line.unscoredCount, 0),
        totals: totalsOf(own),
        lines: own,
      };
    });
  }

  /** The payslips of some runs, optionally one person's or one line, ordered by name. */
  private async lineViews(
    executor: Db | Tx,
    runs: readonly RunRow[],
    filter: { userId?: number; lineId?: number },
  ): Promise<PayrollLineView[]> {
    if (runs.length === 0) return [];
    const runById = new Map(runs.map((run) => [run.id, run]));
    const lines = await executor
      .select()
      .from(payrollLines)
      .where(
        and(
          inArray(payrollLines.runId, [...runById.keys()]),
          filter.userId === undefined ? undefined : eq(payrollLines.userId, filter.userId),
          filter.lineId === undefined ? undefined : eq(payrollLines.id, filter.lineId),
        ),
      )
      .orderBy(asc(payrollLines.fullName), asc(payrollLines.id));
    if (lines.length === 0) return [];
    const lineIds = lines.map((line) => line.id);
    const months = [...new Set(runs.map((run) => run.month))];
    const userIds = [...new Set(lines.map((line) => line.userId))];
    const items: ItemRow[] = await executor
      .select()
      .from(payrollLineItems)
      .where(inArray(payrollLineItems.lineId, lineIds))
      .orderBy(asc(payrollLineItems.sort), asc(payrollLineItems.id));
    const adjustments: AdjustmentRow[] = await executor
      .select()
      .from(payrollLineAdjustments)
      .where(inArray(payrollLineAdjustments.lineId, lineIds))
      .orderBy(asc(payrollLineAdjustments.id));
    const advances = await executor
      .select()
      .from(payrollAdvances)
      .where(
        and(
          inArray(payrollAdvances.month, months),
          inArray(payrollAdvances.userId, userIds),
          isNull(payrollAdvances.voidedAt),
        ),
      )
      .orderBy(asc(payrollAdvances.paidOn), asc(payrollAdvances.id));
    const names = await this.names.namesOf(
      items.flatMap((item) => (item.scoredBy === null ? [] : [item.scoredBy])),
      executor,
    );
    const byRunOrder = new Map(runs.map((run, index) => [run.id, index]));
    return lines
      .map((line): PayrollLineView => {
        const run = runById.get(line.runId);
        if (!run) throw new Error('payroll line without its run');
        const own = items.filter((item) => item.lineId === line.id);
        return {
          id: line.id,
          runId: run.id,
          month: run.month,
          runStatus: run.status,
          approvedAt: run.approvedAt,
          userId: line.userId,
          fullName: line.fullName,
          position: line.position,
          divisionName: line.divisionName,
          baseSalary: money(line.baseSalary),
          paysSocialInsurance: line.paysSocialInsurance,
          attendanceMeasured: line.attendanceMeasured,
          workdays: line.workdays,
          attendedDays: line.attendedDays,
          lateDays: line.lateDays,
          items: own.map((item) => ({
            id: item.id,
            key: item.key,
            name: item.name,
            source: item.source,
            amount: money(item.amount),
            scorePercent: percentText(item.scorePercent),
            basePercent: percentText(item.basePercent),
            penaltyPercent: percentText(item.penaltyPercent),
            earned: money(item.earned),
            note: item.note,
            scoredBy: item.scoredBy,
            scoredByName: item.scoredBy === null ? null : (names.get(item.scoredBy) ?? null),
            scoredAt: item.scoredAt,
          })),
          adjustments: adjustments
            .filter((row) => row.lineId === line.id)
            .map((row) => ({
              id: row.id,
              kind: row.kind,
              name: row.name,
              amount: money(row.amount),
              taxable: row.taxable,
              createdAt: row.createdAt,
            })),
          advances: advances
            .filter((row) => row.month === run.month && row.userId === line.userId)
            .map((row) => ({
              id: row.id,
              amount: money(row.amount),
              paidOn: row.paidOn,
              note: row.note,
            })),
          unscoredCount: own.filter((item) => item.scorePercent === null).length,
          kpiTotal: money(line.kpiTotal),
          taxableAdditions: money(line.taxableAdditions),
          gross: money(line.gross),
          siBase: money(line.siBase),
          employeeSi: money(line.employeeSi),
          pitCredit: money(line.pitCredit),
          pit: money(line.pit),
          advance: money(line.advance),
          otherAdditions: money(line.otherAdditions),
          deductions: money(line.deductions),
          net: money(line.net),
          employerSi: money(line.employerSi),
          totalCost: money(line.gross.plus(line.otherAdditions).plus(line.employerSi)),
        };
      })
      .sort((a, b) => (byRunOrder.get(a.runId) ?? 0) - (byRunOrder.get(b.runId) ?? 0));
  }
}

/** The month's advisory lock, held to the end of the transaction. */
export async function lockMonth(tx: Tx, month: string): Promise<void> {
  const key = Number.parseInt(month.replace('-', ''), 10);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${PAYROLL_LOCK_SPACE}, ${key})`);
}

export function assertMonth(month: string, path = 'month'): void {
  if (!isPayrollMonth(month)) throw invalid(path, 'isMonth', 'YYYY-MM');
}

/** A trimmed note, null when empty; refused above the limit. */
export function cleanNote(path: string, value: string | null): string | null {
  const text = value?.trim() ?? '';
  if (text.length === 0) return null;
  if ([...text].length > PAYROLL_LIMITS.maxNote) {
    throw invalid(path, 'maxLength', `at most ${PAYROLL_LIMITS.maxNote} characters`);
  }
  return text;
}

function totalsOf(lines: readonly PayrollLineView[]): PayrollRunTotals {
  const of = (pick: (line: PayrollLineView) => string) =>
    money(sum(lines.map((line) => new Decimal(pick(line)))));
  return {
    baseSalary: of((line) => line.baseSalary),
    kpiTotal: of((line) => line.kpiTotal),
    gross: of((line) => line.gross),
    employeeSi: of((line) => line.employeeSi),
    employerSi: of((line) => line.employerSi),
    pit: of((line) => line.pit),
    advance: of((line) => line.advance),
    otherAdditions: of((line) => line.otherAdditions),
    deductions: of((line) => line.deductions),
    net: of((line) => line.net),
    totalCost: of((line) => line.totalCost),
  };
}
