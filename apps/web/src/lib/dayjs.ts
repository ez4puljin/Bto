import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import 'dayjs/locale/mn';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('mn');

/** Business dates and times are shown in Ulaanbaatar time (docs/architecture.md §12). */
export const BUSINESS_TZ = 'Asia/Ulaanbaatar';

export function formatUbDateTime(epochMs: number): string {
  return dayjs(epochMs).tz(BUSINESS_TZ).format('YYYY-MM-DD HH:mm:ss');
}

/** The Ulaanbaatar wall-clock time of an instant, «09:07» (the attendance pages, ADR-0131). */
export function formatUbTime(iso: string): string {
  return dayjs(iso).tz(BUSINESS_TZ).format('HH:mm');
}

/** The instant of an Ulaanbaatar date and wall-clock time («2026-10-31», «09:07») as ISO. */
export function ubInstant(date: string, time: string): string {
  return dayjs.tz(`${date}T${time}`, BUSINESS_TZ).toISOString();
}

/** Today in Ulaanbaatar with its weekday, e.g. "2026-10-13, Мягмар" (the home page). */
export function formatUbToday(): string {
  return dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD, dddd');
}
