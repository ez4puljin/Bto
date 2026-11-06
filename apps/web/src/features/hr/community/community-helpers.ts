import { isEmployeeLeft } from '@tugeel/shared/hr';
import { addDays, addMonths, businessDate } from '@tugeel/shared/time';
import { Angry, Frown, Laugh, type LucideIcon, Meh, Smile } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { MapPoint } from '@/components/map/geo-map';
import { formatUbMinute, ubInstant } from '@/lib/dayjs';
import type {
  HrCalendarItem,
  HrFeedbackStatus,
  HrLocationShare,
  HrMessage,
  HrPoll,
} from '../engagement-api';
import { useStaff } from '../workforce-api';

/* The rules and hooks the community pages share (ADR-0146); the components sit in the kit. */

/** The working employees, sorted, for the pickers and the filters. */
export function useWorkingStaff() {
  const staff = useStaff();
  return useMemo(
    () =>
      (staff.data ?? [])
        .filter((row) => !isEmployeeLeft(row))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, 'mn')),
    [staff.data],
  );
}

export const AUDIENCE_MODES = ['ALL', 'CHOSEN'] as const;
type AudienceMode = (typeof AUDIENCE_MODES)[number];

/** «Бүгд» or chosen people; `missing` asks for at least one once «Сонгосон» is on. */
export function useAudience() {
  const [mode, setMode] = useState<AudienceMode>('ALL');
  const [ids, setIds] = useState<number[]>([]);
  return {
    mode,
    setMode,
    ids,
    setIds,
    userIds: mode === 'ALL' ? [] : ids,
    missing: mode === 'CHOSEN' && ids.length === 0,
  };
}

/** A moment typed as a day and an hour in Ulaanbaatar; empty day: not set. */
export interface MomentDraft {
  date: string;
  time: string;
}

export const emptyMoment = (time = '09:00'): MomentDraft => ({ date: '', time });

export const momentInstant = (moment: MomentDraft): string | null =>
  moment.date === '' || moment.time === '' ? null : ubInstant(moment.date, moment.time);

export const percentOf = (value: number, total: number): number =>
  total <= 0 ? 0 : Math.round((value / total) * 100);

/** The five faces, glad to sad, with their token colours (a lucide icon each, no emoji). */
export const MOOD_FACES: readonly {
  score: 1 | 2 | 3 | 4 | 5;
  icon: LucideIcon;
  text: string;
  bar: string;
}[] = [
  { score: 5, icon: Laugh, text: 'text-success', bar: 'bg-success' },
  { score: 4, icon: Smile, text: 'text-[var(--series-4)]', bar: 'bg-[var(--series-4)]' },
  { score: 3, icon: Meh, text: 'text-muted-foreground', bar: 'bg-muted-foreground' },
  { score: 2, icon: Frown, text: 'text-warning', bar: 'bg-warning' },
  { score: 1, icon: Angry, text: 'text-destructive', bar: 'bg-destructive' },
];

/** The colour of a calendar item's mark; the kinds stay apart for a colour-blind reader. */
export const CALENDAR_MARKS: Record<HrCalendarItem['kind'], string> = {
  EVENT: 'bg-[var(--series-1)]',
  MEETING: 'bg-[var(--series-3)]',
  HOLIDAY: 'bg-[var(--series-5)]',
  BIRTHDAY: 'bg-[var(--series-2)]',
  ANNIVERSARY: 'bg-[var(--series-4)]',
};

export const monthOfDate = (date: string): string => date.slice(0, 7);
export const thisMonth = (): string => monthOfDate(businessDate());
export const shiftMonth = (month: string, by: number): string =>
  monthOfDate(addMonths(`${month}-01`, by));

/** Whether an item is on a day (an event of several days is on each of them). */
export const isOnDay = (item: HrCalendarItem, day: string): boolean =>
  item.date <= day && day <= (item.toDate ?? item.date);

/** The month's weeks, Monday first, with the neighbours' days filling the first and last week. */
export function monthWeeks(month: string): string[][] {
  const first = `${month}-01`;
  const parts = first.split('-').map((part) => Number.parseInt(part, 10));
  const sundayFirst = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, 1)).getUTCDay();
  const start = addDays(first, -((sundayFirst + 6) % 7));
  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const days = Array.from({ length: 7 }, (_, index) => addDays(start, week * 7 + index));
    if (week > 0 && !days.some((day) => monthOfDate(day) === month)) break;
    weeks.push(days);
  }
  return weeks;
}

export const MESSAGE_STATES = ['PUBLISHED', 'SCHEDULED', 'WITHDRAWN'] as const;
export type MessageState = (typeof MESSAGE_STATES)[number];

export function messageState(message: HrMessage): MessageState {
  if (message.withdrawnAt !== null) return 'WITHDRAWN';
  return Date.parse(message.publishAt) > Date.now() ? 'SCHEDULED' : 'PUBLISHED';
}

export const POLL_STATES = ['RUNNING', 'SCHEDULED', 'ENDED', 'CLOSED'] as const;
export type PollState = (typeof POLL_STATES)[number];

export function pollState(poll: HrPoll): PollState {
  if (poll.closedAt !== null) return 'CLOSED';
  if (poll.open) return 'RUNNING';
  return Date.parse(poll.startsAt) > Date.now() ? 'SCHEDULED' : 'ENDED';
}

export const FEEDBACK_STATUS_VARIANT = {
  NEW: 'warning',
  SEEN: 'default',
  DONE: 'success',
} as const satisfies Record<HrFeedbackStatus, string>;

/** A sent location as a map point. */
export const sharePoint = (share: HrLocationShare): MapPoint => ({
  id: String(share.id),
  lat: Number.parseFloat(share.lat),
  lng: Number.parseFloat(share.lng),
  label: `${share.fullName} · ${formatUbMinute(share.createdAt)}`,
  photoUrl: share.photoUrl,
});
