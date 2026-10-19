import { monthDay } from '../dates/calendar';

// A store's order history (the store card and its full list, the owner 2026-10-18): every order of
// the store, anyone's, with who took it and when. The rules of a row, without React.

/** The fields of a store's order a row reads (the api's SalesRepStoreOrder). */
export interface StoreOrderFields {
  mine: boolean;
  takerName: string | null;
  createdDate: string;
  createdTime: string;
  total: string | null;
  estimatedTotal: string | null;
}

/** Who took an order: the rep («Би»), a named person, or nobody known. */
export type Taker = { kind: 'me' } | { kind: 'name'; name: string } | { kind: 'unknown' };

export function takerOf(order: StoreOrderFields): Taker {
  if (order.mine) return { kind: 'me' };
  const name = order.takerName?.trim() ?? '';
  return name ? { kind: 'name', name } : { kind: 'unknown' };
}

/** When it was taken, as a row shows it: `MM/DD HH:mm`, or only `HH:mm` under its day's title. */
export function takenAt(order: StoreOrderFields, withDate = true): string {
  return withDate ? `${monthDay(order.createdDate)} ${order.createdTime}` : order.createdTime;
}

/**
 * The amount of a row: the total, a draft's estimate at today's prices (shown «≈ …₮»), or nothing
 * yet when a draft's line has no price.
 */
export type StoreOrderAmount =
  { kind: 'total'; value: string } | { kind: 'estimate'; value: string } | { kind: 'later' };

export function amountOf(order: StoreOrderFields): StoreOrderAmount {
  if (order.total !== null) return { kind: 'total', value: order.total };
  if (order.estimatedTotal !== null) return { kind: 'estimate', value: order.estimatedTotal };
  return { kind: 'later' };
}

/** Orders, newest first, in runs of one Ulaanbaatar day (the full list's day titles). */
export function byDay<T extends { createdDate: string }>(
  orders: readonly T[],
): { day: string; data: T[] }[] {
  const groups: { day: string; data: T[] }[] = [];
  for (const order of orders) {
    const last = groups[groups.length - 1];
    if (last && last.day === order.createdDate) last.data.push(order);
    else groups.push({ day: order.createdDate, data: [order] });
  }
  return groups;
}
