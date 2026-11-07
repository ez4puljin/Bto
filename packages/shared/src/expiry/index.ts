/**
 * The expiry register (ADR-0172, docs/modules/expiry.md): the rules the api, the web and the staff
 * app share. A record observes what is on a shelf and moves nothing, so none of this touches stock.
 * "Today" always comes from the server (`daysLeft` on a row, `today` on the summary), never from a
 * phone's or a browser's clock.
 */
import { addMonths, isIsoDate } from '../time';

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
  return (
    date >= addMonths(today, -12 * EXPIRY_MAX_PAST_YEARS) &&
    date <= addMonths(today, 12 * EXPIRY_MAX_FUTURE_YEARS)
  );
}
