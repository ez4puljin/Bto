import { Decimal, type DecimalInput } from '../money';

/**
 * Settlement SMS (ADR-0216): one text a staff member writes with placeholders, rendered for each
 * ticked customer by the server and previewed by the dialog with the same function, and WeSend's
 * rules for how many parts a text takes and what it costs.
 */

/** The placeholders, written in a text exactly as `{name}`. */
export const SMS_PLACEHOLDERS = {
  name: 'Харилцагч_нэр',
  balance: 'Эцсийн үлдэгдэл',
  code: 'Харилцагч_код',
  dueDate: 'Тооцооны_өдөр',
} as const;
export type SmsPlaceholderKey = keyof typeof SMS_PLACEHOLDERS;
export const SMS_PLACEHOLDER_KEYS = Object.keys(SMS_PLACEHOLDERS) as SmsPlaceholderKey[];

/** A placeholder as it is typed into a text. */
export const smsPlaceholderToken = (key: SmsPlaceholderKey): string => `{${SMS_PLACEHOLDERS[key]}}`;

/** The text the dialog offers first (owner 2026-11-17). */
export const SMS_DEFAULT_TEMPLATE = `Сайн байна уу, ${smsPlaceholderToken('name')}. Таны тооцооны үлдэгдэл ${smsPlaceholderToken('balance')} төг байна. Бүтэн-Оргил ХХК`;

/** WeSend's counting (wesend.mn, 2026-11-17) and our limits. */
export const SMS_LIMITS = {
  /** Characters of one part when every character is Latin. */
  latinPerPart: 155,
  /** Characters of one part once a single character is not. */
  unicodePerPart: 65,
  /** WeSend refuses a text of more parts. */
  maxParts: 4,
  /** ₮ per part (1 credit = 1₮). */
  pricePerPart: 80,
  /** Characters of a template as typed. */
  templateMax: 1000,
  /** Customers one batch may hold. */
  batchMax: 2000,
} as const;

export type SmsEncoding = 'LATIN' | 'UNICODE';

/** ASCII characters WeSend does not count as Latin. */
const NOT_LATIN_ASCII = new Set(['[', '\\', ']', '^', '{', '|', '}', '~']);

function isLatin(char: string): boolean {
  if (char === '\n' || char === '\r') return true;
  const code = char.charCodeAt(0);
  return char.length === 1 && code >= 0x20 && code <= 0x7e && !NOT_LATIN_ASCII.has(char);
}

export interface SmsSize {
  encoding: SmsEncoding;
  /** Characters as WeSend counts them (UTF-16 units for a Unicode text). */
  characters: number;
  parts: number;
  /** Over `maxParts`: WeSend refuses it. */
  tooLong: boolean;
  /** The estimate in ₮: parts × 80. */
  cost: number;
}

/** How many parts `text` takes on WeSend and what it costs. */
export function smsSize(text: string): SmsSize {
  const encoding: SmsEncoding = [...text].every(isLatin) ? 'LATIN' : 'UNICODE';
  const characters = encoding === 'LATIN' ? [...text].length : text.length;
  const perPart = encoding === 'LATIN' ? SMS_LIMITS.latinPerPart : SMS_LIMITS.unicodePerPart;
  const parts = characters === 0 ? 0 : Math.ceil(characters / perPart);
  return {
    encoding,
    characters,
    parts,
    tooLong: parts > SMS_LIMITS.maxParts,
    cost: parts * SMS_LIMITS.pricePerPart,
  };
}

/** What a text is rendered with for one customer. */
export interface SmsTemplateValues {
  name: string;
  code: string;
  /** The receivable balance, MNT. */
  balance: DecimalInput;
  /** The current settlement period's due date, `YYYY-MM-DD`. */
  dueDate: string;
}

const PLACEHOLDER = /\{([^{}]*)\}/g;

/** The `{…}` names in a text that are not placeholders, each once, in order. */
export function unknownSmsPlaceholders(template: string): string[] {
  const known = new Set<string>(Object.values(SMS_PLACEHOLDERS));
  const unknown: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER)) {
    const name = match[1] ?? '';
    if (!known.has(name) && !unknown.includes(name)) unknown.push(name);
  }
  return unknown;
}

/** `1250000.4` → `1,250,000`: whole MNT, rounded half up, thousands by commas, no sign of currency. */
export function formatSmsAmount(value: DecimalInput): string {
  const whole = new Decimal(value).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const digits = whole.abs().toFixed(0);
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return whole.isNegative() && !whole.isZero() ? `-${grouped}` : grouped;
}

/** `2026-11-20` → `2026.11.20`. */
export const formatSmsDate = (date: string): string => date.replaceAll('-', '.');

/**
 * The text for one customer: every known placeholder replaced, anything else left as typed (the
 * server refuses a template with an unknown one before rendering, `unknownSmsPlaceholders`).
 */
export function renderSmsTemplate(template: string, values: SmsTemplateValues): string {
  const byName = new Map<string, string>([
    [SMS_PLACEHOLDERS.name, values.name],
    [SMS_PLACEHOLDERS.balance, formatSmsAmount(values.balance)],
    [SMS_PLACEHOLDERS.code, values.code],
    [SMS_PLACEHOLDERS.dueDate, formatSmsDate(values.dueDate)],
  ]);
  return template.replace(PLACEHOLDER, (whole, name: string) => byName.get(name) ?? whole);
}

/** Why a message was not sent: WeSend's own codes and ours (lower case, as WeSend writes them). */
export const SMS_ERROR_CODES = [
  // WeSend
  'invalid_request',
  'invalid_api_key',
  'insufficient_credits',
  'subscription_required',
  'forbidden',
  'ip_not_allowed',
  'sending_paused',
  'trial_recipient',
  'unsupported_number',
  'content_rejected',
  'message_too_long',
  'rate_limited',
  'recipient_rate_limited',
  'provider_failed',
  'server_error',
  // ours
  'timeout',
  'network_error',
  'unexpected_answer',
  'not_configured',
  'key_unreadable',
  'sms_disabled',
  'no_phone',
  'no_balance',
  'unknown_error',
] as const;
export type SmsErrorCode = (typeof SMS_ERROR_CODES)[number];

export function isSmsErrorCode(value: unknown): value is SmsErrorCode {
  return typeof value === 'string' && (SMS_ERROR_CODES as readonly string[]).includes(value);
}

/** A message's state: waiting, sent, refused or not attempted (no phone, no balance). */
export const SMS_MESSAGE_STATUSES = ['QUEUED', 'SENT', 'FAILED', 'SKIPPED'] as const;
export type SmsMessageStatus = (typeof SMS_MESSAGE_STATUSES)[number];

export const SMS_BATCH_STATUSES = ['QUEUED', 'SENDING', 'DONE'] as const;
export type SmsBatchStatus = (typeof SMS_BATCH_STATUSES)[number];

/** What a batch is for; only settlement reminders today (ADR-0216). */
export const SMS_PURPOSES = ['SETTLEMENT'] as const;
export type SmsPurpose = (typeof SMS_PURPOSES)[number];
