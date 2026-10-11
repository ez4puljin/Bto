import { Decimal, type DecimalInput } from '../money';

/**
 * Inventory rules shared by the API, the web and the importer (docs/modules/inventory.md,
 * ADR-0007, ADR-0033, ADR-0034): bin types and codes, movement and document types, adjustment
 * reasons, document numbers and the cost arithmetic of the moving average.
 */

// ---------------------------------------------------------------------------------------------
// Bins (architecture §5.1)

export const BIN_TYPES = [
  'RECEIVING',
  'STORAGE',
  'PICKING',
  'STAGING',
  'SHIP',
  'DAMAGED',
  'RETURNS',
  'SALESFLOOR',
  'CARGO',
  'TRANSIT',
] as const;
export type BinType = (typeof BIN_TYPES)[number];

/** Stock on these bins can be sold: it counts in `sellable_on_hand` (SPEC §6.4 #2). */
export const SELLABLE_BIN_TYPES: readonly BinType[] = ['STORAGE', 'PICKING', 'SALESFLOOR'];

/** Bins people create (shelves); every other type exists once per warehouse, made by the system. */
export const USER_BIN_TYPES = ['STORAGE', 'PICKING'] as const;
export type UserBinType = (typeof USER_BIN_TYPES)[number];

export function isSellableBinType(type: BinType): boolean {
  return SELLABLE_BIN_TYPES.includes(type);
}

export type StockWarehouseKind = 'WHOLESALE' | 'STORE' | 'VEHICLE' | 'TRANSIT';

const COMMON_SYSTEM_BINS: readonly BinType[] = [
  'RECEIVING',
  'STAGING',
  'SHIP',
  'DAMAGED',
  'RETURNS',
];

/** The system bins of a warehouse kind (§5.1); the TRANSIT warehouse holds only its TRANSIT bin. */
export function systemBinTypes(kind: StockWarehouseKind): readonly BinType[] {
  switch (kind) {
    case 'WHOLESALE':
      return COMMON_SYSTEM_BINS;
    case 'STORE':
      return [...COMMON_SYSTEM_BINS, 'SALESFLOOR'];
    case 'VEHICLE':
      return [...COMMON_SYSTEM_BINS, 'CARGO'];
    case 'TRANSIT':
      return ['TRANSIT'];
  }
}

export const BIN_CODE_MAX_LENGTH = 32;
const BIN_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._/-]*$/;

/** Cyrillic capitals that look like Latin ones, for codes typed on the Mongolian layout. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  У: 'Y',
  Х: 'X',
};
const DASHES = /[‐‑‒–—―−﹣]/g;

/**
 * A bin code as stored and scanned: the text of its shelf label (owner, 2026-10-11: the barcode
 * holds the code itself, e.g. "A-01-03"). Spaces are dropped, letters upper-cased, Cyrillic
 * look-alikes and dash variants folded to their ASCII form.
 */
export function normalizeBinCode(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(DASHES, '-')
    .replace(/[А-ЯЁӨҮ]/g, (char) => LOOK_ALIKES[char] ?? char);
}

/** A normalised code the database accepts: Latin capitals, digits and `. _ / -`, at most 32. */
export function isBinCode(code: string): boolean {
  return code.length <= BIN_CODE_MAX_LENGTH && BIN_CODE_PATTERN.test(code);
}

export interface BinCodeRange {
  /** Row letters, inclusive ("A" to "C"). */
  rows: { from: string; to: string };
  /** Rack numbers, inclusive. */
  racks: { from: number; to: number };
  /** Level numbers, inclusive. */
  levels: { from: number; to: number };
  /** Digits of rack and level numbers (owner's labels: 2, "A-01-03"). */
  pad?: number;
}

export const BIN_RANGE_MAX = 500;

export class BinRangeError extends RangeError {
  constructor(message: string) {
    super(message);
    this.name = 'BinRangeError';
  }
}

const ROW = /^[A-Z]$/;
const isPart = (value: number) => Number.isInteger(value) && value >= 0 && value <= 999;

/**
 * Codes for a block of shelves: every row × rack × level as "A-01-03", rows outermost. At most
 * BIN_RANGE_MAX codes per call; BinRangeError for an inverted or invalid range.
 */
export function binCodeRange(range: BinCodeRange): string[] {
  const pad = range.pad ?? 2;
  const { rows, racks, levels } = range;
  if (!ROW.test(rows.from) || !ROW.test(rows.to) || rows.from > rows.to) {
    throw new BinRangeError('rows must be capital letters, from ≤ to');
  }
  if (![racks.from, racks.to, levels.from, levels.to].every(isPart)) {
    throw new BinRangeError('racks and levels must be whole numbers 0–999');
  }
  if (racks.from > racks.to || levels.from > levels.to || pad < 1 || pad > 3) {
    throw new BinRangeError('racks and levels must run from ≤ to, padding 1–3');
  }
  const rowCount = rows.to.charCodeAt(0) - rows.from.charCodeAt(0) + 1;
  const count = rowCount * (racks.to - racks.from + 1) * (levels.to - levels.from + 1);
  if (count > BIN_RANGE_MAX) throw new BinRangeError(`at most ${BIN_RANGE_MAX} bins at once`);
  const digits = (value: number) => String(value).padStart(pad, '0');
  const codes: string[] = [];
  for (let row = rows.from.charCodeAt(0); row <= rows.to.charCodeAt(0); row += 1) {
    for (let rack = racks.from; rack <= racks.to; rack += 1) {
      for (let level = levels.from; level <= levels.to; level += 1) {
        codes.push(`${String.fromCharCode(row)}-${digits(rack)}-${digits(level)}`);
      }
    }
  }
  return codes;
}

// ---------------------------------------------------------------------------------------------
// Movements and documents (architecture §5.3, ADR-0034)

/**
 * Every movement type of the ledger with its sign (1 inbound, -1 outbound, 0 either) and allowed
 * legs. A pair posts leg 1 (out) and leg 2 (in) under one document line; a transfer's receive
 * posts legs 3 and 4, and its corrections legs 5 and 6 (ADR-0035), so that ship and receive never
 * share an idempotency key.
 */
export const MOVEMENT_TYPES = {
  RECEIPT: { sign: 1, legs: [1] },
  PUTAWAY_OUT: { sign: -1, legs: [1] },
  PUTAWAY_IN: { sign: 1, legs: [2] },
  BIN_MOVE_OUT: { sign: -1, legs: [1] },
  BIN_MOVE_IN: { sign: 1, legs: [2] },
  PICK_OUT: { sign: -1, legs: [1] },
  PICK_IN: { sign: 1, legs: [2] },
  DISPATCH_OUT: { sign: -1, legs: [1] },
  DISPATCH_IN: { sign: 1, legs: [2] },
  DELIVERY_ISSUE: { sign: -1, legs: [1] },
  POS_SALE: { sign: -1, legs: [1] },
  TRANSFER_OUT: { sign: -1, legs: [1, 3, 5] },
  TRANSFER_IN: { sign: 1, legs: [2, 4, 6] },
  RETURN_IN: { sign: 1, legs: [1] },
  ADJUSTMENT: { sign: 0, legs: [1] },
  COUNT_CORRECTION: { sign: 0, legs: [1] },
} as const satisfies Record<string, { sign: -1 | 0 | 1; legs: readonly number[] }>;
export type MovementType = keyof typeof MOVEMENT_TYPES;

/** Document codes of the ledger's `doc_type`, also the scope of their numbers. */
export const STOCK_DOC_TYPES = [
  'GR',
  'BM',
  'TR',
  'ADJ',
  'ST',
  'PK',
  'TRIP',
  'SO',
  'POS',
  'CN',
] as const;
export type StockDocType = (typeof STOCK_DOC_TYPES)[number];

/** "GR-2026-000001": scope, Ulaanbaatar year and a gapless number (SPEC §6.13). */
export function formatDocNumber(scope: string, period: string, value: number): string {
  return `${scope}-${period}-${String(value).padStart(6, '0')}`;
}

/** Adjustment reasons and the direction they move stock (owner, 2026-10-11). */
export const ADJUSTMENT_REASONS = {
  DAMAGED: -1,
  EXPIRED: -1,
  SHORTAGE: -1,
  SURPLUS: 1,
  /** Opening stock: only the importer and approvers use it. */
  OPENING: 1,
  /** Takes back an opening-stock adjustment when its import is reverted (system only, ADR-0036). */
  OPENING_REVERSAL: -1,
} as const satisfies Record<string, -1 | 1>;
export type AdjustmentReason = keyof typeof ADJUSTMENT_REASONS;
export const ADJUSTMENT_REASON_CODES = [
  'DAMAGED',
  'EXPIRED',
  'SHORTAGE',
  'SURPLUS',
  'OPENING',
  'OPENING_REVERSAL',
] as const satisfies readonly AdjustmentReason[];
export const USER_ADJUSTMENT_REASONS = ['DAMAGED', 'EXPIRED', 'SHORTAGE', 'SURPLUS'] as const;

// ---------------------------------------------------------------------------------------------
// Transfers (ADR-0035)

export const TRANSFER_STATUSES = [
  'DRAFT',
  'REQUESTED',
  'SHIPPED',
  'RECEIVED',
  'CANCELLED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
/** REQUEST: the receiver asked for the goods; PUSH: the sender sends on its own (returns). */
export const TRANSFER_ORIGINS = ['REQUEST', 'PUSH'] as const;
export type TransferOrigin = (typeof TRANSFER_ORIGINS)[number];

/** Where a receive leg posts: the TRANSIT bin, the destination bin or the sender's bin. */
export type TransferPlace = 'TRANSIT' | 'DESTINATION' | 'SOURCE';

export interface TransferReceiveLeg {
  movementType: 'TRANSFER_OUT' | 'TRANSFER_IN';
  leg: 3 | 4 | 5 | 6;
  place: TransferPlace;
  /** Signed base quantity. */
  qty: Decimal;
}

/**
 * The ledger legs of receiving one transfer line (owner, 2026-10-11): TRANSIT gives up everything
 * shipped (leg 3) and the destination takes what arrived up to that (leg 4). A shortfall goes back
 * to the sender's bin (leg 6); a surplus leaves the sender's bin (leg 5) for the destination
 * (leg 6). Every inbound leg follows the outbound leg before it, so it carries that leg's cost.
 */
export function transferReceiveLegs(
  shipped: DecimalInput,
  received: DecimalInput,
): TransferReceiveLeg[] {
  const s = new Decimal(shipped);
  const r = new Decimal(received);
  if (s.isNegative() || r.isNegative()) throw new RangeError('quantities are never negative');
  const legs: TransferReceiveLeg[] = [];
  if (s.gt(0)) {
    legs.push({ movementType: 'TRANSFER_OUT', leg: 3, place: 'TRANSIT', qty: s.negated() });
    const arrived = Decimal.min(r, s);
    if (arrived.gt(0)) {
      legs.push({ movementType: 'TRANSFER_IN', leg: 4, place: 'DESTINATION', qty: arrived });
    }
  }
  if (r.lessThan(s)) {
    legs.push({ movementType: 'TRANSFER_IN', leg: 6, place: 'SOURCE', qty: s.minus(r) });
  } else if (r.greaterThan(s)) {
    const extra = r.minus(s);
    legs.push({ movementType: 'TRANSFER_OUT', leg: 5, place: 'SOURCE', qty: extra.negated() });
    legs.push({ movementType: 'TRANSFER_IN', leg: 6, place: 'DESTINATION', qty: extra });
  }
  return legs;
}

// ---------------------------------------------------------------------------------------------
// Cost arithmetic (ADR-0007 cost rules, ADR-0033 costing after posting)

export const COST_SCALE = 4;
export const MONEY_SCALE = 2;

/** Moving average after `qty` arrives at `unitCost` on top of `onHand` at `avg` (qty > 0). */
export function reaverage(
  onHand: DecimalInput,
  avg: DecimalInput,
  qty: DecimalInput,
  unitCost: DecimalInput,
): Decimal {
  const before = new Decimal(onHand);
  const added = new Decimal(qty);
  const cost = new Decimal(unitCost);
  if (before.lte(0)) return cost.toDecimalPlaces(COST_SCALE);
  const total = before.plus(added);
  return before.times(avg).plus(added.times(cost)).dividedBy(total).toDecimalPlaces(COST_SCALE);
}

/** The value of a quantity at a unit cost, MNT with two decimals. */
export function valueOf(qty: DecimalInput, unitCost: DecimalInput): Decimal {
  return new Decimal(qty).times(unitCost).toDecimalPlaces(MONEY_SCALE);
}

/** A receipt line's amount from a price per entered unit (the accountant's form). */
export function lineAmountOf(unitPrice: DecimalInput, enteredQty: DecimalInput): Decimal {
  return valueOf(enteredQty, unitPrice);
}

/** Cost per base unit of a line amount, four decimals (shown, and recorded on valuation rows). */
export function unitCostOf(amount: DecimalInput, qtyBase: DecimalInput): Decimal {
  return new Decimal(amount).dividedBy(qtyBase).toDecimalPlaces(COST_SCALE);
}

export interface Revaluation {
  avgAfter: Decimal;
  /** Value change actually taken into the stock on hand (MNT, 2 decimals). */
  absorbed: Decimal;
  /** The rest of the price difference: it belongs to goods already gone (cost of goods). */
  variance: Decimal;
}

/**
 * ADR-0033 coverage rule. A costed receipt changes value by `valueDelta` for `receivedQty` base
 * units; only the part still on hand moves the average: absorbed = Δ × min(Q, onHand) / Q, the
 * rest is a variance. With nothing issued since the receipt this is the exact moving average.
 * The average never goes below zero; whatever cannot be absorbed is variance too.
 */
export function revalue(input: {
  onHand: DecimalInput;
  avg: DecimalInput;
  receivedQty: DecimalInput;
  valueDelta: DecimalInput;
}): Revaluation {
  const onHand = new Decimal(input.onHand);
  const avg = new Decimal(input.avg);
  const received = new Decimal(input.receivedQty);
  const delta = new Decimal(input.valueDelta);
  if (delta.isZero() || onHand.lte(0) || received.lte(0)) {
    return { avgAfter: avg, absorbed: new Decimal(0), variance: delta };
  }
  const target = delta.times(Decimal.min(received, onHand)).dividedBy(received);
  const raw = avg.plus(target.dividedBy(onHand)).toDecimalPlaces(COST_SCALE);
  const avgAfter = raw.isNegative() ? new Decimal(0) : raw;
  const absorbed = avgAfter.minus(avg).times(onHand).toDecimalPlaces(MONEY_SCALE);
  return { avgAfter, absorbed, variance: delta.minus(absorbed) };
}

/**
 * The last business date on which a posted receipt may be costed again: the end of the month after
 * the month it was posted in (owner, 2026-10-11). The first costing is never refused.
 */
export function costingDeadline(postedOn: string): string {
  const [year, month] = postedOn.split('-').map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined || !(month >= 1 && month <= 12)) {
    throw new RangeError(`not a date: ${postedOn}`);
  }
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const leap = (nextYear % 4 === 0 && nextYear % 100 !== 0) || nextYear % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][nextMonth - 1] ?? 31;
  const two = (value: number) => String(value).padStart(2, '0');
  return `${nextYear}-${two(nextMonth)}-${two(days)}`;
}

export function canRecost(postedOn: string, today: string): boolean {
  return today <= costingDeadline(postedOn);
}
