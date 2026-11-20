import { businessDateTime } from '@tugeel/shared/time';

// The phone AI order line's values and pure rules (docs/modules/phone-agent.md, ADR-0232). The
// database checks the same lists.

/**
 * How a call ended (ADR-0232 #2): an order was placed; only an order's status was told; a callback
 * task was left; the caller was not recognised and left nothing; nothing came of it; the agent or
 * the bridge failed.
 */
export const PHONE_CALL_OUTCOMES = [
  'ORDERED',
  'STATUS_ONLY',
  'CALLBACK',
  'NO_MATCH',
  'ABANDONED',
  'FAILED',
] as const;
export type PhoneCallOutcome = (typeof PHONE_CALL_OUTCOMES)[number];

/**
 * Why the line did not answer a call: staff answer in working hours; the line is switched off; no
 * stage takes PHONE_AI orders; the agent is not configured or did not give a signed URL in time.
 */
export const PHONE_DECLINE_REASONS = [
  'WORKING_HOURS',
  'LINE_INACTIVE',
  'AI_CLOSED',
  'AGENT_UNAVAILABLE',
] as const;
export type PhoneDeclineReason = (typeof PHONE_DECLINE_REASONS)[number];

export const PHONE_MESSAGE_ROLES = ['USER', 'AGENT', 'TOOL'] as const;
export type PhoneMessageRole = (typeof PHONE_MESSAGE_ROLES)[number];

/** Where a stored message came from: the bridge during the call, or the reconcile job after it. */
export const PHONE_MESSAGE_SOURCES = ['BRIDGE', 'RECONCILED'] as const;
export type PhoneMessageSource = (typeof PHONE_MESSAGE_SOURCES)[number];

export const PHONE_CALLBACK_STATUSES = ['OPEN', 'DONE', 'DROPPED'] as const;
export type PhoneCallbackStatus = (typeof PHONE_CALLBACK_STATUSES)[number];

/** What the bridge says ended the call. */
export const PHONE_END_REASONS = [
  'COMPLETED',
  'CALLER_HANGUP',
  'TIMEOUT',
  'SILENCE',
  'ERROR',
] as const;
export type PhoneEndReason = (typeof PHONE_END_REASONS)[number];

/** The agent's client tools (ADR-0232 #6), by the name the agent's configuration uses. */
export const PHONE_TOOLS = [
  'search_products',
  'check_availability',
  'quote',
  'place_order',
  'order_status',
  'new_products',
  'request_callback',
  'end_call',
] as const;
export type PhoneTool = (typeof PHONE_TOOLS)[number];

export function isPhoneTool(value: string): value is PhoneTool {
  return (PHONE_TOOLS as readonly string[]).includes(value);
}

export const PHONE_LIMITS = {
  nameMax: 60,
  greetingMax: 500,
  callRefMax: 100,
  /** Events one batch may carry. */
  eventsMax: 200,
  textMax: 4_000,
  /** A call's sequence numbers. */
  seqMax: 100_000,
  /** One call, in milliseconds and in seconds: far above the bridge's own 10 minutes. */
  atMsMax: 4 * 3_600_000,
  durationMax: 4 * 3_600,
  conversationIdMax: 100,
  queryMax: 100,
  searchRows: 5,
  quoteLines: 20,
  newProductsMax: 3,
  reasonMax: 500,
  noteMax: 300,
  orderNumberMax: 40,
  /** Dated exceptions a schedule keeps. */
  exceptionsMax: 60,
  /** Working intervals of one day. */
  intervalsMax: 4,
  /** The station is «холбогдсон» when it called within this long. */
  onlineSeconds: 120,
  /** The signed URL must come within this long, or the phone rings normally (the 3 s budget). */
  signedUrlTimeoutMs: 1_500,
  /** A call the bridge never ended is closed after this long (ADR-0232 #3). */
  abandonedAfterMinutes: 15,
  /** Own orders `order_status` tells without a number. */
  statusOrders: 3,
} as const;

/** `HH:MM`, 00:00 … 24:00: a working interval is `[from, to)`. */
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const WEEKDAY_KEYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
export type WeekdayKey = (typeof WEEKDAY_KEYS)[number];

export type WorkingInterval = readonly [from: string, to: string];

/**
 * When staff answer the phone themselves (ADR-0232 answer 5), in Asia/Ulaanbaatar: per ISO weekday
 * (1 = Monday … 7 = Sunday) the working intervals, and dated exceptions that replace their day
 * (a holiday: no intervals; a long day: its own). Outside these the AI answers.
 */
export interface PhoneSchedule {
  week: Record<WeekdayKey, WorkingInterval[]>;
  exceptions: { date: string; intervals: WorkingInterval[] }[];
}

/** No working hours at all: the AI answers at any time once the line is active. */
export function emptySchedule(): PhoneSchedule {
  return {
    week: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] },
    exceptions: [],
  };
}

export interface ScheduleIssue {
  path: string;
  code: 'shape' | 'time' | 'order' | 'date' | 'max' | 'duplicate';
}

function intervalIssues(value: unknown, path: string): ScheduleIssue[] {
  if (!Array.isArray(value)) return [{ path, code: 'shape' }];
  if (value.length > PHONE_LIMITS.intervalsMax) return [{ path, code: 'max' }];
  const issues: ScheduleIssue[] = [];
  let previousEnd = '';
  for (const [index, interval] of value.entries()) {
    const at = `${path}.${index}`;
    if (!Array.isArray(interval) || interval.length !== 2) {
      issues.push({ path: at, code: 'shape' });
      continue;
    }
    const [from, to] = interval as unknown[];
    if (typeof from !== 'string' || typeof to !== 'string' || !TIME.test(from) || !TIME.test(to)) {
      issues.push({ path: at, code: 'time' });
      continue;
    }
    // Zero-padded `HH:MM` compares as text; intervals are in order and never overlap.
    if (from >= to || from < previousEnd) issues.push({ path: at, code: 'order' });
    previousEnd = to;
  }
  return issues;
}

/** What is wrong with a schedule as the station screen sends it; empty when it can be stored. */
export function scheduleIssues(value: unknown): ScheduleIssue[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ path: 'schedule', code: 'shape' }];
  }
  const { week, exceptions } = value as { week?: unknown; exceptions?: unknown };
  if (typeof week !== 'object' || week === null || Array.isArray(week)) {
    return [{ path: 'schedule.week', code: 'shape' }];
  }
  const issues: ScheduleIssue[] = [];
  const days = week as Record<string, unknown>;
  if (Object.keys(days).some((key) => !(WEEKDAY_KEYS as readonly string[]).includes(key))) {
    issues.push({ path: 'schedule.week', code: 'shape' });
  }
  for (const key of WEEKDAY_KEYS) {
    issues.push(...intervalIssues(days[key] ?? [], `schedule.week.${key}`));
  }
  if (exceptions !== undefined) {
    if (!Array.isArray(exceptions))
      return [...issues, { path: 'schedule.exceptions', code: 'shape' }];
    if (exceptions.length > PHONE_LIMITS.exceptionsMax) {
      issues.push({ path: 'schedule.exceptions', code: 'max' });
    }
    const seen = new Set<string>();
    for (const [index, entry] of exceptions.entries()) {
      const at = `schedule.exceptions.${index}`;
      const { date, intervals } = (entry ?? {}) as { date?: unknown; intervals?: unknown };
      if (typeof date !== 'string' || !DAY.test(date) || Number.isNaN(Date.parse(date))) {
        issues.push({ path: `${at}.date`, code: 'date' });
        continue;
      }
      if (seen.has(date)) issues.push({ path: `${at}.date`, code: 'duplicate' });
      seen.add(date);
      issues.push(...intervalIssues(intervals ?? [], `${at}.intervals`));
    }
  }
  return issues;
}

/** A checked schedule in its stored form: every weekday present, exceptions by date. */
export function normalizeSchedule(value: unknown): PhoneSchedule {
  const schedule = emptySchedule();
  if (typeof value !== 'object' || value === null) return schedule;
  const { week, exceptions } = value as {
    week?: Record<string, WorkingInterval[]>;
    exceptions?: { date: string; intervals?: WorkingInterval[] }[];
  };
  for (const key of WEEKDAY_KEYS) {
    schedule.week[key] = (week?.[key] ?? []).map(([from, to]) => [from, to] as const);
  }
  schedule.exceptions = (exceptions ?? [])
    .map((entry) => ({
      date: entry.date,
      intervals: (entry.intervals ?? []).map(([from, to]) => [from, to] as const),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  return schedule;
}

/**
 * Whether staff are at work at `at` by the line's schedule (Asia/Ulaanbaatar): the day's
 * exception when one is dated, else its weekday's intervals.
 */
export function isWorkingTime(schedule: PhoneSchedule, at: Date): boolean {
  const wall = businessDateTime(at);
  const date = wall.slice(0, 10);
  const time = wall.slice(11, 16);
  const exception = schedule.exceptions.find((entry) => entry.date === date);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const key = WEEKDAY_KEYS[(weekday + 6) % 7] ?? '1';
  const intervals = exception ? exception.intervals : schedule.week[key];
  return intervals.some(([from, to]) => from <= time && time < to);
}

/**
 * How a call is filed when it ends (ADR-0232 #2), from what it left behind: an order beats a
 * callback, a callback beats the rest; then an unknown caller, a told status, a failure.
 */
export function outcomeOf(facts: {
  ordered: boolean;
  callback: boolean;
  recognised: boolean;
  statusTold: boolean;
  failed: boolean;
}): PhoneCallOutcome {
  if (facts.ordered) return 'ORDERED';
  if (facts.callback) return 'CALLBACK';
  if (facts.failed) return 'FAILED';
  if (!facts.recognised) return 'NO_MATCH';
  if (facts.statusTold) return 'STATUS_ONLY';
  return 'ABANDONED';
}

/** A transcript text as the reconcile compares it: case and spacing never make two turns differ. */
export function turnKey(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Whether a stored turn and the provider's are the same words (one may be cut by an interruption). */
export function sameTurn(stored: string, provider: string): boolean {
  const a = turnKey(stored);
  const b = turnKey(provider);
  if (a === b) return true;
  if (a.length < 8 || b.length < 8) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Whether the caller answered a read-back of the quote at `quoteSeq` (ADR-0232 #7 b, c): no turn
 * missing up to `afterSeq`, an AGENT message with words after the quote, and a USER message with
 * words after that one. The server proves that the caller spoke after the read-back; whether the
 * words were a yes is the agent's judgement.
 */
export function confirmed(
  turns: readonly { seq: number; role: PhoneMessageRole; text: string }[],
  quoteSeq: number,
  afterSeq: number,
): boolean {
  if (turns.length !== afterSeq || turns.some((turn, index) => turn.seq !== index + 1)) {
    return false;
  }
  const spoke = (turn: { text: string }) => turn.text.trim().length > 0;
  const readBack = turns.find(
    (turn) => turn.seq > quoteSeq && turn.role === 'AGENT' && spoke(turn),
  );
  if (!readBack) return false;
  return turns.some((turn) => turn.seq > readBack.seq && turn.role === 'USER' && spoke(turn));
}
