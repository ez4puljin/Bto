import dayjs from 'dayjs';
import { BUSINESS_TZ } from '@/lib/dayjs';

/** Today's business date in Ulaanbaatar, `YYYY-MM-DD`. */
export function todayInUb(): string {
  return dayjs().tz(BUSINESS_TZ).format('YYYY-MM-DD');
}
