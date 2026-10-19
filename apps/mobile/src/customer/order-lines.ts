import { Decimal } from '@tugeel/shared/money';
import { dayNameOf, monthDay } from '../dates/calendar';
import { weekdayOf } from '../dates/dates';
import type { ReorderPlan, SkipReason } from './reorder';

// The store's orders on «Захиалга» and an order's page (ADR-0079 #6, the Orders and Order boards):
// the day headings, a line's unit price, and what «Дахин захиалах» could not put into the cart.

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * A day heading of the Orders board: «Өнөөдөр · 10/18 Ням», «Өчигдөр · 10/17 Бямба», «10/16
 * Баасан»; `day` and `weekday` make the date, `name` says whether it is called by name.
 */
export function orderDayOf(
  date: string,
  today: string | null,
): { name: 'today' | 'yesterday' | null; day: string; weekday: Weekday } {
  const named = today ? dayNameOf(date, today) : 'date';
  return {
    name: named === 'today' || named === 'yesterday' ? named : null,
    day: monthDay(date),
    weekday: weekdayOf(date) as Weekday,
  };
}

/**
 * «5 хайрцаг × 20,000₮»: one unit's price, the line's amount (frozen, or today's estimate) divided
 * by its quantity, only when it divides exactly into at most two decimals; null otherwise (the line
 * then says only «5 хайрцаг»).
 */
export function unitPriceOf(line: {
  qty: string;
  total: string | null;
  estimatedTotal: string | null;
}): string | null {
  const amount = line.total ?? line.estimatedTotal;
  if (amount === null) return null;
  const qty = new Decimal(line.qty);
  if (qty.lte(0)) return null;
  const total = new Decimal(amount);
  const price = total.div(qty);
  if (price.decimalPlaces() > 2 || !price.times(qty).eq(total)) return null;
  return price.toFixed();
}

/** Why a reorder line stayed out: the server's or the batch's reason, or a full cart. */
export type ReorderSkip = SkipReason | 'CART_FULL';

/**
 * The plan's lines that fit the cart: a line of a unit already in the cart adds to it, a new line
 * only while the cart has fewer than `max` lines (the reducer drops the rest silently).
 */
export function fitReorder(
  lines: ReorderPlan['lines'],
  cart: readonly { productUnitId: number }[],
  max: number,
): { fits: ReorderPlan['lines']; full: ReorderPlan['lines'] } {
  const units = new Set(cart.map((line) => line.productUnitId));
  const fits: ReorderPlan['lines'] = [];
  const full: ReorderPlan['lines'] = [];
  for (const entry of lines) {
    if (units.has(entry.line.productUnitId)) fits.push(entry);
    else if (units.size < max) {
      units.add(entry.line.productUnitId);
      fits.push(entry);
    } else full.push(entry);
  }
  return { fits, full };
}

const SKIP_ORDER: readonly ReorderSkip[] = [
  'OUT_OF_STOCK',
  'UNAVAILABLE',
  'UNIT_CHANGED',
  'CART_FULL',
];

/**
 * The skipped products by reason, in a fixed order («Дууссан: A, B · Зарагдахгүй: C»), each named
 * once; a product the answer does not name takes its name from `nameOf` (the order's lines), and
 * `unnamed` counts those still without one.
 */
export function skippedByReason(
  skipped: readonly { productId: number; name: string | null; reason: ReorderSkip }[],
  nameOf: (productId: number) => string | null,
): { reason: ReorderSkip; names: string[]; unnamed: number }[] {
  return SKIP_ORDER.flatMap((reason) => {
    const products = skipped.filter((entry) => entry.reason === reason);
    if (products.length === 0) return [];
    const seen = new Set<number>();
    const names: string[] = [];
    let unnamed = 0;
    for (const product of products) {
      if (seen.has(product.productId)) continue;
      seen.add(product.productId);
      const name = product.name ?? nameOf(product.productId);
      if (name) names.push(name);
      else unnamed += 1;
    }
    return [{ reason, names, unnamed }];
  });
}
