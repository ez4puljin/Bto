/**
 * App notices (ADR-0062): what the admin chooses, the limits the API, the web and the app share,
 * and a notice's state on a day. The database checks the same shapes.
 */
export const NOTICE_KINDS = ['PROMOTION', 'PRICE_DROP', 'NEW_PRODUCT', 'NEWS'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_LIMITS = {
  /** Characters of the title and of the text, counted after trimming. */
  titleMax: 80,
  bodyMax: 1000,
  /** Products one notice links to. */
  productsMax: 20,
  /** Running notices the app's summary carries, newest first. */
  summaryMax: 50,
  /** Ids one read call may mark. */
  readMax: 200,
} as const;

/** The rep's own notifications (ADR-0062 #4): today only a sold order. */
export const USER_NOTIFICATION_KINDS = ['ORDER_SOLD'] as const;
export type UserNotificationKind = (typeof USER_NOTIFICATION_KINDS)[number];

/** Who reads a notice (ADR-0079 #8): the sales reps' app or the customers' «Bto300». */
export const NOTICE_AUDIENCES = ['SALES_REPS', 'CUSTOMERS'] as const;
export type NoticeAudience = (typeof NOTICE_AUDIENCES)[number];

/**
 * A store's own notifications in «Bto300» (ADR-0079 #8): its order confirmed (with the
 * backordered lines), cancelled (with the reason) or sold (the invoice); a payment recorded; an
 * invoice due soon or overdue. Each is written once per document.
 */
export const CUSTOMER_NOTIFICATION_KINDS = [
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ORDER_SOLD',
  'PAYMENT_RECORDED',
  'INVOICE_DUE_SOON',
  'INVOICE_OVERDUE',
] as const;
export type CustomerNotificationKind = (typeof CUSTOMER_NOTIFICATION_KINDS)[number];

/**
 * The nightly reminders (ADR-0079 #8, Claude's default of 2026-10-19): an open invoice whose due
 * date lies today … `dueSoonDays` ahead is «due soon», one whose due date was 1 … `overdueDays`
 * days ago is «overdue»; each once per invoice, so a night the worker missed is made up.
 */
export const INVOICE_REMINDER_WINDOW = { dueSoonDays: 3, overdueDays: 7 } as const;

/** Backordered lines a confirmation notification names at most (the rest are counted). */
export const NOTIFIED_BACKORDER_LINES = 5;

/** Where a notice stands on a day; derived, never stored. */
export const NOTICE_STATES = ['SCHEDULED', 'RUNNING', 'ENDED', 'WITHDRAWN'] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];

/**
 * A notice's state on `today` (Ulaanbaatar `YYYY-MM-DD`): withdrawn, not started, past its end
 * (`validTo` is the day after the last day, ADR-0062 #1) or running.
 */
export function noticeState(
  notice: { validFrom: string; validTo: string | null; withdrawn: boolean },
  today: string,
): NoticeState {
  if (notice.withdrawn) return 'WITHDRAWN';
  if (notice.validFrom > today) return 'SCHEDULED';
  if (notice.validTo !== null && notice.validTo <= today) return 'ENDED';
  return 'RUNNING';
}

/** Characters as PostgreSQL's `length()` counts them (code points), so both sides agree. */
export function noticeTextLength(value: string): number {
  return [...value.trim()].length;
}
