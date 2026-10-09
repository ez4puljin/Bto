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
