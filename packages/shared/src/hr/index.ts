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

/** APP: punched on the phone inside a work site; OFFICE: typed by HR as a correction; REQUEST: an approved time request's punch (ADR-0144). */
export const ATTENDANCE_SOURCES = ['APP', 'OFFICE', 'REQUEST'] as const;
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

// Employees, schedules, time requests and the reports (ADR-0144).
export * from './workforce';

/**
 * Who has left (ADR-0145): a staff user and an employee are one record, so a closed account is an
 * employee gone, with or without the date HR gives when marking it.
 */
export const isEmployeeLeft = (employee: { status: string; leftOn: string | null }): boolean =>
  employee.status === 'DISABLED' || employee.leftOn !== null;

// ── The staff's own side (ADR-0146) ─────────────────────────────────────────

export const EDUCATION_LEVELS = [
  'SECONDARY_INCOMPLETE',
  'SECONDARY',
  'VOCATIONAL',
  'BACHELOR',
  'MASTER',
  'DOCTOR',
  'SCIENCE_DOCTOR',
  'PROFESSOR',
  'HONORARY_DOCTOR',
] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const MARITAL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const JOB_LEVELS = ['EXECUTIVE', 'MANAGEMENT', 'SENIOR', 'MID', 'ENTRY'] as const;
export type JobLevel = (typeof JOB_LEVELS)[number];

export const LEFT_REASON_KINDS = [
  'PERSONAL',
  'COMPANY',
  'CONTRACT_END',
  'RETIRED',
  'OTHER',
] as const;
export type LeftReasonKind = (typeof LEFT_REASON_KINDS)[number];

/** A notice pops up in the staff app; news is read from its list (ADR-0146 #2). */
export const MESSAGE_KINDS = ['NOTICE', 'NEWS'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** A vote is one single-choice question; a survey holds several of any kind (ADR-0146 #3). */
export const POLL_KINDS = ['VOTE', 'SURVEY'] as const;
export type PollKind = (typeof POLL_KINDS)[number];

export const POLL_QUESTION_KINDS = ['SINGLE', 'MULTI', 'TEXT', 'SCALE'] as const;
export type PollQuestionKind = (typeof POLL_QUESTION_KINDS)[number];

export const FEEDBACK_CATEGORIES = ['SUGGESTION', 'COMPLAINT', 'QUESTION', 'OTHER'] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export const FEEDBACK_STATUSES = ['NEW', 'SEEN', 'DONE'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

/**
 * What a staff app already installed knows how to draw (ADR-0171): every calendar type stands on one
 * of these, so a type HR adds reaches an old app as `EVENT` rather than as a word it cannot read.
 */
export const HR_EVENT_KINDS = ['EVENT', 'MEETING', 'HOLIDAY'] as const;
export type HrEventKind = (typeof HR_EVENT_KINDS)[number];

/** What «Энэ сарын үйл явдлууд» shows on a day: HR's events, birthdays and work anniversaries. */
export const CALENDAR_ITEM_KINDS = [...HR_EVENT_KINDS, 'BIRTHDAY', 'ANNIVERSARY'] as const;
export type CalendarItemKind = (typeof CALENDAR_ITEM_KINDS)[number];

/** A mood's five faces, sad to glad. */
export const MOOD_SCORES = [1, 2, 3, 4, 5] as const;

export const ENGAGEMENT_LIMITS = {
  maxEventTypeName: 40,
  maxTitle: 120,
  maxBody: 4000,
  maxNote: 500,
  maxCategory: 40,
  maxDistrict: 60,
  maxChildren: 12,
  maxQuestions: 30,
  minOptions: 2,
  maxOptions: 20,
  maxOptionText: 200,
  maxAnswerText: 2000,
  maxRecipients: 2000,
  scaleMax: 5,
} as const;

/** The bands of the dashboard's charts: the upper bound in months or years, null for the last. */
export const TENURE_BANDS = [
  { key: '0-6m', months: 6 },
  { key: '6m-1y', months: 12 },
  { key: '1-2y', months: 24 },
  { key: '2-3y', months: 36 },
  { key: '3y+', months: null },
] as const;
export const AGE_BANDS = [
  { key: '18-25', years: 26 },
  { key: '26-33', years: 34 },
  { key: '34-41', years: 42 },
  { key: '42-49', years: 50 },
  { key: '50+', years: null },
] as const;
export const CHILD_AGE_BANDS = [
  { key: '0-2', years: 3 },
  { key: '3-5', years: 6 },
  { key: '6-10', years: 11 },
  { key: '11-15', years: 16 },
  { key: '16+', years: null },
] as const;

/** Whole years between two `YYYY-MM-DD` dates (an age, or a tenure in years). */
export function yearsBetween(from: string, to: string): number {
  const years = Number.parseInt(to.slice(0, 4), 10) - Number.parseInt(from.slice(0, 4), 10);
  return to.slice(5) >= from.slice(5) ? years : years - 1;
}

/** Whole months between two `YYYY-MM-DD` dates. */
export function monthsBetween(from: string, to: string): number {
  const months =
    (Number.parseInt(to.slice(0, 4), 10) - Number.parseInt(from.slice(0, 4), 10)) * 12 +
    Number.parseInt(to.slice(5, 7), 10) -
    Number.parseInt(from.slice(5, 7), 10);
  return to.slice(8) >= from.slice(8) ? months : months - 1;
}

/** The band a whole-year figure falls in. */
export function bandOfYears<K extends string>(
  bands: readonly { key: K; years: number | null }[],
  years: number,
): K | null {
  for (const band of bands) if (band.years === null || years < band.years) return band.key;
  return null;
}

/** The band a tenure in whole months falls in. */
export function tenureBand(months: number): (typeof TENURE_BANDS)[number]['key'] {
  for (const band of TENURE_BANDS)
    if (band.months === null || months < band.months) return band.key;
  return '3y+';
}
