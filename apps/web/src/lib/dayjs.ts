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

/** Today in Ulaanbaatar with its weekday, e.g. "2026-10-13, Мягмар" (the home page). */
export function formatUbToday(): string {
  return dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD, dddd');
}
