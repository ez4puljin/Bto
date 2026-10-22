import { addDays, addMonths } from '@tugeel/shared/time';
import type { DateRange } from '../dates/calendar';

// «Тооцооны хуулга» (ADR-0086): the store's statement on «Тооцоо» — the opening balance, the
// purchases (Дебит) and the payments and returns (Кредит), the closing balance — for any days.

/** The statement's first view: the last month, today included (10/20 → 09/21 – 10/20). */
export function lastMonthRange(today: string): DateRange {
  return { from: addDays(addMonths(today, -1), 1), to: today };
}

/** The chips over the statement (the Account board, 2026-10-21); any other days come from the calendar. */
export type StatementPreset = 'lastMonth' | 'thisMonth' | 'prevMonth';

export const STATEMENT_PRESETS: readonly StatementPreset[] = [
  'lastMonth',
  'thisMonth',
  'prevMonth',
];

/** A chip's days on `today`: «Энэ сар» is the 1st to today, «Өмнөх сар» the whole month before. */
export function statementRange(preset: StatementPreset, today: string): DateRange {
  const first = `${today.slice(0, 7)}-01`;
  switch (preset) {
    case 'lastMonth':
      return lastMonthRange(today);
    case 'thisMonth':
      return { from: first, to: today };
    case 'prevMonth':
      return { from: addMonths(first, -1), to: addDays(first, -1) };
  }
}

/** The chip a range is, if any; days picked on the calendar light the date chip instead. */
export function statementPresetOf(range: DateRange, today: string): StatementPreset | null {
  return (
    STATEMENT_PRESETS.find((preset) => {
      const days = statementRange(preset, today);
      return days.from === range.from && days.to === range.to;
    }) ?? null
  );
}

/** A statement amount as its column shows it: nothing for a zero. */
export function columnAmount(value: string): string | null {
  return /^-?0+(\.0+)?$/.test(value) ? null : value;
}
