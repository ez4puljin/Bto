import { REP_ORDER_RANGE_MAX_DAYS } from '@tugeel/shared/sales';
import { addDays } from '@tugeel/shared/time';
import { weekdayOf } from './dates';

// Calendar arithmetic on `YYYY-MM-DD` strings for the date sheets (ADR-0066), without time zones.

/** A cell of a month's grid: a blank before the 1st, or a day. */
export type CalendarCell =
  { kind: 'blank'; key: string } | { kind: 'day'; date: string; day: number };

const pad = (value: number) => String(value).padStart(2, '0');

/** Days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const [year = 0, mon = 1] = month.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/** A month's grid, Monday first (the design's «Да Мя Лх Пү Ба Бя Ня»). */
export function monthGrid(month: string): CalendarCell[] {
  const first = `${month}-01`;
  // weekdayOf: 0 = Sunday; Monday-first leaves (weekday + 6) % 7 blanks.
  const blanks = (weekdayOf(first) + 6) % 7;
  const cells: CalendarCell[] = Array.from({ length: blanks }, (_, index) => ({
    kind: 'blank',
    key: `blank-${index}`,
  }));
  for (let day = 1; day <= daysInMonth(month); day += 1) {
    cells.push({ kind: 'day', date: `${month}-${pad(day)}`, day });
  }
  return cells;
}

/** Days from `from` to `to`, both included. */
export function daysBetween(from: string, to: string): number {
  const at = (date: string) => {
    const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number.parseInt(part, 10));
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((at(to) - at(from)) / 86_400_000) + 1;
}

export type RangePreset = 'today' | 'yesterday' | 'week' | 'twoWeeks' | 'month';

export const RANGE_PRESETS: readonly RangePreset[] = [
  'today',
  'yesterday',
  'week',
  'twoWeeks',
  'month',
];

export interface DateRange {
  from: string;
  to: string;
}

/** A preset's days on `today`: «7 хоног» is today and the 6 before it. */
export function presetRange(preset: RangePreset, today: string): DateRange {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const yesterday = addDays(today, -1);
      return { from: yesterday, to: yesterday };
    }
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'twoWeeks':
      return { from: addDays(today, -13), to: today };
    case 'month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
  }
}

/** The preset a range is, if any (its chip shows as chosen). */
export function presetOf(range: DateRange, today: string): RangePreset | null {
  return (
    RANGE_PRESETS.find((preset) => {
      const days = presetRange(preset, today);
      return days.from === range.from && days.to === range.to;
    }) ?? null
  );
}

/** Which end of the range the next tap sets. */
export type RangeEnd = 'start' | 'end';

/**
 * A tap on a day of the range picker, as the design's board answers it: setting the start moves
 * the end along when the start passes it; setting the end before the start swaps them. A range is
 * kept within REP_ORDER_RANGE_MAX_DAYS by moving its other end.
 */
export function pickDay(
  range: DateRange,
  picking: RangeEnd,
  date: string,
): { range: DateRange; picking: RangeEnd } {
  let next: { range: DateRange; picking: RangeEnd };
  if (picking === 'start') {
    next = { range: { from: date, to: date > range.to ? date : range.to }, picking: 'end' };
    if (daysBetween(next.range.from, next.range.to) > REP_ORDER_RANGE_MAX_DAYS) {
      next.range.to = addDays(date, REP_ORDER_RANGE_MAX_DAYS - 1);
    }
  } else if (date < range.from) {
    next = { range: { from: date, to: range.from }, picking: 'start' };
  } else {
    next = { range: { from: range.from, to: date }, picking: 'start' };
  }
  if (daysBetween(next.range.from, next.range.to) > REP_ORDER_RANGE_MAX_DAYS) {
    next.range.from = addDays(next.range.to, -(REP_ORDER_RANGE_MAX_DAYS - 1));
  }
  return next;
}

/** «10/16» of a date. */
export function monthDay(date: string): string {
  return `${date.slice(5, 7)}/${date.slice(8, 10)}`;
}

/** How a day is called relative to today: «Өнөөдөр», «Өчигдөр», «Маргааш», or by its date. */
export type DayName = 'today' | 'yesterday' | 'tomorrow' | 'date';

export function dayNameOf(date: string, today: string): DayName {
  if (date === today) return 'today';
  if (date === addDays(today, -1)) return 'yesterday';
  if (date === addDays(today, 1)) return 'tomorrow';
  return 'date';
}
