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
 * Why a reorder line stayed out: the server's or the batch's reason, a full cart, or the product
 * already in the cart in another unit (the cart keeps one line per product).
 */
export type ReorderSkip = SkipReason | 'CART_FULL' | 'OTHER_UNIT';

/**
 * The plan's lines that fit the cart, which keeps one line per product (ADR-0068 #5): a line in the
 * unit the cart already holds adds to it; the same product in another unit — in the cart or earlier
 * in the plan — stays out; a new product only while the cart has fewer than `max` lines (the reducer
 * drops the rest silently).
 */
export function fitReorder(
  lines: ReorderPlan['lines'],
  cart: readonly { productId: number; productUnitId: number }[],
  max: number,
): {
  fits: ReorderPlan['lines'];
  full: ReorderPlan['lines'];
  otherUnit: ReorderPlan['lines'];
} {
  const unitOf = new Map(cart.map((line) => [line.productId, line.productUnitId]));
  const fits: ReorderPlan['lines'] = [];
  const full: ReorderPlan['lines'] = [];
  const otherUnit: ReorderPlan['lines'] = [];
  for (const entry of lines) {
    const held = unitOf.get(entry.line.productId);
    if (held !== undefined) {
      if (held === entry.line.productUnitId) fits.push(entry);
      else otherUnit.push(entry);
    } else if (unitOf.size < max) {
      unitOf.set(entry.line.productId, entry.line.productUnitId);
      fits.push(entry);
    } else full.push(entry);
  }
  return { fits, full, otherUnit };
}

const SKIP_ORDER: readonly ReorderSkip[] = [
  'OUT_OF_STOCK',
  'UNAVAILABLE',
  'UNIT_CHANGED',
  'OTHER_UNIT',
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
