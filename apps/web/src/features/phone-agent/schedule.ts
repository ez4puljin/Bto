import type { PhoneSchedule } from './phone-agent-api';

export const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** One weekday's working range as the form holds it; `null`: a day off. */
export interface DayRange {
  from: string;
  to: string;
}

export interface ScheduleDraft {
  /** The first interval of each weekday; `null` is a day off. */
  days: Record<Weekday, DayRange | null>;
  /** The intervals after the first one and the dated exceptions come back unchanged. */
  rest: Record<Weekday, string[][]>;
  exceptions: PhoneSchedule['exceptions'];
}

export function draftOf(schedule: PhoneSchedule | undefined): ScheduleDraft {
  const days = {} as ScheduleDraft['days'];
  const rest = {} as ScheduleDraft['rest'];
  for (const day of WEEKDAYS) {
    const intervals = schedule?.week[day] ?? [];
    const first = intervals[0];
    days[day] = first ? { from: first[0] ?? '', to: first[1] ?? '' } : null;
    rest[day] = intervals.slice(1);
  }
  return { days, rest, exceptions: schedule?.exceptions ?? [] };
}

/** The api's schedule shape: `week` has all seven days, a day off is `[]`. */
export function scheduleOf(draft: ScheduleDraft): PhoneSchedule {
  const week: PhoneSchedule['week'] = {};
  for (const day of WEEKDAYS) {
    const range = draft.days[day];
    week[day] = range ? [[range.from, range.to], ...draft.rest[day]] : [];
  }
  return { week, exceptions: draft.exceptions };
}

/** The weekdays whose range is empty or does not end after it begins. */
export function badDays(draft: ScheduleDraft): Weekday[] {
  return WEEKDAYS.filter((day) => {
    const range = draft.days[day];
    return range !== null && (!range.from || !range.to || range.from >= range.to);
  });
}
