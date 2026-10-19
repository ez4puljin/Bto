import { addDays, addMonths } from '@tugeel/shared/time';
import type { DateRange } from '../dates/calendar';

// «Тооцооны хуулга» (ADR-0084): the store's statement on «Тооцоо» — the opening balance, the
// purchases (Дебит) and the payments and returns (Кредит), the closing balance — for any days.

/** The statement's first view: the last month, today included (10/20 → 09/21 – 10/20). */
export function lastMonthRange(today: string): DateRange {
  return { from: addDays(addMonths(today, -1), 1), to: today };
}

/** A statement amount as its column shows it: nothing for a zero. */
export function columnAmount(value: string): string | null {
  return /^-?0+(\.0+)?$/.test(value) ? null : value;
}
