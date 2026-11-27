/**
 * The expiry register (ADR-0172, docs/modules/expiry.md): the rules the api, the web and the staff
 * app share. A record observes what is on a shelf and moves nothing, so none of this touches stock.
 * "Today" always comes from the server (`daysLeft` on a row, `today` on the summary), never from a
 * phone's or a browser's clock.
 */
import { addMonths, isIsoDate } from '../time';
import type { Decimal } from '../money';

/** Internal Code128 labels identify one immutable approval, never a catalogue SKU. */
export const EXPIRY_BARCODE_PREFIX = 'BTOEXP-';
export function formatExpiryBarcode(markdownId: number): string {
  if (!Number.isSafeInteger(markdownId) || markdownId <= 0) throw new RangeError('markdown id');
  return `${EXPIRY_BARCODE_PREFIX}${markdownId}`;
}
export function parseExpiryBarcode(value: string): number | null {
  const match = /^BTOEXP-([1-9]\d{0,14})$/.exec(value);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) ? id : null;
}
export const EXPIRY_CHANNELS = ['RETAIL', 'WHOLESALE'] as const;
export type ExpiryChannel = (typeof EXPIRY_CHANNELS)[number];
export interface ExpiryReceiptSource {
  receiptLineId: number;
  receiptId: number;
  receiptNumber: string;
  receiptDate: string;
  warehouseId: number;
  qtyBase: string;
  first: {
    version: number;
    qtyBase: string;
    grossAmount: string | null;
    discountAmount: string | null;
    freeGoods: boolean;
  } | null;
  current: {
    version: number;
    accountingAmount: string;
    unitCost: string;
    grossAmount: string | null;
    discountAmount: string | null;
    supplierNetAmount: string | null;
    freeGoods: boolean;
  } | null;
  /** Receipts do not record the name or paid/free pairing of a supplier campaign. */
  promotionEvidence: 'FREE_GOODS' | 'DISCOUNT' | 'NONE' | 'UNAVAILABLE';
}
export interface ExpiryMarkdownView {
  id: number;
  itemId: number;
  revision: number;
  barcode: string;
  expiryDate: string;
  productId: number;
  productUnitId: number;
  warehouseId: number;
  channel: ExpiryChannel;
  contextId: number;
  unitPrice: string;
  qtyBudget: string;
  qtySold: string;
  qtyAvailable: string;
  startsAt: string;
  stoppedAt: string | null;
  /** Private fields are only returned by the cost-protected commerce detail. */
  receiptLineId: number;
  costingVersion: number;
  accountingUnitCost: string;
  payrollMonth: string | null;
  liableUserIds: number[];
}
export interface ExpiryCommerceView {
  itemVersion: number;
  liabilityFingerprint: string | null;
  liableUsers: { id: number; fullName: string }[];
  source: ExpiryReceiptSource | null;
  sourceQtyBase: string | null;
  sourceVersion: number;
  markdowns: ExpiryMarkdownView[];
  exceptions: {
    id: number;
    markdownId: number;
    sourceKind: 'POS' | 'WHOLESALE';
    saleId: string;
    lineId: string;
    reason: string;
    qtyBase: string;
    soldAt: string;
    resolvedAt: string | null;
    resolutionNote: string | null;
  }[];
}

/** What happens to the goods. An archived record is read-only until it is restored to REVIEW. */
export const EXPIRY_STATUSES = ['REVIEW', 'CITY_RETURN', 'INTERNAL_SALE', 'ARCHIVED'] as const;
export type ExpiryStatus = (typeof EXPIRY_STATUSES)[number];

export const EXPIRY_LIABILITY_TYPES = ['NONE', 'SPECIFIC', 'ALL_STAFF'] as const;
export type ExpiryLiabilityType = (typeof EXPIRY_LIABILITY_TYPES)[number];

/** The list's views: the summary's cards and the status filter. ACTIVE is every open record. */
export const EXPIRY_VIEWS = [
  'ACTIVE',
  'EXPIRED',
  'URGENT',
  'SOON',
  'REVIEW',
  'CITY_RETURN',
  'INTERNAL_SALE',
  'ARCHIVED',
] as const;
export type ExpiryView = (typeof EXPIRY_VIEWS)[number];

export const EXPIRY_URGENCIES = ['EXPIRED', 'URGENT', 'SOON', 'OK'] as const;
export type ExpiryUrgency = (typeof EXPIRY_URGENCIES)[number];

/** A history row: the record's creation, or a later change of a quantity. */
export const EXPIRY_CHANGE_KINDS = ['CREATE', 'UPDATE'] as const;
export type ExpiryChangeKind = (typeof EXPIRY_CHANGE_KINDS)[number];

/** What a carry did with one old record (ADR-0172 #12). */
export const EXPIRY_CARRY_OUTCOMES = ['CREATED', 'UPDATED', 'UNCHANGED', 'KEPT'] as const;
export type ExpiryCarryOutcome = (typeof EXPIRY_CARRY_OUTCOMES)[number];

/** The «soon» card and view: today … today + 30, as the old page's card. */
export const EXPIRY_SOON_DAYS = 30;
/** The «urgent» card and view and the home tile: today … today + 7, as the old digest. */
export const EXPIRY_URGENT_DAYS = 7;
/** How far a typed date may lie from today: it stops a typing slip, not an expired product. */
export const EXPIRY_MAX_PAST_YEARS = 5;
export const EXPIRY_MAX_FUTURE_YEARS = 15;

export const EXPIRY_NOTE_MAX = 1000;
export const EXPIRY_LIABILITY_NOTE_MAX = 500;
/** An old username or a staff member's full name kept as text on a row. */
export const EXPIRY_NAME_MAX = 200;

/** A counted quantity as a client sends it: not negative, at most three decimals. */
export const EXPIRY_QTY_PATTERN = /^\d{1,11}(\.\d{1,3})?$/;

/** How close a date is, by the days left: EXPIRED < 0, URGENT 0–7, SOON 8–30, else OK. */
export function expiryUrgency(daysLeft: number): ExpiryUrgency {
  if (daysLeft < 0) return 'EXPIRED';
  if (daysLeft <= EXPIRY_URGENT_DAYS) return 'URGENT';
  if (daysLeft <= EXPIRY_SOON_DAYS) return 'SOON';
  return 'OK';
}

/**
 * True for a real calendar date no more than 5 years before `today` and no more than 15 years after
 * it, both ends included. Past dates are the point: finding expired goods is what the register is for.
 */
export function isExpiryDateInRange(date: string, today: string): boolean {
  if (!isIsoDate(date)) return false;
  const { min, max } = expiryDateBounds(today);
  return date >= min && date <= max;
}

/** The first and last date a record may hold, for a date field's calendar and for the rule above. */
export function expiryDateBounds(today: string): { min: string; max: string } {
  return {
    min: addMonths(today, -12 * EXPIRY_MAX_PAST_YEARS),
    max: addMonths(today, 12 * EXPIRY_MAX_FUTURE_YEARS),
  };
}

/** Public cashier snapshot. Costs, staff attribution and payroll month stay in trusted DB. */
export interface ExpirySaleOffer {
  id: number;
  itemId: number;
  barcode: string;
  expiryDate: string;
  productId: number;
  productUnitId: number;
  warehouseId: number;
  channel: ExpiryChannel;
  contextId: number;
  unitPrice: string;
  qtyAvailable: string;
  startsAt: string;
  stoppedAt: string | null;
}
export interface ExpirySaleInput {
  barcode: string;
  sourceKind: 'POS' | 'WHOLESALE';
  saleId: string;
  lineId: string;
  productId: number;
  productUnitId: number;
  warehouseId: number;
  channel: ExpiryChannel;
  contextId: number;
  qtyBase: Decimal;
  /** Actual sale amount, inclusive of tax, and actual VAT-exclusive revenue. */
  grossAmount: Decimal;
  revenueAmount: Decimal;
  soldAt: Date;
}
export interface ExpiryReturnInput {
  /** Trusted original POS line context; absent for ordinary/wholesale returns. */
  expiryContext?: {
    barcode: string;
    productId: number;
    productUnitId: number;
    warehouseId: number;
    contextId: number;
  };
  sourceKind: 'POS' | 'WHOLESALE';
  saleId: string;
  lineId: string;
  returnId: string;
  returnLineId: string;
  qtyBase: Decimal;
  returnedAt: Date;
}

export interface ExpiryExceptionView {
  origin: 'SALE_EXCEPTION' | 'POS_EXCEPTION';
  id: number;
  operation: 'SALE' | 'RETURN';
  documentId: string;
  lineId: string;
  originalSaleId: string | null;
  originalLineId: string | null;
  barcode: string;
  productId: number;
  warehouseId: number;
  reason: string;
  qtyBase: string;
  occurredAt: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgementNote: string | null;
  /** A return failure did not reverse the original charge; acknowledgement never repairs it. */
  financialEffect: 'SALE_UNALLOCATED' | 'RETURN_REVERSAL_UNRESOLVED';
}
