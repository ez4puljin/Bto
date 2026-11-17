import { addDays } from '@tugeel/shared/time';
import { weekdayOf } from '../dates/dates';
import { isWorkdayFlag } from './status';

// The pure parts of the «Ирц» screen's week table: Monday to Sunday around today, the status chip of
// a day, the scheduled minutes and the points of a work site's circle on the map.

/** Monday and Sunday (`YYYY-MM-DD`) of the week that holds `today`, and its seven dates. */
export function weekOf(today: string): { from: string; to: string; dates: string[] } {
  const sinceMonday = (weekdayOf(today) + 6) % 7;
  const from = addDays(today, -sinceMonday);
  return {
    from,
    to: addDays(from, 6),
    dates: Array.from({ length: 7 }, (_, index) => addDays(from, index)),
  };
}

/** The months (`YYYY-MM`) a week spans: one, or two when it crosses a month's end. */
export function monthsOfWeek(dates: readonly string[]): [string, string] {
  const first = (dates[0] ?? '').slice(0, 7);
  const last = (dates[dates.length - 1] ?? '').slice(0, 7);
  return [first, last];
}

export type WeekChip = 'OK' | 'LATE' | 'EARLY' | 'ABSENT' | 'PLANNED' | 'OFF';

export interface WeekDayLike {
  status: 'PRESENT' | 'LATE' | 'ABSENT' | 'OFF';
  firstIn: string | null;
  lastOut: string | null;
  openIn: boolean;
}

/** `HH:MM` → minutes since midnight; null when it is not one. */
export function minutesOfClock(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** The minutes between the schedule's start and end; 0 when they do not make a day. */
export function scheduledMinutes(start: string, end: string): number {
  const from = minutesOfClock(start);
  const to = minutesOfClock(end);
  if (from === null || to === null || to <= from) return 0;
  return to - from;
}

/**
 * The chip of one row. A day the server does not list falls back on the schedule's weekday flags;
 * today (not yet punched) and the days to come are «ажлын өдөр»; a past day is «хэвийн» (in time),
 * «хоцорсон», «эрт явсан» (its last out, in Ulaanbaatar time, before the schedule's end) or absent.
 */
export function chipOf(input: {
  date: string;
  today: string;
  day: WeekDayLike | undefined;
  workdays: string;
  workEnd: string;
  /** The Ulaanbaatar `HH:mm` of an instant (dates.ts `ubTime`). */
  clockOf: (iso: string) => string;
}): WeekChip {
  const { date, today, day, workdays, workEnd, clockOf } = input;
  if (!day) {
    return isWorkdayFlag(workdays, date) ? 'PLANNED' : 'OFF';
  }
  if (day.status === 'OFF') return 'OFF';
  if (date > today) return 'PLANNED';
  if (date === today && day.firstIn === null) return 'PLANNED';
  if (day.status === 'ABSENT') return 'ABSENT';
  if (day.status === 'LATE') return 'LATE';
  if (day.lastOut !== null && !day.openIn && date < today) {
    const out = minutesOfClock(clockOf(day.lastOut));
    const end = minutesOfClock(workEnd);
    if (out !== null && end !== null && out < end) return 'EARLY';
  }
  return 'OK';
}

/** `07:05` → hours `07` and minutes `05` of a worked-minutes figure, for the table. */
export function paddedHoursAndMinutes(minutes: number): { hours: string; minutes: string } {
  const whole = Math.max(0, Math.round(minutes));
  const pad = (value: number) => String(value).padStart(2, '0');
  return { hours: pad(Math.floor(whole / 60)), minutes: pad(whole % 60) };
}

/** `2026-11-16` → `2026.11.16`. */
export function dotted(date: string): string {
  return date.replaceAll('-', '.');
}

/** `2026-11-16` → `11.16`. */
export function dottedShort(date: string): string {
  return date.slice(5, 10).replaceAll('-', '.');
}

/** The ring's fill: worked over scheduled minutes, 0…1 (0 without a schedule). */
export function ringFill(worked: number, scheduled: number): number {
  if (scheduled <= 0 || worked <= 0) return 0;
  return Math.min(1, worked / scheduled);
}

const EARTH_M = 6_371_008.8;

/** The ring of points (`[lng, lat]`, closed) of a circle of `radiusM` metres around a centre. */
export function circleRing(
  lat: number,
  lng: number,
  radiusM: number,
  steps = 64,
): [number, number][] {
  const points: [number, number][] = [];
  const latRad = (lat * Math.PI) / 180;
  for (let step = 0; step <= steps; step += 1) {
    const angle = (step / steps) * 2 * Math.PI;
    const dLat = ((radiusM * Math.cos(angle)) / EARTH_M) * (180 / Math.PI);
    const dLng = ((radiusM * Math.sin(angle)) / (EARTH_M * Math.cos(latRad))) * (180 / Math.PI);
    points.push([lng + dLng, lat + dLat]);
  }
  const first = points[0];
  if (first) points[steps] = first;
  return points;
}
