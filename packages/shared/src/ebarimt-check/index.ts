/**
 * «Ebarimt» (ADR-0168): a month's purchases from the company's own goods receipts against what the
 * suppliers entered into e-Barimt. The rules the api and the web share.
 *
 * A period is a month as one number, year × 100 + month (202510 is October 2025), and every value on
 * the page hangs on it.
 */
import { normalizeRegNo } from '../taxpayer';

export const EBARIMT_LIMITS = {
  /** Periods in one consolidated report. */
  maxPeriods: 60,
  /** Rows read from one file. */
  maxRows: 20_000,
  maxNote: 500,
  maxRegisters: 200,
  maxPhone: 60,
  maxRemark: 300,
  /** Suppliers given an employee at once. */
  maxSuppliers: 5_000,
  /** Receipts linked at once. */
  maxReceiptKeys: 2_000,
} as const;

/** A difference of this or less reads as none: half a tugrik, as the delivery notes round. */
export const EBARIMT_DIFF_TOLERANCE = '0.5';

/** An amount typed on the page: not negative, at most two decimals. */
export const EBARIMT_AMOUNT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/** The history of a supplier's month: which value changed. */
export const EBARIMT_HISTORY_FIELDS = ['EMPLOYEE', 'EBARIMT', 'EXEMPT'] as const;
export type EbarimtHistoryField = (typeof EBARIMT_HISTORY_FIELDS)[number];

/** Why it changed: first seen, a new file, by hand, a link taken or undone, a register edited, a file taken away. */
export const EBARIMT_HISTORY_KINDS = [
  'INIT',
  'FILE',
  'MANUAL',
  'REVERT',
  'LINK',
  'UNLINK',
  'EDIT',
  'REMOVE',
] as const;
export type EbarimtHistoryKind = (typeof EBARIMT_HISTORY_KINDS)[number];

export const EBARIMT_FILE_STATUSES = ['ACTIVE', 'REPLACED', 'REMOVED'] as const;

export function periodOf(year: number, month: number): number {
  return year * 100 + month;
}

export function periodYear(period: number): number {
  return Math.floor(period / 100);
}

export function periodMonth(period: number): number {
  return period % 100;
}

export function isPeriod(period: number): boolean {
  if (!Number.isInteger(period)) return false;
  const year = periodYear(period);
  const month = periodMonth(period);
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12;
}

export function nextPeriod(period: number): number {
  return periodMonth(period) === 12 ? periodOf(periodYear(period) + 1, 1) : period + 1;
}

export function previousPeriod(period: number): number {
  return periodMonth(period) === 1 ? periodOf(periodYear(period) - 1, 12) : period - 1;
}

/** A date's period: «2026-10-08» is 202610; null when it is not a date. */
export function periodOfDate(date: string): number | null {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(date);
  if (!match) return null;
  const period = periodOf(Number.parseInt(match[1] ?? '', 10), Number.parseInt(match[2] ?? '', 10));
  return isPeriod(period) ? period : null;
}

/** The first and last day of a period, as business dates. */
export function periodDays(period: number): { from: string; to: string } {
  const year = periodYear(period);
  const month = periodMonth(period);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/**
 * A taxpayer number as e-Barimt's file and a typed register are compared: «71000.0» is 71000, «011»
 * is 11; a citizen's by the shared rule for registration numbers (`@tugeel/shared/taxpayer`): upper
 * case, Latin look-alikes as Cyrillic, no spaces.
 */
export function normalizeTaxId(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value).trim();
  if (text.endsWith('.0')) text = text.slice(0, -2);
  if (/^\d+$/.test(text)) return text.replace(/^0+(?=\d)/, '');
  return normalizeRegNo(text);
}

const REGISTER_SEPARATORS = /[;,／/\\.\s]+/;

/** A citizen's number written with a space after its two letters is still one number. */
const CITIZEN_WITH_SPACE = /(?<![\p{L}\d])(\p{L}{2})\s+(\d{8})(?!\d)/gu;

/**
 * A supplier's registers typed in one field: «7100001;7100002», «7100003 .7100004», «7100005,
 * 7100006». A bare 0 is the old lists' way of saying none, and matches nothing.
 */
export function splitRegisters(value: string | null | undefined): string[] {
  if (!value) return [];
  const registers = value
    .replace(CITIZEN_WITH_SPACE, '$1$2')
    .split(REGISTER_SEPARATORS)
    .map((part) => normalizeTaxId(part))
    .filter((part) => part !== '' && part !== '0');
  return [...new Set(registers)];
}
