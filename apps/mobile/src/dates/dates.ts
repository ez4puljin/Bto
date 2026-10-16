import { addDays, addMonths } from '@tugeel/shared/time';

// Calendar dates as `YYYY-MM-DD` strings, from the server's «today» (GET /sales-rep/context): the
// phone never asks Intl for a time zone (Hermes, ADR-0061 #3).

/** The day of the week of a date, 0 = Sunday … 6 = Saturday, without time zones. */
export function weekdayOf(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** The delivery dates offered: today and the next `count - 1` days. */
export function deliveryDays(today: string, count = 7): string[] {
  return Array.from({ length: count }, (_, index) => addDays(today, index));
}

/** `YYYY-MM` of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** A month moved by whole months (`2026-01`, -1 → `2025-12`). */
export function shiftMonth(month: string, months: number): string {
  return monthOf(addMonths(`${month}-01`, months));
}

/** `MM-DD` of a date, for chips and rows. */
export function shortDate(date: string): string {
  return date.slice(5, 10);
}

/** Wall-clock `HH:mm` of an ISO instant in Ulaanbaatar (UTC+8, no daylight saving). */
export function ubTime(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const shifted = new Date(at + 8 * 3600 * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** The Ulaanbaatar calendar date of an ISO instant (UTC+8, no daylight saving). */
export function ubDate(iso: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  return new Date(at + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
