import type { components } from '@tugeel/api-client';
import { Decimal } from '@tugeel/shared/money';

// The driver's «Ачилт» (ADR-0179) grouped by store: the driver ticks stores, each tick takes every
// waiting order of that store. Pure, so the grouping and the choice are tested without a phone.

export type LoadingOrder = components['schemas']['SalesLoadingOrder'];

/** A store with its orders: waiting ones to load, and the caller's own loaded today. */
export interface LoadingStore {
  customerId: number;
  customerName: string;
  customerCode: string;
  addressText: string | null;
  phone: string | null;
  orders: LoadingOrder[];
}

export interface LoadingSections {
  waiting: LoadingStore[];
  loaded: LoadingStore[];
}

function byStore(orders: readonly LoadingOrder[]): LoadingStore[] {
  const stores = new Map<number, LoadingStore>();
  for (const order of orders) {
    const store = stores.get(order.customerId) ?? {
      customerId: order.customerId,
      customerName: order.customerName,
      customerCode: order.customerCode,
      addressText: order.addressText,
      phone: order.contactPhone ?? order.customerPhone,
      orders: [],
    };
    store.addressText ??= order.addressText;
    store.orders.push(order);
    stores.set(order.customerId, store);
  }
  return [...stores.values()].sort((a, b) => a.customerName.localeCompare(b.customerName, 'mn'));
}

/** The list as the screen draws it: stores to load, then the stores loaded today. */
export function loadingSections(orders: readonly LoadingOrder[]): LoadingSections {
  return {
    waiting: byStore(orders.filter((order) => order.loading === null)),
    loaded: byStore(orders.filter((order) => order.loading !== null)),
  };
}

/** The orders a press of «Ачсан» sends: every waiting order of the ticked stores. */
export function ordersToLoad(sections: LoadingSections, ticked: ReadonlySet<number>): number[] {
  return sections.waiting
    .filter((store) => ticked.has(store.customerId))
    .flatMap((store) => store.orders.map((order) => order.orderId));
}

/** The whole-MNT sum of a store's orders (null totals count as nothing). */
export function storeTotal(store: LoadingStore): string {
  return store.orders
    .reduce((sum, order) => sum.plus(order.total ?? '0'), new Decimal(0))
    .toFixed(0);
}

/** The ticks still meaningful after a reload: stores that still wait. */
export function keptTicks(sections: LoadingSections, ticked: ReadonlySet<number>): Set<number> {
  const waiting = new Set(sections.waiting.map((store) => store.customerId));
  return new Set([...ticked].filter((id) => waiting.has(id)));
}
