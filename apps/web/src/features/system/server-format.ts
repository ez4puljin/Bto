// Pure helpers of the server panel on «Системийн төлөв», tested in server-panel.test.tsx.

export interface ServerSample {
  t: number;
  cpu: number;
  mem: number;
}

/** One hour at one point every five seconds: what the api keeps, and what the page keeps. */
export const HISTORY_POINTS = 720;

/**
 * The points the page holds with the newer ones the api just sent, oldest first, without a point
 * twice and never more than `limit`.
 */
export function mergeHistory(
  held: readonly ServerSample[],
  fresh: readonly ServerSample[],
  limit = HISTORY_POINTS,
): ServerSample[] {
  const last = held.at(-1)?.t ?? -1;
  const merged = [...held, ...fresh.filter((sample) => sample.t > last)];
  return merged.length > limit ? merged.slice(merged.length - limit) : merged;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** `31.7 GB`: binary steps (1024), as the operating system's own tools count memory and disks. */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${UNITS[unit]}`;
}

/** `12.4%`. */
export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export interface DurationParts {
  days: number;
  hours: number;
  minutes: number;
}

/** Whole days, hours and minutes of a number of seconds. */
export function durationParts(seconds: number): DurationParts {
  const whole = Math.max(0, Math.floor(seconds));
  return {
    days: Math.floor(whole / 86_400),
    hours: Math.floor((whole % 86_400) / 3_600),
    minutes: Math.floor((whole % 3_600) / 60),
  };
}

export type Level = 'ok' | 'warn' | 'high';

/** How full a meter is: calm below 70 %, a warning from there, alarming from 90 %. */
export function levelOf(percent: number): Level {
  if (percent >= 90) return 'high';
  if (percent >= 70) return 'warn';
  return 'ok';
}
