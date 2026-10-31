import { distanceMeters } from '@tugeel/shared/geo';
import { type AttendanceKind, HR_LIMITS } from '@tugeel/shared/hr';
import { weekdayOf } from '../dates/dates';

// The pure rules of «Ирц» (ADR-0131) as the phone words them: which punch comes next, whether the
// big button may be pressed, the nearest work site, and the day's live worked minutes.

export type AttendanceState = 'IN' | 'OUT' | null;

export interface SiteLike {
  id: number;
  name: string;
  lat: string;
  lng: string;
  radiusM: number;
}

export interface Fix {
  lat: number;
  lng: number;
  /** The fix's radius in metres; null when the phone does not say. */
  accuracyM: number | null;
}

/** Nothing today or «явсан» → the next punch is IN; «ирсэн» → OUT. */
export function nextKind(state: AttendanceState): AttendanceKind {
  return state === 'IN' ? 'OUT' : 'IN';
}

export interface NearestSite {
  site: SiteLike;
  distanceM: number;
  inside: boolean;
}

/** The site closest to the fix, and whether the fix lies inside its radius; null without sites. */
export function nearestSite(fix: Fix, sites: readonly SiteLike[]): NearestSite | null {
  let best: NearestSite | null = null;
  const here = { lat: String(fix.lat), lng: String(fix.lng) };
  for (const site of sites) {
    const distanceM = distanceMeters(here, { lat: site.lat, lng: site.lng });
    if (best === null || distanceM < best.distanceM) {
      best = { site, distanceM, inside: distanceM <= site.radiusM };
    }
  }
  return best;
}

/** Why the button is off, in the order the server would refuse (`errors.ATTENDANCE_*`). */
export type Blocker = 'NO_SITE' | 'NO_FIX' | 'IMPRECISE' | 'OUT_OF_RANGE';

/**
 * The server's rule on the phone: a fix exists, it is no looser than `HR_LIMITS.maxAccuracyM`
 * (200 m) and it lies inside the nearest site's radius. Null = the button may be pressed.
 */
export function blockerOf(
  fix: Fix | null,
  sites: readonly SiteLike[],
  nearest: NearestSite | null = fix ? nearestSite(fix, sites) : null,
): Blocker | null {
  if (sites.length === 0) return 'NO_SITE';
  if (!fix || !nearest) return 'NO_FIX';
  if (fix.accuracyM !== null && fix.accuracyM > HR_LIMITS.maxAccuracyM) return 'IMPRECISE';
  if (!nearest.inside) return 'OUT_OF_RANGE';
  return null;
}

/**
 * The day's worked minutes as the screen counts them: the server's figure at `now`, plus the
 * minutes passed since while the person is still in (the server counted the open IN up to `now`).
 */
export function liveWorkedMinutes(
  workedMinutes: number,
  state: AttendanceState,
  serverNow: string,
  clock: number,
): number {
  if (state !== 'IN') return workedMinutes;
  const since = Date.parse(serverNow);
  if (!Number.isFinite(since)) return workedMinutes;
  return workedMinutes + Math.max(0, Math.floor((clock - since) / 60_000));
}

/** Monday-first flags (`1111110`) read with the phone's own weekday (no time zones, dates.ts). */
export function isWorkdayFlag(workdays: string, date: string): boolean {
  const mondayFirst = (weekdayOf(date) + 6) % 7;
  return workdays[mondayFirst] === '1';
}
