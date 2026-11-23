import { addDays, addMonths, daysInMonth } from '../time';

/**
 * The periods of «Ашгийн самбар» (ADR-0237): a month `2026-11`, a quarter `2026-Q4` or a year
 * `2026`, in Ulaanbaatar business dates. The api works the ranges out from these, the page its
 * picker, arrows and labels.
 */
export const BOARD_PERIOD_KINDS = ['month', 'quarter', 'year'] as const;
export type BoardPeriodKind = (typeof BOARD_PERIOD_KINDS)[number];

export function isBoardPeriodKind(value: unknown): value is BoardPeriodKind {
  return typeof value === 'string' && (BOARD_PERIOD_KINDS as readonly string[]).includes(value);
}

/** How many months a period of the kind holds. */
export function boardPeriodMonths(kind: BoardPeriodKind): number {
  return kind === 'month' ? 1 : kind === 'quarter' ? 3 : 12;
}

/** How many periods the trend shows: 12 months, 8 quarters, 5 years. */
export function boardTrendLength(kind: BoardPeriodKind): number {
  return kind === 'month' ? 12 : kind === 'quarter' ? 8 : 5;
}

const KEY: Record<BoardPeriodKind, RegExp> = {
  month: /^(\d{4})-(0[1-9]|1[0-2])$/,
  quarter: /^(\d{4})-Q([1-4])$/,
  year: /^(\d{4})$/,
};

export function isBoardPeriodKey(kind: BoardPeriodKind, key: unknown): key is string {
  return typeof key === 'string' && KEY[kind].test(key) && !key.startsWith('0000');
}

/** The period of the kind a date `YYYY-MM-DD` lies in. */
export function boardPeriodOf(kind: BoardPeriodKind, date: string): string {
  const year = date.slice(0, 4);
  if (kind === 'year') return year;
  if (kind === 'month') return date.slice(0, 7);
  const month = Number.parseInt(date.slice(5, 7), 10);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** A period's first day. The key must be valid for the kind. */
export function boardPeriodStart(kind: BoardPeriodKind, key: string): string {
  if (kind === 'year') return `${key}-01-01`;
  if (kind === 'month') return `${key}-01`;
  const quarter = Number.parseInt(key.slice(6), 10);
  return `${key.slice(0, 4)}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`;
}

/** A period's last day. */
export function boardPeriodEnd(kind: BoardPeriodKind, key: string): string {
  return addDays(addMonths(boardPeriodStart(kind, key), boardPeriodMonths(kind)), -1);
}

/** The period `count` periods after `key` (before it when negative). */
export function shiftBoardPeriod(kind: BoardPeriodKind, key: string, count: number): string {
  return boardPeriodOf(
    kind,
    addMonths(boardPeriodStart(kind, key), count * boardPeriodMonths(kind)),
  );
}

/** The same period a year earlier. */
export function lastYearBoardPeriod(kind: BoardPeriodKind, key: string): string {
  return shiftBoardPeriod(kind, key, -12 / boardPeriodMonths(kind));
}

/** A closed range of business dates. */
export interface BoardRange {
  from: string;
  to: string;
}

/**
 * The range of a period as of `today`, the way the dashboard compares a month (ADR-0108 #11):
 * a running period (`asOf`) counts from its first day to the same position in it as today (the
 * month within the period and the day, a short month's last day where it has fewer), so that its
 * comparisons take the same days; an ended period is whole.
 */
export function boardPeriodRange(
  kind: BoardPeriodKind,
  key: string,
  asOf: { monthOffset: number; day: number } | null,
): BoardRange {
  const from = boardPeriodStart(kind, key);
  if (asOf === null) return { from, to: boardPeriodEnd(kind, key) };
  const month = addMonths(from, asOf.monthOffset).slice(0, 7);
  const day = Math.min(asOf.day, daysInMonth(month));
  return { from, to: `${month}-${String(day).padStart(2, '0')}` };
}

/** Where `today` stands in its period: the month within it and the day. */
export function boardPosition(
  kind: BoardPeriodKind,
  today: string,
): { monthOffset: number; day: number } {
  const start = boardPeriodStart(kind, boardPeriodOf(kind, today));
  const months =
    (Number.parseInt(today.slice(0, 4), 10) - Number.parseInt(start.slice(0, 4), 10)) * 12 +
    Number.parseInt(today.slice(5, 7), 10) -
    Number.parseInt(start.slice(5, 7), 10);
  return { monthOffset: months, day: Number.parseInt(today.slice(8, 10), 10) };
}
