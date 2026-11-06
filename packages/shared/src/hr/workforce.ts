import { minutesOf, type Schedule, TIME_PATTERN } from './index';

/*
 * HR beyond the punch (ADR-0144, owner 2026-11-04, after studying timely.mn): employees with their
 * division, position and kind of employment; schedules laid out per weekday (fixed hours or a
 * flexible number of hours); time requests of the company's types, approved by HR; the reports by
 * day, by employee and over a period. The api, the web and the staff app share these rules.
 */

/** «Үндсэн ажилтан», «Туршилтын», «Гэрээт», «Цагийн», «Дадлагажигч». */
export const EMPLOYMENT_TYPES = [
  'PERMANENT',
  'PROBATION',
  'CONTRACT',
  'PART_TIME',
  'INTERN',
] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const EMPLOYEE_GENDERS = ['MALE', 'FEMALE'] as const;
export type EmployeeGender = (typeof EMPLOYEE_GENDERS)[number];

/** FIXED: set hours per weekday («Тогтмол»); FLEXIBLE: a number of hours, any time («Уян хатан»). */
export const SCHEDULE_KINDS = ['FIXED', 'FLEXIBLE'] as const;
export type ScheduleKind = (typeof SCHEDULE_KINDS)[number];

export const WORKFORCE_LIMITS = {
  maxName: 60,
  maxPosition: 80,
  maxScheduleName: 60,
  maxRequestNote: 300,
  maxDecisionNote: 200,
  /** A report covers at most this many days. */
  maxReportDays: 62,
  /** A request names at most this many days. */
  maxRequestDays: 62,
} as const;

/** One weekday of a schedule: Monday = 1 … Sunday = 7. */
export interface ScheduleDay {
  weekday: number;
  /** FIXED: the hours; FLEXIBLE: null. */
  start: string | null;
  end: string | null;
  /** The lunch break, both or neither. */
  breakStart: string | null;
  breakEnd: string | null;
  /** FLEXIBLE: the hours to work that day, in minutes; FIXED: computed. */
  minutes: number;
}

/** What one weekday asks: when (or a flexible amount) and how many minutes. */
export interface DayPlan {
  start: string | null;
  end: string | null;
  breakMinutes: number;
  /** The minutes to work: the span less the break, or the flexible amount. */
  minutes: number;
  flexible: boolean;
}

/** Monday first; null = a day off. */
export type WeekPlan = (DayPlan | null)[];

export type ScheduleCheck =
  { ok: true; days: ScheduleDay[] } | { ok: false; path: string; detail: string };

/**
 * A schedule's weekdays checked and cleaned: each weekday at most once, FIXED days with a start
 * before the end and a break inside them, FLEXIBLE days with 1–24 hours; at least one day.
 */
export function checkScheduleDays(kind: ScheduleKind, raw: readonly ScheduleDay[]): ScheduleCheck {
  if (raw.length === 0 || raw.length > 7) return { ok: false, path: 'days', detail: '1 to 7 days' };
  const seen = new Set<number>();
  const days: ScheduleDay[] = [];
  for (const [index, day] of raw.entries()) {
    const path = `days[${index}]`;
    if (!Number.isInteger(day.weekday) || day.weekday < 1 || day.weekday > 7) {
      return { ok: false, path: `${path}.weekday`, detail: '1 (Monday) to 7 (Sunday)' };
    }
    if (seen.has(day.weekday)) return { ok: false, path: `${path}.weekday`, detail: 'once' };
    seen.add(day.weekday);
    if (kind === 'FLEXIBLE') {
      if (!Number.isInteger(day.minutes) || day.minutes < 60 || day.minutes > 1440) {
        return { ok: false, path: `${path}.minutes`, detail: '1 to 24 hours' };
      }
      days.push({
        weekday: day.weekday,
        start: null,
        end: null,
        breakStart: null,
        breakEnd: null,
        minutes: day.minutes,
      });
      continue;
    }
    if (!day.start || !day.end || !TIME_PATTERN.test(day.start) || !TIME_PATTERN.test(day.end)) {
      return { ok: false, path: `${path}.start`, detail: 'HH:mm' };
    }
    if (minutesOf(day.end) <= minutesOf(day.start)) {
      return { ok: false, path: `${path}.end`, detail: 'after the start' };
    }
    const hasBreak = Boolean(day.breakStart) || Boolean(day.breakEnd);
    let breakMinutes = 0;
    if (hasBreak) {
      if (
        !day.breakStart ||
        !day.breakEnd ||
        !TIME_PATTERN.test(day.breakStart) ||
        !TIME_PATTERN.test(day.breakEnd) ||
        minutesOf(day.breakStart) < minutesOf(day.start) ||
        minutesOf(day.breakEnd) > minutesOf(day.end) ||
        minutesOf(day.breakEnd) <= minutesOf(day.breakStart)
      ) {
        return { ok: false, path: `${path}.breakStart`, detail: 'a break inside the hours' };
      }
      breakMinutes = minutesOf(day.breakEnd) - minutesOf(day.breakStart);
    }
    days.push({
      weekday: day.weekday,
      start: day.start,
      end: day.end,
      breakStart: hasBreak ? day.breakStart : null,
      breakEnd: hasBreak ? day.breakEnd : null,
      minutes: minutesOf(day.end) - minutesOf(day.start) - breakMinutes,
    });
  }
  return { ok: true, days: days.sort((a, b) => a.weekday - b.weekday) };
}

/** A schedule's weekdays as a week, Monday first. */
export function planOfDays(kind: ScheduleKind, days: readonly ScheduleDay[]): WeekPlan {
  return Array.from({ length: 7 }, (_, index) => {
    const day = days.find((entry) => entry.weekday === index + 1);
    if (!day) return null;
    const breakMinutes =
      day.breakStart && day.breakEnd ? minutesOf(day.breakEnd) - minutesOf(day.breakStart) : 0;
    return {
      start: kind === 'FIXED' ? day.start : null,
      end: kind === 'FIXED' ? day.end : null,
      breakMinutes,
      minutes: day.minutes,
      flexible: kind === 'FLEXIBLE',
    };
  });
}

/** The company's (or a person's own) single-hours schedule as a week (ADR-0131). */
export function planOfSchedule(schedule: Schedule): WeekPlan {
  const span = minutesOf(schedule.workEnd) - minutesOf(schedule.workStart);
  return Array.from({ length: 7 }, (_, index) =>
    schedule.workdays[index] === '1'
      ? {
          start: schedule.workStart,
          end: schedule.workEnd,
          breakMinutes: 0,
          minutes: Math.max(0, span),
          flexible: false,
        }
      : null,
  );
}

/**
 * The single-day `Schedule` `summarizeDay` reads for a date of a week plan: that weekday's hours
 * (a flexible day is never late), the week's workdays.
 */
export function scheduleOnDate(plan: WeekPlan, weekday: number, graceMinutes: number): Schedule {
  const day = plan[weekday] ?? null;
  return {
    workStart: day?.start ?? '00:00',
    workEnd: day?.end ?? '23:59',
    graceMinutes: day?.flexible ? 1440 : graceMinutes,
    workdays: plan.map((entry) => (entry ? '1' : '0')).join(''),
  };
}

/**
 * The kinds of time request (ADR-0144, timely's groups): NOT_WORKED — a day or hours off (leave,
 * holiday, sick); WORKED — away but working (a trip, remote); OVERTIME — extra hours worked;
 * OVERTIME_LEAVE — time off for overtime; PUNCH_CHOSEN — a missed punch at the time chosen;
 * PUNCH_SENT — a punch from outside the sites at the time sent; OTHER.
 */
export const REQUEST_GROUPS = [
  'NOT_WORKED',
  'WORKED',
  'OVERTIME',
  'OVERTIME_LEAVE',
  'PUNCH_CHOSEN',
  'PUNCH_SENT',
  'OTHER',
] as const;
export type RequestGroup = (typeof REQUEST_GROUPS)[number];

export const REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** A punch request names the punch it asks for. */
export const PUNCH_GROUPS: readonly RequestGroup[] = ['PUNCH_CHOSEN', 'PUNCH_SENT'];

/** The types the company starts with: timely's, in its order. */
export const DEFAULT_REQUEST_TYPES: readonly {
  name: string;
  group: RequestGroup;
  color: string;
  /** Whole days (from–to dates) rather than hours on one day. */
  wholeDays: boolean;
}[] = [
  { name: 'Чөлөө', group: 'NOT_WORKED', color: '#f59e0b', wholeDays: false },
  { name: 'Ээлжийн амралт', group: 'NOT_WORKED', color: '#10b981', wholeDays: true },
  { name: 'Өвчтэй', group: 'NOT_WORKED', color: '#ef4444', wholeDays: true },
  { name: 'Томилолт', group: 'WORKED', color: '#3b82f6', wholeDays: true },
  { name: 'Зайнаас ажиллах', group: 'WORKED', color: '#6366f1', wholeDays: true },
  { name: 'Цахимаар ажиллах', group: 'WORKED', color: '#8b5cf6', wholeDays: false },
  { name: 'Илүү цаг', group: 'OVERTIME', color: '#0ea5e9', wholeDays: false },
  { name: 'Илүү цагийн амралт', group: 'OVERTIME_LEAVE', color: '#14b8a6', wholeDays: false },
  { name: 'Цаг нөхөж бүртгүүлэх', group: 'PUNCH_CHOSEN', color: '#64748b', wholeDays: false },
  { name: 'Зайнаас цаг бүртгүүлэх', group: 'PUNCH_SENT', color: '#78716c', wholeDays: false },
];

/** A report day's status: the punch's (PRESENT, LATE, ABSENT, OFF) or a request's (LEAVE, AWAY). */
export const REPORT_STATUSES = [
  'PRESENT',
  'LATE',
  'ABSENT',
  'OFF',
  'LEAVE',
  'AWAY',
  'OPEN',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** An approved request as one day of a report sees it. */
export interface RequestOnDay {
  group: RequestGroup;
  typeName: string;
  /** The part of that day it covers, in minutes (a whole day: the day's plan). */
  minutes: number;
  wholeDay: boolean;
}

/**
 * A report day: the punch's summary over the day's plan with the approved requests on top — a
 * whole-day leave makes the day LEAVE, a whole-day trip AWAY (counted as the plan's minutes), an
 * absence covered by hours of leave stays ABSENT only if nothing covers it; overtime adds to the
 * total. `scheduledMinutes` is what the plan asks.
 */
export function reportDay(input: {
  plan: DayPlan | null;
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'OFF';
  workedMinutes: number;
  lateMinutes: number;
  requests: readonly RequestOnDay[];
}): {
  status: ReportStatus;
  scheduledMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  leaveMinutes: number;
  requestName: string | null;
  lateMinutes: number;
} {
  const scheduled = input.plan?.minutes ?? 0;
  const leave = input.requests.filter(
    (request) => request.group === 'NOT_WORKED' || request.group === 'OVERTIME_LEAVE',
  );
  const away = input.requests.filter((request) => request.group === 'WORKED');
  const overtime = input.requests
    .filter((request) => request.group === 'OVERTIME')
    .reduce((sum, request) => sum + request.minutes, 0);
  const wholeLeave = leave.find((request) => request.wholeDay);
  const wholeAway = away.find((request) => request.wholeDay);
  let status: ReportStatus = input.status;
  let worked = input.workedMinutes;
  let late = input.lateMinutes;
  let name: string | null = null;
  if (wholeLeave && input.status === 'ABSENT') {
    status = 'LEAVE';
    name = wholeLeave.typeName;
  } else if (wholeAway) {
    status = 'AWAY';
    name = wholeAway.typeName;
    worked = Math.max(worked, scheduled);
    late = 0;
  } else if (input.status === 'ABSENT' && leave.length > 0) {
    status = 'LEAVE';
    name = leave[0]?.typeName ?? null;
  } else if (away.length > 0) {
    worked += away.reduce((sum, request) => sum + request.minutes, 0);
    name = away[0]?.typeName ?? null;
  }
  return {
    status,
    scheduledMinutes: scheduled,
    workedMinutes: worked,
    overtimeMinutes: overtime,
    leaveMinutes: leave.reduce((sum, request) => sum + request.minutes, 0),
    requestName: name ?? leave[0]?.typeName ?? null,
    lateMinutes: late,
  };
}
