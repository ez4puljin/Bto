import dayjs from 'dayjs';
import { BUSINESS_TZ } from '@/lib/dayjs';

/** «09:07» for today's message, «11-18» for an older one. */
export function chatTime(iso: string): string {
  const at = dayjs(iso).tz(BUSINESS_TZ);
  return at.isSame(dayjs().tz(BUSINESS_TZ), 'day') ? at.format('HH:mm') : at.format('MM-DD');
}
