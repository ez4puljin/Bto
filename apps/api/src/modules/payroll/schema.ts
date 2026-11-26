import {
  KPI_SOURCES,
  PAYROLL_ADJUSTMENT_KINDS,
  PAYROLL_RUN_STATUSES,
} from '@tugeel/shared/payroll';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonValue, money, percent } from '../../common/db/types';
import { users } from '../identity/schema';

// The tables owned by the payroll module (docs/modules/payroll.md, ADR-0235). Migration
// 0119_payroll adds by hand the REVOKEs (nothing of the settings, templates, terms, advances and
// runs is deleted) and the trigger that keeps an APPROVED run's lines, items and adjustment lines
// from any change: a draft's lines are working paper, an approved run's are the payslips.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const MONTH = sql.raw(`'^[0-9]{4}-(0[1-9]|1[0-2])$'`);

/** The rates HR keeps (ADR-0235 #6), one row (`id = 1`); no row = `DEFAULT_PAYROLL_SETTINGS`. */
export const payrollSettings = pgTable(
  'payroll_settings',
  {
    id: smallint('id').primaryKey(),
    latePenaltyPercent: percent('late_penalty_percent').notNull(),
    employeeSiPercent: percent('employee_si_percent').notNull(),
    employerSiPercent: percent('employer_si_percent').notNull(),
    minimumWage: money('minimum_wage').notNull(),
    siCapMultiplier: percent('si_cap_multiplier').notNull(),
    pitPercent: percent('pit_percent').notNull(),
    /** `PayrollTaxCreditBracket[]`, lowest first. */
    pitCredits: jsonValue('pit_credits').notNull(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payroll_settings_single', sql`${t.id} = 1`),
    check(
      'payroll_settings_percents',
      sql`${t.latePenaltyPercent} BETWEEN 0 AND 100 AND ${t.employeeSiPercent} BETWEEN 0 AND 100 AND ${t.employerSiPercent} BETWEEN 0 AND 100 AND ${t.pitPercent} BETWEEN 0 AND 100`,
    ),
    check('payroll_settings_amounts', sql`${t.minimumWage} >= 0 AND ${t.siCapMultiplier} > 0`),
  ],
);

/** A KPI template (ADR-0235 #5): a reusable list of items, e.g. per position. Archived, never deleted. */
export const payrollKpiTemplates = pgTable(
  'payroll_kpi_templates',
  {
    id: id(),
    name: text('name').notNull(),
    /** `{ key, name, source, amount, sort }[]`; amounts as text with two decimals. */
    items: jsonValue('items').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payroll_kpi_templates_name_key')
      .on(sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    check('payroll_kpi_templates_name_present', sql`length(btrim(${t.name})) BETWEEN 1 AND 80`),
    check('payroll_kpi_templates_items_array', sql`jsonb_typeof(${t.items}) = 'array'`),
  ],
);

/**
 * One employee's pay terms (ADR-0235 #5): the fixed salary, whether social insurance is paid, and
 * the KPI sheet (copied from a template, then the person's own). No row or `active = false` = the
 * person is on no payroll run.
 */
export const payrollTerms = pgTable(
  'payroll_terms',
  {
    userId: ref('user_id')
      .primaryKey()
      .references(() => users.id),
    baseSalary: money('base_salary').notNull(),
    /** A genuine personal salary kept for months before a position salary assignment began. */
    positionLegacySalary: boolean('position_legacy_salary').default(false),
    paysSocialInsurance: boolean('pays_social_insurance').notNull().default(true),
    /** The template the sheet was last copied from; a note of origin, nothing follows it. */
    templateId: ref('template_id').references(() => payrollKpiTemplates.id),
    /** `{ key, name, source, amount, sort }[]`. */
    items: jsonValue('items').notNull(),
    active: boolean('active').notNull().default(true),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('payroll_terms_salary', sql`${t.baseSalary} >= 0`),
    check('payroll_terms_items_array', sql`jsonb_typeof(${t.items}) = 'array'`),
  ],
);

/**
 * A salary advance (ADR-0235 #7): paid to an employee inside a month, deducted on that month's
 * payslip. Never deleted or rewritten: a wrong one is voided with a reason.
 */
export const payrollAdvances = pgTable(
  'payroll_advances',
  {
    id: id(),
    userId: userRef('user_id').notNull(),
    month: text('month').notNull(),
    amount: money('amount').notNull(),
    paidOn: date('paid_on').notNull(),
    note: text('note'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: userRef('voided_by'),
    voidReason: text('void_reason'),
  },
  (t) => [
    index('payroll_advances_month_user_idx').on(t.month, t.userId),
    check('payroll_advances_month', sql`${t.month} ~ ${MONTH}`),
    check('payroll_advances_amount', sql`${t.amount} > 0`),
    check('payroll_advances_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`),
    check(
      'payroll_advances_voided',
      sql`(${t.voidedAt} IS NULL) = (${t.voidedBy} IS NULL) AND (${t.voidedAt} IS NULL) = (${t.voidReason} IS NULL)`,
    ),
  ],
);

/** A month's payroll run (ADR-0235 #8): DRAFT while HR works on it, APPROVED once frozen. */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    month: text('month').notNull(),
    status: text('status', { enum: PAYROLL_RUN_STATUSES }).notNull().default('DRAFT'),
    note: text('note'),
    /** The `PayrollSettings` the lines were last computed with. */
    settings: jsonValue('settings').notNull(),
    /** The last day whose attendance was read (the month's end, or the day of computing). */
    attendanceTo: date('attendance_to'),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    approvedBy: userRef('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    reopenedBy: userRef('reopened_by'),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    reopenReason: text('reopen_reason'),
  },
  (t) => [
    uniqueIndex('payroll_runs_month_key').on(t.month),
    check('payroll_runs_month', sql`${t.month} ~ ${MONTH}`),
    check('payroll_runs_status', sql`${t.status} IN (${inList(PAYROLL_RUN_STATUSES)})`),
    check(
      'payroll_runs_approved',
      sql`(${t.status} = 'APPROVED') = (${t.approvedAt} IS NOT NULL) AND (${t.approvedAt} IS NULL) = (${t.approvedBy} IS NULL)`,
    ),
    check('payroll_runs_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`),
  ],
);

/**
 * One employee on a run: the snapshot of the terms at that moment and the computed totals. The
 * payslip once the run is APPROVED.
 */
export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: id(),
    runId: ref('run_id')
      .notNull()
      .references(() => payrollRuns.id),
    userId: userRef('user_id').notNull(),
    fullName: text('full_name').notNull(),
    position: text('position'),
    divisionName: text('division_name'),
    /** The monthly fixed salary of the terms (the snapshot). */
    baseSalary: money('base_salary').notNull(),
    /**
     * The fixed salary paid for the month (ADR-0235, 2026-11-21): `base_salary` × `salary_days` ÷
     * `salary_month_days`. NULL on a line computed before that rule: `base_salary` was paid.
     */
    salaryPaid: money('salary_paid'),
    /** Planned workdays inside the person's employed span of the month, and in the whole month. */
    salaryDays: integer('salary_days'),
    salaryMonthDays: integer('salary_month_days'),
    paysSocialInsurance: boolean('pays_social_insurance').notNull(),
    /** False when the person's attendance is not tracked: the attendance item is then full. */
    attendanceMeasured: boolean('attendance_measured').notNull().default(true),
    workdays: integer('workdays'),
    attendedDays: integer('attended_days'),
    lateDays: integer('late_days'),
    kpiTotal: money('kpi_total').notNull(),
    taxableAdditions: money('taxable_additions').notNull(),
    gross: money('gross').notNull(),
    siBase: money('si_base').notNull(),
    employeeSi: money('employee_si').notNull(),
    employerSi: money('employer_si').notNull(),
    pitCredit: money('pit_credit').notNull(),
    pit: money('pit').notNull(),
    advance: money('advance').notNull(),
    otherAdditions: money('other_additions').notNull(),
    deductions: money('deductions').notNull(),
    net: money('net').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payroll_lines_run_user_key').on(t.runId, t.userId),
    index('payroll_lines_user_idx').on(t.userId),
    check(
      'payroll_lines_salary_days',
      sql`(${t.salaryDays} IS NULL) = (${t.salaryMonthDays} IS NULL) AND (${t.salaryDays} IS NULL OR ${t.salaryDays} BETWEEN 0 AND ${t.salaryMonthDays})`,
    ),
    check('payroll_lines_salary_paid', sql`${t.salaryPaid} IS NULL OR ${t.salaryPaid} >= 0`),
  ],
);

/** A KPI item on a payslip: the snapshot of the sheet's item, its score and what it earned. */
export const payrollLineItems = pgTable(
  'payroll_line_items',
  {
    id: id(),
    lineId: ref('line_id')
      .notNull()
      .references(() => payrollLines.id),
    /** The sheet item's key, so a refresh of the terms keeps the score. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    source: text('source', { enum: KPI_SOURCES }).notNull(),
    amount: money('amount').notNull(),
    sort: integer('sort').notNull().default(0),
    /** NULL: a MANUAL item nobody scored yet (it earns nothing and the run cannot be approved). */
    scorePercent: percent('score_percent'),
    /** ATTENDANCE: attended ÷ workdays, and the late penalty taken off it. */
    basePercent: percent('base_percent'),
    penaltyPercent: percent('penalty_percent'),
    earned: money('earned').notNull(),
    note: text('note'),
    scoredBy: userRef('scored_by'),
    scoredAt: timestamp('scored_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('payroll_line_items_line_key').on(t.lineId, t.key),
    check('payroll_line_items_source', sql`${t.source} IN (${inList(KPI_SOURCES)})`),
    check('payroll_line_items_amount', sql`${t.amount} >= 0 AND ${t.earned} >= 0`),
    check(
      'payroll_line_items_score',
      sql`${t.scorePercent} IS NULL OR ${t.scorePercent} BETWEEN 0 AND 100`,
    ),
    check('payroll_line_items_note', sql`${t.note} IS NULL OR length(${t.note}) BETWEEN 1 AND 300`),
  ],
);

/** A free line on a payslip (ADR-0235 #7): an addition (taxed with the pay or not) or a deduction. */
export const payrollLineAdjustments = pgTable(
  'payroll_line_adjustments',
  {
    id: id(),
    lineId: ref('line_id')
      .notNull()
      .references(() => payrollLines.id),
    kind: text('kind', { enum: PAYROLL_ADJUSTMENT_KINDS }).notNull(),
    name: text('name').notNull(),
    amount: money('amount').notNull(),
    /** An ADDITION that is part of gross (insurance and tax apply); always false on a DEDUCTION. */
    taxable: boolean('taxable').notNull().default(false),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('payroll_line_adjustments_line_idx').on(t.lineId),
    check('payroll_line_adjustments_kind', sql`${t.kind} IN (${inList(PAYROLL_ADJUSTMENT_KINDS)})`),
    check('payroll_line_adjustments_amount', sql`${t.amount} > 0`),
    check('payroll_line_adjustments_name', sql`length(btrim(${t.name})) BETWEEN 1 AND 80`),
    check('payroll_line_adjustments_taxable', sql`${t.kind} = 'ADDITION' OR NOT ${t.taxable}`),
  ],
);
