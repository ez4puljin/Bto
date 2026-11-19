/**
 * «Асуудалтай бараа» (ADR-0230): the products whose stock the system got wrong in a warehouse,
 * shared by the api, the web and the staff app.
 */
import { Decimal, type DecimalInput } from '../money';

/**
 * Why a product is on the list. `POS_SHORTFALL` is «Улайсан»: a till sold what the system said the
 * shelf lacked (ADR-0063 #5). `BACKORDER` and `SHORT_PICK` are «Дарагдсан»: an order's quantity cut
 * at its confirmation (more ordered than the system had), or by the picker (the system had it, the
 * shelf did not).
 */
export const STOCK_PROBLEM_EVENT_KINDS = ['POS_SHORTFALL', 'BACKORDER', 'SHORT_PICK'] as const;
export type StockProblemEventKind = (typeof STOCK_PROBLEM_EVENT_KINDS)[number];

/** The owner's two groups: «Улайсан» and «Дарагдсан». */
export const STOCK_PROBLEM_GROUPS = ['RED', 'CUT'] as const;
export type StockProblemGroup = (typeof STOCK_PROBLEM_GROUPS)[number];

export function stockProblemGroup(kind: StockProblemEventKind): StockProblemGroup {
  return kind === 'POS_SHORTFALL' ? 'RED' : 'CUT';
}

/**
 * How a product leaves a warehouse's list: «Зүй ёсны» (`LEGIT`), «Үлдэгдэл тэглэх» (`ZERO_OUT`, a
 * goods issue), or the morning sheet's count (`COUNT`).
 */
export const STOCK_PROBLEM_RESOLUTION_KINDS = ['LEGIT', 'ZERO_OUT', 'COUNT'] as const;
export type StockProblemResolutionKind = (typeof STOCK_PROBLEM_RESOLUTION_KINDS)[number];

/** `PENDING` while its goods issue or adjustment is not posted; `CANCELLED` when that was cancelled. */
export const STOCK_PROBLEM_RESOLUTION_STATUSES = ['PENDING', 'DONE', 'CANCELLED'] as const;
export type StockProblemResolutionStatus = (typeof STOCK_PROBLEM_RESOLUTION_STATUSES)[number];

/**
 * A morning sheet: `OPEN` while it is counted, `APPROVED` once its differences were sent to the
 * books, `CLOSED` when a later day's sheet replaced it before anything was counted.
 */
export const STOCK_PROBLEM_SHEET_STATUSES = ['OPEN', 'APPROVED', 'CLOSED'] as const;
export type StockProblemSheetStatus = (typeof STOCK_PROBLEM_SHEET_STATUSES)[number];

/** A counted line against the system's quantity at the moment of the count. */
export const STOCK_PROBLEM_OUTCOMES = ['EQUAL', 'SHORTAGE', 'SURPLUS'] as const;
export type StockProblemOutcome = (typeof STOCK_PROBLEM_OUTCOMES)[number];

/** Problem events older than this many days leave the list by themselves. */
export const STOCK_PROBLEM_WINDOW_DAYS = 30;

export const STOCK_PROBLEM_NOTE_MAX = 300;

/** A base-unit quantity as typed: up to 11 whole digits and 3 decimals, never negative. */
export const STOCK_PROBLEM_QTY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;

/** The morning sheets are built at this hour, Ulaanbaatar time. */
export const STOCK_PROBLEM_SHEET_HOUR = 7;

/** counted − system: positive is a surplus, negative a shortage. */
export function stockProblemDifference(counted: DecimalInput, onHand: DecimalInput): Decimal {
  return new Decimal(counted).minus(onHand);
}

export function stockProblemOutcome(difference: DecimalInput): StockProblemOutcome {
  const value = new Decimal(difference);
  if (value.isZero()) return 'EQUAL';
  return value.isNegative() ? 'SHORTAGE' : 'SURPLUS';
}
