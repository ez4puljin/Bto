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

/**
 * A staff member's own notifications: a rep's order that was sold (ADR-0062 #4), and the phone AI
 * line's new order and new callback task, told to every holder of `phone.calls.read` (ADR-0232 #9).
 */
export const USER_NOTIFICATION_KINDS = [
  'ORDER_SOLD',
  'PHONE_ORDER',
  'PHONE_CALLBACK',
  'PRICE_CHANGED',
] as const;
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

// Settlement SMS (ADR-0216).
export {
  formatSmsAmount,
  formatSmsDate,
  isSmsErrorCode,
  renderSmsTemplate,
  SMS_BATCH_STATUSES,
  SMS_DEFAULT_TEMPLATE,
  SMS_ERROR_CODES,
  SMS_LIMITS,
  SMS_MESSAGE_STATUSES,
  SMS_PLACEHOLDER_KEYS,
  SMS_PLACEHOLDERS,
  SMS_PURPOSES,
  type SmsBatchStatus,
  type SmsEncoding,
  type SmsErrorCode,
  type SmsMessageStatus,
  type SmsPlaceholderKey,
  type SmsPurpose,
  type SmsSize,
  smsPlaceholderToken,
  smsSize,
  type SmsTemplateValues,
  unknownSmsPlaceholders,
} from './sms';

/** A bounded public selling-price summary; acquisition prices never enter the inbox. */
export type PriceChangeWarningReason =
  'PRINTED_PRICE_MISSING' | 'PRINTED_PRICE_ZERO' | 'PRINTED_PRICE_CONFLICT' | 'PRICE_OUT_OF_RANGE';
export interface PriceChangeNotificationLine {
  eventId: number;
  productId: number;
  sku: string;
  name: string;
  oldBasePrice: string | null;
  newBasePrice: string;
  overrodeManual: boolean;
}
export interface PriceChangeNotificationWarning {
  eventId: number;
  productId: number;
  sku: string;
  name: string;
  reason: PriceChangeWarningReason;
}
export interface PriceChangeNoticeFacts {
  receiptId: number;
  receiptNumber: string;
  changes: readonly PriceChangeNotificationLine[];
  warnings: readonly PriceChangeNotificationWarning[];
}
export interface PriceChangeSummary extends PriceChangeNoticeFacts {
  changeCount: number;
  warningCount: number;
  overwrittenManualCount: number;
}

/** Defensive decoding of the bounded persisted selling-price notification. */
export function priceChangeSummaryOf(value: unknown): PriceChangeSummary | null {
  const object = (x: unknown): Record<string, unknown> | null =>
    typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : null;
  const r = object(value);
  if (!r) return null;
  const id = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0;
  const count = (x: unknown, fallback: number) =>
    typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : fallback;
  const money = (x: unknown): x is string =>
    typeof x === 'string' && /^[1-9][0-9]{0,11}(?:\.0{1,2})?$/.test(x);
  if (!id(r.receiptId) || typeof r.receiptNumber !== 'string') return null;
  const changes: PriceChangeNotificationLine[] = [];
  for (const x of (Array.isArray(r.changes) ? r.changes : []).slice(0, 20)) {
    const c = object(x);
    if (
      !c ||
      !id(c.eventId) ||
      !id(c.productId) ||
      typeof c.sku !== 'string' ||
      typeof c.name !== 'string' ||
      !money(c.newBasePrice) ||
      (c.oldBasePrice !== null && !money(c.oldBasePrice)) ||
      typeof c.overrodeManual !== 'boolean'
    )
      continue;
    changes.push({
      eventId: c.eventId,
      productId: c.productId,
      sku: c.sku,
      name: c.name,
      oldBasePrice: c.oldBasePrice,
      newBasePrice: c.newBasePrice,
      overrodeManual: c.overrodeManual,
    });
  }
  const reasons: readonly string[] = [
    'PRINTED_PRICE_MISSING',
    'PRINTED_PRICE_ZERO',
    'PRINTED_PRICE_CONFLICT',
    'PRICE_OUT_OF_RANGE',
  ];
  const warnings: PriceChangeNotificationWarning[] = [];
  for (const x of (Array.isArray(r.warnings) ? r.warnings : []).slice(0, 20)) {
    const c = object(x);
    if (
      !c ||
      !id(c.eventId) ||
      !id(c.productId) ||
      typeof c.sku !== 'string' ||
      typeof c.name !== 'string' ||
      typeof c.reason !== 'string' ||
      !reasons.includes(c.reason)
    )
      continue;
    warnings.push({
      eventId: c.eventId,
      productId: c.productId,
      sku: c.sku,
      name: c.name,
      reason: c.reason as PriceChangeWarningReason,
    });
  }
  return {
    receiptId: r.receiptId,
    receiptNumber: r.receiptNumber,
    changes,
    warnings,
    changeCount: count(r.changeCount, changes.length),
    warningCount: count(r.warningCount, warnings.length),
    overwrittenManualCount: count(
      r.overwrittenManualCount,
      changes.filter((c) => c.overrodeManual).length,
    ),
  };
}
