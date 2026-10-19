import { Decimal } from '@tugeel/shared/money';
import type { CustomerOrderState, OrderChannel } from '@tugeel/shared/sales';
import { addDays } from '@tugeel/shared/time';
import { colors } from '../theme/tokens';

// The store's orders in its own words (ADR-0079 #6, the Orders and Order boards): the progress, who
// took an order, its notes and its amount; mn.json's `sales.customerStates.*` names the states.

/** The pill of each state, as the Orders board colours them. */
export const STATE_TONES: Record<CustomerOrderState, { background: string; text: string }> = {
  PENDING: { background: colors.warningSoft, text: colors.warningText },
  CONFIRMED: { background: colors.secondary, text: colors.secondaryForeground },
  PREPARING: { background: colors.violetSoft, text: colors.violet },
  READY: { background: colors.infoSoft, text: colors.link },
  DELIVERED: { background: colors.successSoft, text: colors.success },
  CANCELLED: { background: colors.destructiveSoft, text: colors.cancelled },
};

/** «Илгээсэн → Батлагдсан → Бэлтгэж буй → Бэлэн → Хүргэгдсэн»: the order page's steps. */
export const PROGRESS_STEPS = ['SENT', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED'] as const;
export type ProgressStep = (typeof PROGRESS_STEPS)[number];

/** How far an order came: the index of its last step done; -1 for a cancelled order. */
export function progressOf(state: CustomerOrderState): number {
  switch (state) {
    case 'PENDING':
      return 0;
    case 'CONFIRMED':
      return 1;
    case 'PREPARING':
      return 2;
    case 'READY':
      return 3;
    case 'DELIVERED':
      return 4;
    case 'CANCELLED':
      return -1;
  }
}

/** Who took an order: «Апп», «Оффис», «Төлөөлөгч <name>» (the Orders board). */
export type Taker = { kind: 'app' } | { kind: 'office' } | { kind: 'rep'; name: string | null };

export function takerOf(order: { channel: OrderChannel; takerName: string | null }): Taker {
  switch (order.channel) {
    case 'CUSTOMER_APP':
      return { kind: 'app' };
    case 'SALES_REP':
      return { kind: 'rep', name: order.takerName };
    default:
      return { kind: 'office' };
  }
}

/** A row's notes: the lines waiting for stock, a cancellation's reason. */
export type OrderNote =
  { kind: 'backordered'; lines: number } | { kind: 'cancelled'; reason: string | null };

export function orderNotes(order: {
  state: CustomerOrderState;
  backorderedLines: number;
  cancelReason: string | null;
}): OrderNote[] {
  if (order.state === 'CANCELLED') return [{ kind: 'cancelled', reason: order.cancelReason }];
  return order.backorderedLines > 0 ? [{ kind: 'backordered', lines: order.backorderedLines }] : [];
}

/** The amount shown: the frozen total, or «≈» today's estimate of an order not confirmed yet. */
export function orderAmount(order: {
  total: string | null;
  estimatedTotal: string | null;
}): { amount: string; estimate: boolean } | null {
  if (order.total !== null) return { amount: order.total, estimate: false };
  if (order.estimatedTotal !== null) return { amount: order.estimatedTotal, estimate: true };
  return null;
}

/** «Өнөөдөр», «7 хоног», «Энэ сар» (the Orders board). */
export type OrderPreset = 'today' | 'week' | 'month';
export const ORDER_PRESETS: readonly OrderPreset[] = ['today', 'week', 'month'];

/** The days a preset covers, ending today (the server's Ulaanbaatar day). */
export function presetRange(preset: OrderPreset, today: string): { from: string; to: string } {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: addDays(today, -6), to: today };
    case 'month':
      return { from: `${today.slice(0, 8)}01`, to: today };
  }
}

/** Orders by the day they were made, newest day first, keeping the server's order within a day. */
export function byDay<T extends { createdDate: string }>(
  orders: readonly T[],
): { date: string; orders: T[] }[] {
  const groups: { date: string; orders: T[] }[] = [];
  for (const order of orders) {
    const last = groups[groups.length - 1];
    if (last && last.date === order.createdDate) last.orders.push(order);
    else groups.push({ date: order.createdDate, orders: [order] });
  }
  return groups;
}

/**
 * «N хайрцаг хойшилсон»: a line's backordered base units told in its own unit when they make whole
 * units of it, else in base units.
 */
export function backorderedIn(line: {
  qty: string;
  qtyBase: string;
  qtyBackordered: string;
}): { qty: string; inUnit: boolean } | null {
  const waiting = new Decimal(line.qtyBackordered);
  if (waiting.lte(0)) return null;
  const qty = new Decimal(line.qty);
  const base = new Decimal(line.qtyBase);
  if (qty.gt(0) && base.gt(0)) {
    const units = waiting.times(qty).div(base);
    if (units.isInteger()) return { qty: units.toFixed(), inUnit: true };
  }
  return { qty: waiting.toFixed(), inUnit: false };
}
