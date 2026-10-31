import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { BUSINESS_TZ } from '../time';

dayjs.extend(utc);
dayjs.extend(timezone);

/*
 * Attendance (ADR-0131): the rules the api, the web dashboard and the staff app share — what a
 * punch is, the company schedule's shape, and how a day's events become one row (first in, last
 * out, worked and late minutes, status). The database checks only the generic shapes.
 */

export const ATTENDANCE_KINDS = ['IN', 'OUT'] as const;
export type AttendanceKind = (typeof ATTENDANCE_KINDS)[number];

/** APP: punched on the phone inside a work site; OFFICE: typed by HR as a correction. */
export const ATTENDANCE_SOURCES = ['APP', 'OFFICE'] as const;
export type AttendanceSource = (typeof ATTENDANCE_SOURCES)[number];

export const HR_LIMITS = {
  maxSiteName: 60,
  minRadiusM: 30,
  maxRadiusM: 2000,
  defaultRadiusM: 150,
  /** A fix looser than this cannot prove the phone is inside a site. */
  maxAccuracyM: 200,
  maxNote: 200,
  maxGraceMinutes: 120,
} as const;

/** `HH:mm`, 24-hour. */
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Seven flags, Monday first: `1111100` = Monday to Friday. */
export const WORKDAYS_PATTERN = /^[01]{7}$/;

export interface Schedule {
  workStart: string;
  workEnd: string;
  graceMinutes: number;
  workdays: string;
}

export const DEFAULT_SCHEDULE: Schedule = {
  workStart: '09:00',
  workEnd: '18:00',
  graceMinutes: 10,
  workdays: '1111110',
};

/** Minutes since midnight of an `HH:mm` time. */
export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':');
  return Number.parseInt(hours ?? '0', 10) * 60 + Number.parseInt(minutes ?? '0', 10);
}

/** `HH:mm` of a minute count (480 → «08:00»); hours beyond a day wrap. */
export function timeOf(minutes: number): string {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
}

/** Monday = 0 … Sunday = 6 of a `YYYY-MM-DD` date. */
export function weekdayIndex(date: string): number {
  return (dayjs.tz(date, BUSINESS_TZ).day() + 6) % 7;
}

export function isWorkday(workdays: string, date: string): boolean {
  return workdays[weekdayIndex(date)] === '1';
}

/** Minutes since midnight, Ulaanbaatar time, of an instant. */
export function ubMinutesOf(iso: string | Date): number {
  const at = dayjs(iso).tz(BUSINESS_TZ);
  return at.hour() * 60 + at.minute();
}

export interface AttendanceEventLike {
  kind: AttendanceKind;
  /** ISO instant. */
  at: string;
}

export type DayStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'OFF';

export interface DaySummary {
  firstIn: string | null;
  lastOut: string | null;
  /** Minutes between each IN and the OUT after it; an open IN counts up to `now` on the day itself. */
  workedMinutes: number;
  /** How late the first IN was against the start plus the grace, 0 when on time. */
  lateMinutes: number;
  /** The day ended on an IN with no OUT («явсан дараагүй»). */
  openIn: boolean;
  status: DayStatus;
}

/**
 * One day of one person from their events (oldest first), the schedule that applies to them and
 * the moment of reading. A day without events is ABSENT on a workday, OFF otherwise; a day with an
 * IN is LATE when the first IN comes after the start plus the grace, else PRESENT.
 */
export function summarizeDay(
  date: string,
  events: readonly AttendanceEventLike[],
  schedule: Schedule,
  now: Date = new Date(),
): DaySummary {
  let firstIn: string | null = null;
  let lastOut: string | null = null;
  let openSince: string | null = null;
  let worked = 0;
  for (const event of events) {
    if (event.kind === 'IN') {
      firstIn ??= event.at;
      openSince ??= event.at;
    } else {
      lastOut = event.at;
      if (openSince !== null) {
        worked += minutesBetween(openSince, event.at);
        openSince = null;
      }
    }
  }
  const today = dayjs(now).tz(BUSINESS_TZ).format('YYYY-MM-DD');
  if (openSince !== null && date === today) worked += minutesBetween(openSince, now.toISOString());
  const late =
    firstIn === null
      ? 0
      : Math.max(0, ubMinutesOf(firstIn) - minutesOf(schedule.workStart) - schedule.graceMinutes);
  const status: DayStatus =
    firstIn === null
      ? isWorkday(schedule.workdays, date)
        ? 'ABSENT'
        : 'OFF'
      : late > 0
        ? 'LATE'
        : 'PRESENT';
  return {
    firstIn,
    lastOut,
    workedMinutes: worked,
    lateMinutes: late,
    openIn: openSince !== null,
    status,
  };
}

function minutesBetween(from: string, to: string): number {
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
}

/** «7 ц 35 мин» pieces of a minute count, for both the web and the app to word. */
export function hoursAndMinutes(minutes: number): { hours: number; minutes: number } {
  const whole = Math.max(0, Math.round(minutes));
  return { hours: Math.floor(whole / 60), minutes: whole % 60 };
}
