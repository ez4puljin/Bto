import {
  type BoardPeriodKind,
  boardPeriodOf,
  boardPeriodRange,
  boardPeriodStart,
  boardPosition,
  boardTrendLength,
  isBoardPeriodKey,
  lastYearBoardPeriod,
  shiftBoardPeriod,
} from '@tugeel/shared/reports';
import { addDays, addMonths, isIsoDate } from '@tugeel/shared/time';
import { invalid } from '../../../common/errors/app-error';

/** A closed range of business dates, `YYYY-MM-DD`. */
export interface DateRange {
  from: string;
  to: string;
}

/** The dashboard's month with the same days a month and a year earlier (ADR-0108 #11). */
export interface MonthPeriods {
  month: string;
  current: DateRange;
  previous: DateRange;
  lastYear: DateRange;
  /** True while the month runs: the comparisons then take the same days of the month. */
  running: boolean;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** The last day of the month of `date`. */
export function monthEnd(date: string): string {
  return addDays(addMonths(`${date.slice(0, 7)}-01`, 1), -1);
}

/** The month's day `day`, or its last day when the month is shorter (31 Oct → 30 Sep). */
function dayOf(month: string, day: number): string {
  const end = monthEnd(`${month}-01`);
  const last = Number.parseInt(end.slice(8), 10);
  return `${month}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

/**
 * The periods of a month as of `today`: a running month counts its first day to today and
 * compares the same days a month and a year earlier; an ended month compares whole months. A
 * month after today's is refused.
 */
export function monthPeriods(month: string, today: string): MonthPeriods {
  if (!MONTH.test(month)) throw invalid('month', 'pattern', 'a month YYYY-MM');
  const thisMonth = today.slice(0, 7);
  if (month > thisMonth) throw invalid('month', 'range', 'a month up to the current one');
  const running = month === thisMonth;
  const lastDay = running ? Number.parseInt(today.slice(8), 10) : 31;
  const previousMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const lastYearMonth = addMonths(`${month}-01`, -12).slice(0, 7);
  const range = (m: string): DateRange => ({ from: `${m}-01`, to: dayOf(m, lastDay) });
  return {
    month,
    current: range(month),
    previous: range(previousMonth),
    lastYear: range(lastYearMonth),
    running,
  };
}

/** The twelve months ending with `month`, oldest first, as `YYYY-MM`. */
export function trailingMonths(month: string, count = 12): string[] {
  return Array.from({ length: count }, (_, index) =>
    addMonths(`${month}-01`, index - count + 1).slice(0, 7),
  );
}

/** A report's date range from the query, checked: real dates, `from` ≤ `to`, at most 3 years. */
export function checkedRange(from: string, to: string): DateRange {
  if (!isIsoDate(from)) throw invalid('from', 'pattern', 'a date YYYY-MM-DD');
  if (!isIsoDate(to)) throw invalid('to', 'pattern', 'a date YYYY-MM-DD');
  if (from > to) throw invalid('to', 'range', 'on or after from');
  if (addMonths(from, 36) < to) throw invalid('to', 'range', 'at most three years after from');
  return { from, to };
}

/** The number of days of a range, both ends included. */
export function daysIn(range: DateRange): number {
  const ms = Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/** «Ашгийн самбар»'s period with the one before it and the same one a year earlier (ADR-0237). */
export interface BoardPeriods {
  kind: BoardPeriodKind;
  period: string;
  current: DateRange;
  previous: DateRange;
  lastYear: DateRange;
  /** True while the period runs: the comparisons then take the same days of theirs. */
  running: boolean;
}

/**
 * A month, quarter or year as of `today`: a running one counts to today and compares the same
 * position in the period before and a year earlier (as the dashboard's month, ADR-0108 #11); an
 * ended one compares whole periods. A period after today's is refused.
 */
export function boardPeriods(kind: BoardPeriodKind, period: string, today: string): BoardPeriods {
  if (!isBoardPeriodKey(kind, period)) throw invalid('period', 'pattern', `a ${kind} period`);
  const now = boardPeriodOf(kind, today);
  if (boardPeriodStart(kind, period) > boardPeriodStart(kind, now)) {
    throw invalid('period', 'range', 'a period up to the current one');
  }
  const running = period === now;
  const asOf = running ? boardPosition(kind, today) : null;
  return {
    kind,
    period,
    current: boardPeriodRange(kind, period, asOf),
    previous: boardPeriodRange(kind, shiftBoardPeriod(kind, period, -1), asOf),
    lastYear: boardPeriodRange(kind, lastYearBoardPeriod(kind, period), asOf),
    running,
  };
}

/**
 * The trend's periods ending with `period`, oldest first (12 months, 8 quarters or 5 years), each
 * whole except a running last one, which ends today.
 */
export function boardTrend(
  kind: BoardPeriodKind,
  period: string,
  today: string,
): { period: string; range: DateRange }[] {
  const count = boardTrendLength(kind);
  return Array.from({ length: count }, (_, index) => {
    const key = shiftBoardPeriod(kind, period, index - count + 1);
    const range = boardPeriodRange(kind, key, null);
    return { period: key, range: range.to > today ? { from: range.from, to: today } : range };
  });
}
