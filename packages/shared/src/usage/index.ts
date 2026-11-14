/**
 * Which screens are actually used (ADR-0197). Every client counts, for itself, how often a screen
 * was opened and how long it stayed open, and sends the counts once a minute. Nothing about a
 * screen's content is sent, and nothing is kept per person beyond a day-mark that answers «how
 * many people», so the figures say what to improve without saying who did what.
 */

/** The three clients that count: the office web, the staff app, the stores' app «Bto300». */
export const USAGE_APPS = ['web', 'staff', 'customer'] as const;
export type UsageApp = (typeof USAGE_APPS)[number];

export function isUsageApp(value: unknown): value is UsageApp {
  return typeof value === 'string' && (USAGE_APPS as readonly string[]).includes(value);
}

export const USAGE = {
  /** Screens in one send: more than this and the rest waits for the next minute. */
  maxEvents: 60,
  /** A screen name's length. */
  screenMax: 120,
  /** How often a client sends what it has gathered. */
  flushMs: 60_000,
  /**
   * Longer than this on one screen is a screen left open, not a screen used: the time is cut here
   * so one forgotten tab does not outweigh a day's work.
   */
  maxSecondsPerOpen: 600,
  /** Opens counted for one screen in one send. */
  maxOpensPerEvent: 500,
  /** Days of counts kept. */
  keepDays: 400,
  /** Days the day-marks that answer «how many people» are kept; the counts themselves stay. */
  keepSeenDays: 120,
} as const;

/** One screen's share of a client's minute. */
export interface UsageEvent {
  screen: string;
  opens: number;
  seconds: number;
}

/** A segment that is plainly an id, so that `/order/4182` does not become its own screen. */
const ID_SEGMENT = /^\d+$/;
/** What a screen name may hold once the ids are out: `/sales/orders/:id`. */
const SCREEN_NAME = /^\/([a-z0-9:_-]+(\/[a-z0-9:_-]+)*)?$/;

export function usageScreenOk(screen: string): boolean {
  return screen.length > 0 && screen.length <= USAGE.screenMax && SCREEN_NAME.test(screen);
}

/** A segment that is not a known parameter but cannot be a screen of its own either. */
function unnamed(segment: string): string | null {
  if (ID_SEGMENT.test(segment)) return ':id';
  if (segment.length > 24) return ':x';
  return null;
}

/**
 * The web's screen name: the address with the parameter values put back as their names, so every
 * product page counts as one screen (`/catalog/products/:id`).
 */
export function screenKeyFromPath(
  pathname: string,
  params: Readonly<Record<string, string | undefined>> = {},
): string {
  const names = new Map<string, string>();
  for (const [name, value] of Object.entries(params)) {
    if (value) for (const part of value.split('/')) if (part) names.set(part, `:${name}`);
  }
  const parts = pathname.split('/').map((part) => {
    if (part === '') return part;
    return names.get(part) ?? unnamed(part) ?? part.toLowerCase();
  });
  const key = parts.join('/').replace(/\/+$/, '') || '/';
  return key.slice(0, USAGE.screenMax);
}

/**
 * The apps' screen name, from the route's own segments: expo-router already hands them as the route
 * was written (`['(staff)', 'order', '[id]']`), so only the group folders go and `[id]` becomes
 * `:id`. The app itself is already known, so `(staff)` would say nothing.
 */
export function screenKeyFromSegments(segments: readonly string[]): string {
  const parts: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith('(') || segment === '') continue;
    const dynamic = /^\[(?:\.\.\.)?(.+)\]$/.exec(segment);
    parts.push(dynamic?.[1] ? `:${dynamic[1].toLowerCase()}` : segment.toLowerCase());
  }
  const key = `/${parts.join('/')}`.replace(/\/+$/, '') || '/';
  return key.slice(0, USAGE.screenMax);
}

/**
 * The counts a client gathered, made fit to send: screens it may not name are dropped, a forgotten
 * tab's hours are cut back, and the busiest screens go first when there are too many. A screen
 * that only stayed open through the minute has no new open, and still counts its seconds.
 */
export function usageEventsToSend(events: readonly UsageEvent[]): UsageEvent[] {
  return events
    .filter((event) => usageScreenOk(event.screen))
    .map((event) => {
      const opens = Math.max(0, Math.min(Math.round(event.opens), USAGE.maxOpensPerEvent));
      const seconds = Math.min(
        Math.max(0, Math.round(event.seconds)),
        USAGE.maxSecondsPerOpen * Math.max(opens, 1),
      );
      return { screen: event.screen, opens, seconds };
    })
    .filter((event) => event.opens > 0 || event.seconds > 0)
    .sort((a, b) => b.opens - a.opens || b.seconds - a.seconds || a.screen.localeCompare(b.screen))
    .slice(0, USAGE.maxEvents);
}

/**
 * A client's counter (ADR-0197): which screen stands in front, since when, and what has gathered
 * since the last send. It knows nothing of browsers or phones — the client tells it when a screen
 * comes in front (`show`), when the window or the app goes out of sight (`hide`) and comes back
 * (`back`), and takes what gathered once a minute (`take`). Times are milliseconds from any clock.
 */
export class UsageMeter {
  private gathered = new Map<string, { opens: number; ms: number }>();
  private screen: string | null = null;
  private since = 0;
  private hidden = false;
  /** Milliseconds already counted for the open in front, so that a forgotten tab stops counting. */
  private counted = 0;

  /** A screen came in front. The same screen again (a filter changed its address) is no new open. */
  show(screen: string, now: number): void {
    if (screen === this.screen) return;
    this.settle(now);
    this.screen = screen;
    this.since = now;
    this.counted = 0;
    this.entry(screen).opens += 1;
  }

  /** The window or the app went out of sight: the time stops, the screen stays. */
  hide(now: number): void {
    this.settle(now);
    this.hidden = true;
  }

  /** Back in sight: the time runs again from here. */
  back(now: number): void {
    this.hidden = false;
    this.since = now;
  }

  /** What gathered since the last take, fit to send; the counter starts again from nothing. */
  take(now: number): UsageEvent[] {
    this.settle(now);
    const events = [...this.gathered].map(([screen, { opens, ms }]) => ({
      screen,
      opens,
      seconds: ms / 1000,
    }));
    this.gathered = new Map();
    return usageEventsToSend(events);
  }

  private entry(screen: string): { opens: number; ms: number } {
    let entry = this.gathered.get(screen);
    if (!entry) {
      entry = { opens: 0, ms: 0 };
      this.gathered.set(screen, entry);
    }
    return entry;
  }

  /** Adds the time the screen in front has stood since it was last counted. */
  private settle(now: number): void {
    if (this.screen === null || this.hidden) return;
    const room = USAGE.maxSecondsPerOpen * 1000 - this.counted;
    const ms = Math.min(Math.max(0, now - this.since), Math.max(0, room));
    this.since = now;
    if (ms <= 0) return;
    this.counted += ms;
    this.entry(this.screen).ms += ms;
  }
}
