import { daysBetween } from '../finance';
import { taxSplit } from '../mn';
import { Decimal, type DecimalInput, toMoney } from '../money';

/**
 * The supermarket POS (ADR-0063, ADR-0064): the rules the central `pos` module, the store edge and
 * the kiosk share. Messages live in mn.json under `pos`.
 */

/** How a sale is paid at the till; no QPay (ADR-0080, SPEC §6.6 #4). */
export const TENDER_KINDS = ['CASH', 'CARD'] as const;
export type TenderKind = (typeof TENDER_KINDS)[number];

/** A sale, or a return that names the sale it takes goods back from. */
export const SALE_KINDS = ['SALE', 'RETURN'] as const;
export type SaleKind = (typeof SALE_KINDS)[number];

/** Open at the till; closed with a count; the cash handed to the accountant (ADR-0064 #3). */
export const SHIFT_STATUSES = ['OPEN', 'CLOSED', 'HANDED_OVER'] as const;
export type ShiftStatus = (typeof SHIFT_STATUSES)[number];

/** The e-Barimt receipt types and states live in the Mongolian layer (ADR-0074 #2). */
export { EBARIMT_STATUSES, type EbarimtStatus, RECEIPT_TYPES, type ReceiptType } from '../mn';

/** The documents an edge replays to the centre, in the order they happened (ADR-0063 #4). */
export const POS_EVENT_KINDS = [
  'TILL_BOUND',
  'SHIFT_OPENED',
  'SALE',
  'RETURN',
  'SHIFT_CLOSED',
  'RECEIPT_STATUS',
] as const;
export type PosEventKind = (typeof POS_EVENT_KINDS)[number];

export function isPosEventKind(value: unknown): value is PosEventKind {
  return typeof value === 'string' && (POS_EVENT_KINDS as readonly string[]).includes(value);
}

/** What the centre answers for each replayed document. */
export const SYNC_RESULTS = ['APPLIED', 'DUPLICATE', 'REJECTED'] as const;
export type SyncResult = (typeof SYNC_RESULTS)[number];

export const POS_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type PosStatus = (typeof POS_STATUSES)[number];

export const POS_LIMITS = {
  maxLines: 200,
  maxTenders: 4,
  maxEventsPerBatch: 50,
  maxNote: 300,
  maxName: 120,
  maxCode: 16,
  maxTillCode: 8,
  maxTin: 14,
  maxConsumerNo: 8,
  maxCardField: 40,
  pinLength: 6,
  maxParked: 20,
  pairingCodeMinutes: 15,
  defaultReturnWindowDays: 14,
  maxReturnWindowDays: 365,
  defaultSnapshotIntervalSec: 60,
  minSnapshotIntervalSec: 10,
  maxSnapshotIntervalSec: 3_600,
} as const;

/** A till's code as it is printed: capitals (Latin or Cyrillic), digits and dashes, 1–8 long. */
export const TILL_CODE_PATTERN = /^[A-Z0-9А-ЯҮӨ][A-Z0-9А-ЯҮӨ-]{0,7}$/u;
/** An edge node's code: Latin capitals, digits, `_` and `-`, 1–16 long. */
export const EDGE_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
/** A cashier's PIN: six digits (owner 2026-10-16). */
export const PIN_PATTERN = /^[0-9]{6}$/;
/** An e-Barimt consumer number: 8 digits, or `11******` for the easy registration (SPEC §4). */
export const CONSUMER_NO_PATTERN = /^([0-9]{8}|11\*{6})$/;

export function normalizeTillCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Latin capitals that look like Cyrillic ones on a till's label, and their Cyrillic letters. */
const TILL_CODE_LOOKALIKES: Record<string, string> = {
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
  Y: 'У',
};

/**
 * The code a cashier typed, matched by its look: «K1» typed on a Latin keyboard finds till «К1».
 * An exact match always wins; this key only breaks the tie between look-alike letters.
 */
export function tillCodeLookKey(value: string): string {
  return [...normalizeTillCode(value)].map((char) => TILL_CODE_LOOKALIKES[char] ?? char).join('');
}

export function isTillCode(value: string): boolean {
  return TILL_CODE_PATTERN.test(value);
}

export function isPin(value: string): boolean {
  return PIN_PATTERN.test(value);
}

/** `2026-10-16` → `261016`, the day as the receipt prints it. */
export function compactDay(day: string): string {
  return day.replace(/-/g, '').slice(2);
}

/**
 * A sale's visible number, allocated by the edge per till and Ulaanbaatar day (ADR-0063 #3):
 * `К3-261016-0045`. The centre stores it verbatim.
 */
export function posSaleNumber(tillCode: string, day: string, seq: number): string {
  return `${tillCode}-${compactDay(day)}-${String(seq).padStart(4, '0')}`;
}

/** A shift's number: `К3-261016-Э1`, the first shift of that till on that day. */
export function posShiftNumber(tillCode: string, day: string, seq: number): string {
  return `${tillCode}-${compactDay(day)}-Э${seq}`;
}

/** The money of a line: `subtotal = qty × unit price` (2 decimals), `total = subtotal − discount`. */
export function lineMoney(
  qty: DecimalInput,
  unitPrice: DecimalInput,
  discountAmount: DecimalInput = 0,
): { subtotal: Decimal; total: Decimal } {
  const subtotal = toMoney(new Decimal(qty).times(unitPrice));
  return { subtotal, total: subtotal.minus(discountAmount) };
}

/** The VAT inside a tax-inclusive line total (ADR-0010 #4); the supermarket pays no city tax. */
export function lineVat(total: DecimalInput, vatRatePct: DecimalInput): Decimal {
  return taxSplit(total, vatRatePct, 0).vat;
}

export interface LineTotals {
  subtotal: DecimalInput;
  discountAmount: DecimalInput;
  total: DecimalInput;
  vatAmount: DecimalInput;
}

export interface SaleTotals {
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
  vatTotal: Decimal;
}

/** The header of a sale is the sum of its lines, never recomputed from rates. */
export function saleTotals(lines: readonly LineTotals[]): SaleTotals {
  const zero = new Decimal(0);
  return lines.reduce<SaleTotals>(
    (sum, line) => ({
      subtotal: sum.subtotal.plus(line.subtotal),
      discountTotal: sum.discountTotal.plus(line.discountAmount),
      total: sum.total.plus(line.total),
      vatTotal: sum.vatTotal.plus(line.vatAmount),
    }),
    { subtotal: zero, discountTotal: zero, total: zero, vatTotal: zero },
  );
}

export function tendersTotal(tenders: readonly { amount: DecimalInput }[]): Decimal {
  return tenders.reduce((sum, tender) => sum.plus(tender.amount), new Decimal(0));
}

export interface ShiftCash {
  openingFloat: DecimalInput;
  cashSales: DecimalInput;
  cashRefunds: DecimalInput;
}

/** What the drawer should hold at the close: the float plus cash sales minus cash refunds. */
export function expectedCash(cash: ShiftCash): Decimal {
  return new Decimal(cash.openingFloat).plus(cash.cashSales).minus(cash.cashRefunds);
}

/** Counted − expected: positive = over, negative = short (ADR-0064 #2). */
export function cashVariance(countedCash: DecimalInput, expected: DecimalInput): Decimal {
  return new Decimal(countedCash).minus(expected);
}

/** The cash handed to the accountant by default: what was counted less the float kept. */
export function handoverAmount(countedCash: DecimalInput, floatKept: DecimalInput): Decimal {
  const amount = new Decimal(countedCash).minus(floatKept);
  return amount.isNegative() ? new Decimal(0) : amount;
}

/** A return is accepted within the window counted from the sale's business day (owner: 14 days). */
export function withinReturnWindow(soldDay: string, today: string, windowDays: number): boolean {
  const late = daysBetween(soldDay, today);
  return late >= 0 && late <= windowDays;
}

/** The first 8 characters of a sha-256 of the raw token, enough to tell nodes apart on a screen. */
export const TOKEN_PREFIX_LENGTH = 8;
/** `tgs_<node id>_<secret>`: the edge's credential (ADR-0063 #6), shown once when issued. */
export const EDGE_TOKEN_PATTERN = /^tgs_([1-9][0-9]{0,14})_([A-Za-z0-9_-]{32,64})$/;

export function parseEdgeToken(value: string): { nodeId: number; secret: string } | null {
  const match = EDGE_TOKEN_PATTERN.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  return { nodeId: Number.parseInt(match[1], 10), secret: match[2] };
}

// The store edge: sync, snapshot and kiosk shapes (ADR-0067).
export * from './edge';
