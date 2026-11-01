// Calendar arithmetic on `YYYY-MM-DD` / `YYYY-MM` / `HH:mm` strings for the Mongolian date
// inputs (owner 2026-11-01: «Системд байгаа бүх calendar-ийг монгол хэлтэй болго»), without time
// zones: a business date is already a day in Ulaanbaatar.

const pad = (value: number) => String(value).padStart(2, '0');

/** Days in a `YYYY-MM` month. */
export function daysInMonth(month: string): number {
  const [year = 0, mon = 1] = month.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

/** The weekday of a date: 0 = Monday … 6 = Sunday (the Mongolian week). */
export function weekdayOf(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number.parseInt(part, 10));
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/** A `YYYY-MM` month moved by `delta` months. */
export function shiftMonth(month: string, delta: number): string {
  const [year = 0, mon = 1] = month.split('-').map((part) => Number.parseInt(part, 10));
  const index = year * 12 + (mon - 1) + delta;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}

/** A `YYYY-MM-DD` date moved by `delta` days. */
export function shiftDay(date: string, delta: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map((part) => Number.parseInt(part, 10));
  const at = new Date(Date.UTC(year, month - 1, day + delta));
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}`;
}

/** A month's grid, Monday first: null before the 1st, then the days. */
export function monthGrid(month: string): (string | null)[] {
  const blanks = weekdayOf(`${month}-01`);
  const cells: (string | null)[] = Array.from({ length: blanks }, () => null);
  for (let day = 1; day <= daysInMonth(month); day += 1) cells.push(`${month}-${pad(day)}`);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** Inside `[min, max]` (either end optional). */
export function inRange(value: string, min?: string, max?: string): boolean {
  return (
    (!min || value >= min.slice(0, value.length)) && (!max || value <= max.slice(0, value.length))
  );
}

/**
 * A typed date as `YYYY-MM-DD`, or null: «2026-11-01», «2026.11.01», «2026/11/1» or «20261101»
 * — a real day of the calendar.
 */
export function parseDateText(text: string): string | null {
  const value = text.trim();
  const match =
    /^(\d{4})[-./ ](\d{1,2})[-./ ](\d{1,2})$/.exec(value) ?? /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  const day = Number.parseInt(match[3] ?? '', 10);
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null;
  const monthText = `${year}-${pad(month)}`;
  if (day > daysInMonth(monthText)) return null;
  return `${monthText}-${pad(day)}`;
}

/** A typed month as `YYYY-MM`, or null: «2026-11», «2026.11», «2026/1» or «202611». */
export function parseMonthText(text: string): string | null {
  const value = text.trim();
  const match = /^(\d{4})[-./ ](\d{1,2})$/.exec(value) ?? /^(\d{4})(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number.parseInt(match[1] ?? '', 10);
  const month = Number.parseInt(match[2] ?? '', 10);
  if (year < 1000 || month < 1 || month > 12) return null;
  return `${year}-${pad(month)}`;
}

/** A typed time as 24-hour `HH:mm`, or null: «8:30», «08.30», «0830». */
export function parseTimeText(text: string): string | null {
  const value = text.trim();
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(value) ?? /^(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number.parseInt(match[1] ?? '', 10);
  const minutes = Number.parseInt(match[2] ?? '', 10);
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** The parts of a `YYYY-MM(-DD)` value as numbers. */
export function partsOf(value: string): { year: number; month: number; day: number } {
  const [year = 0, month = 1, day = 1] = value.split('-').map((part) => Number.parseInt(part, 10));
  return { year, month, day };
}
