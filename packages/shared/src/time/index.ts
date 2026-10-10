import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/** Business dates (effective_date, report periods, billIdSuffix day) are Ulaanbaatar dates, UTC+8. */
export const BUSINESS_TZ = 'Asia/Ulaanbaatar';

/** The Ulaanbaatar calendar date of an instant as `YYYY-MM-DD`; never derive it from a UTC string. */
export function businessDate(at: Date = new Date()): string {
  return dayjs(at).tz(BUSINESS_TZ).format('YYYY-MM-DD');
}

/** An instant as Ulaanbaatar wall-clock time, `YYYY-MM-DD HH:mm`, for operators (CLI, logs). */
export function businessDateTime(at: Date): string {
  return dayjs(at).tz(BUSINESS_TZ).format('YYYY-MM-DD HH:mm');
}

/** The Ulaanbaatar calendar year of an instant, e.g. the `period` of yearly document numbers. */
export function businessYear(at: Date = new Date()): string {
  return dayjs(at).tz(BUSINESS_TZ).format('YYYY');
}

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && dayjs.utc(value).format('YYYY-MM-DD') === value;
}

/** A plain `YYYY-MM-DD` date moved by whole calendar days. */
export function addDays(date: string, days: number): string {
  return dayjs.utc(date).add(days, 'day').format('YYYY-MM-DD');
}
