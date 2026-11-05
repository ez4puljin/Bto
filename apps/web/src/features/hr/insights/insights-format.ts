import { Decimal } from '@tugeel/shared/money';
import { addDays } from '@tugeel/shared/time';
import { formatCount } from '@/lib/money';

/* The dashboard's small sums: shares, hours, the attendance range. Nothing here draws. */

export const UNKNOWN = 'UNKNOWN';

/** The day attendance began to be recorded (the staff app's first punches). */
export const ATTENDANCE_STARTED = '2026-11-04';

/** Attendance reads at most 62 days (the time report's limit, ADR-0144). */
const ATTENDANCE_MAX_DAYS = 62;

/** A whole percent of a whole; 0 of nothing. */
export function shareOf(part: number, whole: number): number {
  return whole <= 0 ? 0 : Math.round((part * 100) / whole);
}

/** Minutes as hours for reading: one decimal at most, thousands grouped. */
export function formatHours(minutes: number): string {
  const tenths = Math.round(minutes / 6);
  const whole = Math.trunc(tenths / 10);
  const rest = Math.abs(tenths % 10);
  return rest === 0 ? formatCount(whole) : `${formatCount(whole)}.${rest}`;
}

/** A dashboard's percent string as the number the chart draws; 0 for none. */
export function percentValue(value: string | null): number {
  return value === null ? 0 : new Decimal(value).toNumber();
}

/** The largest row, leaving out «unknown»; null when no known row has a count. */
export function topKnown<T extends { key: string; count: number }>(rows: readonly T[]): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.key === UNKNOWN || row.count <= 0) continue;
    if (!best || row.count > best.count) best = row;
  }
  return best;
}

export function sumOf<T>(rows: readonly T[], count: (row: T) => number): number {
  return rows.reduce((sum, row) => sum + count(row), 0);
}

/** A range the attendance read accepts: never after today, at most 62 days up to its end. */
export function clampAttendanceRange(
  from: string,
  to: string,
  today: string,
): { from: string; to: string; clamped: boolean } {
  const end = to > today ? today : to;
  const earliest = addDays(end, 1 - ATTENDANCE_MAX_DAYS);
  const start = from < earliest ? earliest : from > end ? end : from;
  return { from: start, to: end, clamped: start !== from || end !== to };
}

/** The tooltip's text goes in as HTML: names typed by people must stay text. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
