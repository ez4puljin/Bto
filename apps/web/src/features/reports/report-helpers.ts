import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router';
import { BUSINESS_TZ } from '@/lib/dayjs';

/** A business date `YYYY-MM-DD` and a month `YYYY-MM` as the report pages accept them. */
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Shown where a figure has nothing to compare with or is unknown. */
export const NONE = '—';

export const monthStart = (): string => `${businessDate().slice(0, 7)}-01`;

/** The date range of a report page from `?from=&to=`, the current month to today by default. */
export function useRange() {
  const [search] = useSearchParams();
  const from = search.get('from') ?? monthStart();
  const to = search.get('to') ?? businessDate();
  return { from, to, valid: DATE.test(from) && DATE.test(to) && from <= to };
}

/** A positive whole number from the URL, or undefined. */
export function idParam(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const id = Number.parseInt(value, 10);
  return id > 0 ? id : undefined;
}

/** When the daily totals were rebuilt: «HH:mm» today, the date too on another day (Ulaanbaatar). */
export function refreshedText(iso: string): string {
  const at = dayjs(iso).tz(BUSINESS_TZ);
  return at.format('YYYY-MM-DD') === businessDate()
    ? at.format('HH:mm')
    : at.format('YYYY-MM-DD HH:mm');
}

/**
 * The change of a figure against an earlier one in percent with one decimal, or null when there
 * is nothing to compare with (an unknown or zero earlier figure).
 */
export function percentChange(current: string | null, previous: string | null): Decimal | null {
  if (current === null || previous === null) return null;
  const before = new Decimal(previous);
  if (before.isZero()) return null;
  return new Decimal(current).minus(before).div(before.abs()).times(100).toDecimalPlaces(1);
}

/** The change of a percentage in points (a margin), or null when either side is unknown. */
export function pointChange(current: string | null, previous: string | null): Decimal | null {
  if (current === null || previous === null) return null;
  return new Decimal(current).minus(previous).toDecimalPlaces(1);
}

/** A margin «12.5%», or «—». */
export function marginText(value: string | null): string {
  return value === null ? NONE : `${value}%`;
}

/** The href of a report page with these parameters (empty ones left out). */
export function reportHref(
  path: string,
  params: Record<string, string | number | null | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
