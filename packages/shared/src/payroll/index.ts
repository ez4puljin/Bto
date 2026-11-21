/**
 * Payroll with KPI evaluation (ADR-0235): the rules the api, the web and the staff app share.
 *
 * A month's pay = fixed salary (split by the planned workdays for someone who joined or left inside
 * the month) + every KPI item's earned amount (+ taxable additions) = gross;
 * minus the employee's social insurance and income tax where they apply, minus the advances and
 * the other deductions, plus the additions that are not taxed = net. A KPI item is worth a fixed
 * amount and earns the percent it was scored (0–100). The attendance item's percent comes from the
 * time report: days attended ÷ planned workdays, minus a penalty per late day.
 *
 * Money is MNT with two decimals, rounded HALF_UP (the project's rule); a percent has at most two
 * decimals, and the attendance ratio is rounded to ONE decimal before the penalty (the owner's
 * example: 20 ÷ 22 = 90.9 %, − 4 % = 86.9 %, of 200,000 = 173,800).
 */
import { weekdayIndex } from '../hr';
import { Decimal, type DecimalInput, roundHalfUp, toMoney } from '../money';
import { addDays, daysInMonth } from '../time';

/** Where a KPI item's score comes from: the attendance system, or a person. New automatic sources are added here. */
export const KPI_SOURCES = ['ATTENDANCE', 'MANUAL'] as const;
export type KpiSource = (typeof KPI_SOURCES)[number];
/** The sources no person scores. */
export const AUTOMATIC_KPI_SOURCES: readonly KpiSource[] = ['ATTENDANCE'];
export const isAutomaticKpiSource = (source: KpiSource): boolean =>
  AUTOMATIC_KPI_SOURCES.includes(source);

export const PAYROLL_RUN_STATUSES = ['DRAFT', 'APPROVED'] as const;
export type PayrollRunStatus = (typeof PAYROLL_RUN_STATUSES)[number];

export const PAYROLL_ADJUSTMENT_KINDS = ['ADDITION', 'DEDUCTION'] as const;
export type PayrollAdjustmentKind = (typeof PAYROLL_ADJUSTMENT_KINDS)[number];

export const PAYROLL_LIMITS = {
  maxName: 80,
  maxNote: 300,
  /** KPI items on one sheet or template. */
  maxItems: 30,
  maxBrackets: 12,
  /** One amount (a salary, an item, an advance): below a hundred million. */
  maxAmount: '99999999.99',
  maxScores: 500,
} as const;

/** `1234.5`, `1234.50`, `0`: an amount as text, never negative, at most two decimals. */
export const PAYROLL_AMOUNT_PATTERN = /^\d{1,8}(\.\d{1,2})?$/;
/** A percent as text: 0–100 with at most two decimals. */
export const PAYROLL_PERCENT_PATTERN = /^(100(\.0{1,2})?|\d{1,2}(\.\d{1,2})?)$/;
export const PAYROLL_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isPayrollMonth = (value: string): boolean => PAYROLL_MONTH_PATTERN.test(value);

/** The first and last day of a `YYYY-MM` month. */
export function payrollMonthRange(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

/**
 * One step of the income-tax credit table: a month's taxable income up to `upTo` (inclusive; null
 * = everything above) earns `credit` off the tax.
 */
export interface PayrollTaxCreditBracket {
  upTo: string | null;
  credit: string;
}

/** The rates HR keeps (ADR-0235 #6); every value is text so it travels as it is stored. */
export interface PayrollSettings {
  /** Percent taken off the attendance score for each late day. */
  latePenaltyPercent: string;
  /** The employee's social insurance, percent of gross. */
  employeeSiPercent: string;
  /** The employer's share, percent of the same base; a cost, never deducted from the employee. */
  employerSiPercent: string;
  minimumWage: string;
  /** The insurance base is capped at this many minimum wages. */
  siCapMultiplier: string;
  /** Personal income tax, percent of gross minus the employee's insurance. */
  pitPercent: string;
  /** The monthly tax credit by taxable income, lowest first; the last step may be open (`upTo` null). */
  pitCredits: PayrollTaxCreditBracket[];
}

/**
 * Mongolia's rates as of 2026 (the owner edits them on the settings page): insurance 11.5 % and
 * 12.5 %, minimum wage 792,000, the base capped at ten minimum wages, income tax 10 %, and the
 * credit of 240,000 a year stepping down to nothing above 36 million a year, per month here.
 */
export const DEFAULT_PAYROLL_SETTINGS: PayrollSettings = {
  latePenaltyPercent: '2',
  employeeSiPercent: '11.5',
  employerSiPercent: '12.5',
  minimumWage: '792000',
  siCapMultiplier: '10',
  pitPercent: '10',
  pitCredits: [
    { upTo: '500000', credit: '20000' },
    { upTo: '1000000', credit: '18000' },
    { upTo: '1500000', credit: '16000' },
    { upTo: '2000000', credit: '14000' },
    { upTo: '2500000', credit: '12000' },
    { upTo: '3000000', credit: '10000' },
    { upTo: null, credit: '0' },
  ],
};

export type PayrollSettingsCheck =
  { ok: true; settings: PayrollSettings } | { ok: false; path: string; detail: string };

const percentOk = (value: string): boolean =>
  PAYROLL_PERCENT_PATTERN.test(value) && new Decimal(value).lte(100);

/** The settings checked and cleaned: percents 0–100, amounts in range, the credit steps rising. */
export function checkPayrollSettings(raw: PayrollSettings): PayrollSettingsCheck {
  for (const key of [
    'latePenaltyPercent',
    'employeeSiPercent',
    'employerSiPercent',
    'pitPercent',
  ] as const) {
    if (!percentOk(raw[key])) return { ok: false, path: key, detail: '0 to 100, two decimals' };
  }
  if (!PAYROLL_AMOUNT_PATTERN.test(raw.minimumWage)) {
    return { ok: false, path: 'minimumWage', detail: 'an amount with at most two decimals' };
  }
  if (
    !/^\d{1,3}(\.\d{1,2})?$/.test(raw.siCapMultiplier) ||
    new Decimal(raw.siCapMultiplier).lte(0)
  ) {
    return { ok: false, path: 'siCapMultiplier', detail: 'above 0, two decimals' };
  }
  if (raw.pitCredits.length > PAYROLL_LIMITS.maxBrackets) {
    return { ok: false, path: 'pitCredits', detail: `at most ${PAYROLL_LIMITS.maxBrackets} steps` };
  }
  let previous: Decimal | null = null;
  for (const [index, step] of raw.pitCredits.entries()) {
    const path = `pitCredits[${index}]`;
    if (!PAYROLL_AMOUNT_PATTERN.test(step.credit)) {
      return { ok: false, path: `${path}.credit`, detail: 'an amount with at most two decimals' };
    }
    if (step.upTo === null) {
      if (index !== raw.pitCredits.length - 1) {
        return { ok: false, path: `${path}.upTo`, detail: 'only the last step is open' };
      }
      continue;
    }
    if (!PAYROLL_AMOUNT_PATTERN.test(step.upTo)) {
      return { ok: false, path: `${path}.upTo`, detail: 'an amount with at most two decimals' };
    }
    const upTo = new Decimal(step.upTo);
    if (previous !== null && upTo.lte(previous)) {
      return { ok: false, path: `${path}.upTo`, detail: 'above the step before it' };
    }
    previous = upTo;
  }
  return {
    ok: true,
    settings: {
      latePenaltyPercent: new Decimal(raw.latePenaltyPercent).toString(),
      employeeSiPercent: new Decimal(raw.employeeSiPercent).toString(),
      employerSiPercent: new Decimal(raw.employerSiPercent).toString(),
      minimumWage: toMoney(raw.minimumWage).toString(),
      siCapMultiplier: new Decimal(raw.siCapMultiplier).toString(),
      pitPercent: new Decimal(raw.pitPercent).toString(),
      pitCredits: raw.pitCredits.map((step) => ({
        upTo: step.upTo === null ? null : toMoney(step.upTo).toString(),
        credit: toMoney(step.credit).toString(),
      })),
    },
  };
}

/** A percent held to 0–100. */
export function clampPercent(value: DecimalInput): Decimal {
  return Decimal.max(0, Decimal.min(100, new Decimal(value)));
}

/** What a KPI item earns: its amount × the score (held to 0–100 %), in money. */
export function kpiEarned(amount: DecimalInput, scorePercent: DecimalInput): Decimal {
  return toMoney(new Decimal(amount).times(clampPercent(scorePercent)).div(100));
}

/** One day of the time report as the attendance KPI reads it. */
export interface PayrollAttendanceDay {
  /** The report day's status (`ReportStatus` of @tugeel/shared/hr). */
  status: string;
  /** The schedule plans work on this day. */
  planned: boolean;
  lateMinutes: number;
}

export interface PayrollAttendanceCounts {
  workdays: number;
  attendedDays: number;
  lateDays: number;
}

/**
 * The month's counts from the time report's days: a planned day is a workday; it is attended
 * unless the person was ABSENT (an approved whole-day leave or trip is LEAVE / AWAY, so it counts);
 * an attended workday with late minutes is a late day. Work on a day off counts nowhere.
 */
export function attendanceCounts(days: readonly PayrollAttendanceDay[]): PayrollAttendanceCounts {
  let workdays = 0;
  let attendedDays = 0;
  let lateDays = 0;
  for (const day of days) {
    if (!day.planned || day.status === 'OFF') continue;
    workdays += 1;
    if (day.status === 'ABSENT') continue;
    attendedDays += 1;
    if (day.lateMinutes > 0) lateDays += 1;
  }
  return { workdays, attendedDays, lateDays };
}

export interface PayrollAttendanceScore {
  /** Attended ÷ workdays as a percent with one decimal (100 when no workday was planned). */
  basePercent: Decimal;
  /** Late days × the penalty per late day. */
  penaltyPercent: Decimal;
  /** Base − penalty, never below 0. */
  scorePercent: Decimal;
}

/** The attendance KPI's score (ADR-0235 #3). */
export function attendanceScore(
  counts: PayrollAttendanceCounts,
  latePenaltyPercent: DecimalInput,
): PayrollAttendanceScore {
  const basePercent =
    counts.workdays <= 0
      ? new Decimal(100)
      : clampPercent(
          roundHalfUp(new Decimal(counts.attendedDays).times(100).div(counts.workdays), 1),
        );
  const penaltyPercent = roundHalfUp(new Decimal(latePenaltyPercent).times(counts.lateDays), 2);
  return {
    basePercent,
    penaltyPercent,
    scorePercent: Decimal.max(0, basePercent.minus(penaltyPercent)),
  };
}

/**
 * A person's week as the time report plans it (Monday first): a day with a plan is a workday, null
 * a day off — `WeekPlan` of @tugeel/shared/hr, the schedule `reportDay` reads.
 */
export type PayrollWeekPlan = readonly (object | null | undefined)[];

/** The planned workdays of a week plan between two dates, both included (0 when `to` < `from`). */
export function plannedWorkdays(plan: PayrollWeekPlan, from: string, to: string): number {
  let count = 0;
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (plan[weekdayIndex(date)]) count += 1;
  }
  return count;
}

/**
 * The part of a month a person was employed (owner 2026-11-21): from the later of the month's first
 * day and `employedOn` to the earlier of its last day and `leftOn`; no `employedOn` = employed from
 * before the month, no `leftOn` = still employed. Null when the person was not employed in it.
 */
export function employedSpan(
  month: string,
  employedOn: string | null,
  leftOn: string | null,
): { from: string; to: string } | null {
  const range = payrollMonthRange(month);
  const from = employedOn !== null && employedOn > range.from ? employedOn : range.from;
  const to = leftOn !== null && leftOn < range.to ? leftOn : range.to;
  return from <= to ? { from, to } : null;
}

/** The two day counts the fixed salary is split by. */
export interface PayrollSalaryDays {
  /** Planned workdays inside the employed span. */
  days: number;
  /** Planned workdays of the whole month. */
  monthDays: number;
}

/**
 * The fixed salary's day counts (ADR-0235, amended 2026-11-21): the person's planned workdays
 * inside their employed span of the month, and in the whole month, both from their own schedule
 * exactly as the attendance KPI counts a workday.
 */
export function salaryDays(
  month: string,
  plan: PayrollWeekPlan,
  employedOn: string | null,
  leftOn: string | null,
): PayrollSalaryDays {
  const range = payrollMonthRange(month);
  const span = employedSpan(month, employedOn, leftOn);
  return {
    days: span === null ? 0 : plannedWorkdays(plan, span.from, span.to),
    monthDays: plannedWorkdays(plan, range.from, range.to),
  };
}

/** The fixed salary is split: the employed span holds fewer workdays than the month. */
export function isSalaryProrated(days: number | null, monthDays: number | null): boolean {
  return days !== null && monthDays !== null && monthDays > 0 && days < monthDays;
}

/**
 * The fixed salary paid for the month: salary × days ÷ month days, money HALF_UP. A month without
 * a planned workday, or a span holding all of them, pays the salary whole.
 */
export function proratedSalary(salary: DecimalInput, days: number, monthDays: number): Decimal {
  if (!isSalaryProrated(days, monthDays)) return toMoney(salary);
  return toMoney(new Decimal(salary).times(Math.max(0, days)).div(monthDays));
}

/** The monthly credit off the income tax for a taxable income. */
export function pitCreditFor(
  taxable: DecimalInput,
  brackets: readonly PayrollTaxCreditBracket[],
): Decimal {
  const income = new Decimal(taxable);
  for (const step of brackets) {
    if (step.upTo === null || income.lte(step.upTo)) return toMoney(step.credit);
  }
  return new Decimal(0);
}

export interface PayslipInput {
  baseSalary: DecimalInput;
  /** What each KPI item earned. */
  kpiEarned: readonly DecimalInput[];
  /** Additions that are taxed with the pay (a bonus). */
  taxableAdditions: DecimalInput;
  /** Additions paid on top of the net, untaxed. */
  otherAdditions: DecimalInput;
  deductions: DecimalInput;
  advance: DecimalInput;
  paysSocialInsurance: boolean;
}

export interface PayslipTotals {
  kpiTotal: Decimal;
  gross: Decimal;
  /** The part of gross the insurance is charged on (0 when the employee pays none). */
  siBase: Decimal;
  employeeSi: Decimal;
  /** The employer's share: a cost beside the pay, never deducted. */
  employerSi: Decimal;
  /** Gross − the employee's insurance. */
  taxable: Decimal;
  pitCredit: Decimal;
  pit: Decimal;
  advance: Decimal;
  otherAdditions: Decimal;
  deductions: Decimal;
  /** What is paid out; negative when the advances exceed the pay. */
  net: Decimal;
}

/**
 * One payslip's totals (ADR-0235 #1, #6). An employee who pays no social insurance pays no income
 * tax through payroll either: net = gross − advance − deductions + untaxed additions.
 */
export function payslipTotals(input: PayslipInput, settings: PayrollSettings): PayslipTotals {
  const zero = new Decimal(0);
  const kpiTotal = input.kpiEarned.reduce<Decimal>((sum, value) => sum.plus(value), zero);
  const gross = toMoney(new Decimal(input.baseSalary).plus(kpiTotal).plus(input.taxableAdditions));
  const advance = toMoney(input.advance);
  const otherAdditions = toMoney(input.otherAdditions);
  const deductions = toMoney(input.deductions);
  let siBase = zero;
  let employeeSi = zero;
  let employerSi = zero;
  let pitCredit = zero;
  let pit = zero;
  if (input.paysSocialInsurance) {
    const cap = new Decimal(settings.minimumWage).times(settings.siCapMultiplier);
    siBase = toMoney(Decimal.min(gross, cap));
    employeeSi = toMoney(siBase.times(settings.employeeSiPercent).div(100));
    employerSi = toMoney(siBase.times(settings.employerSiPercent).div(100));
    const taxable = gross.minus(employeeSi);
    const tax = toMoney(taxable.times(settings.pitPercent).div(100));
    // The credit never turns the tax into a payment to the employee.
    pitCredit = Decimal.min(pitCreditFor(taxable, settings.pitCredits), tax);
    pit = tax.minus(pitCredit);
  }
  return {
    kpiTotal: toMoney(kpiTotal),
    gross,
    siBase,
    employeeSi,
    employerSi,
    taxable: gross.minus(employeeSi),
    pitCredit,
    pit,
    advance,
    otherAdditions,
    deductions,
    net: gross.minus(employeeSi).minus(pit).minus(advance).minus(deductions).plus(otherAdditions),
  };
}
