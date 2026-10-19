import type { CustomerOrderState, Fulfilment, PaymentMethod } from '@tugeel/shared/sales';
import type { PickedRecord } from '../orders/order-filters';

// «Захиалга»'s filters in «Bto300» (the owner 2026-10-20, like the rep app's): who took the order —
// the app, the office, the reps or one rep —, a product, the payment, delivery or pickup, the state.

/** Who took an order, as the store chooses: «Апп», «Оффис», «Бүх ХТ» or one rep by name. */
export type StoreTaker =
  { kind: 'APP' } | { kind: 'OFFICE' } | { kind: 'REP'; rep: PickedRecord | null };

export interface StoreOrderFilters {
  taker: StoreTaker | null;
  product: PickedRecord | null;
  paymentMethod: PaymentMethod | null;
  fulfilment: Fulfilment | null;
  state: CustomerOrderState | null;
}

export type StoreOrderFilterKey = keyof StoreOrderFilters;

/** The filters in the order their chips show. */
export const STORE_ORDER_FILTER_KEYS: readonly StoreOrderFilterKey[] = [
  'taker',
  'product',
  'paymentMethod',
  'fulfilment',
  'state',
];

export const EMPTY_STORE_ORDER_FILTERS: StoreOrderFilters = {
  taker: null,
  product: null,
  paymentMethod: null,
  fulfilment: null,
  state: null,
};

/** The filters that are on, in their chips' order. */
export function activeStoreFilters(filters: StoreOrderFilters): StoreOrderFilterKey[] {
  return STORE_ORDER_FILTER_KEYS.filter((key) => filters[key] !== null);
}

/** The filters as `GET /customer-app/orders` takes them; a filter that is off is left out. */
export interface StoreOrderParams {
  taker?: 'APP' | 'OFFICE' | 'REP';
  repId?: number;
  productId?: number;
  paymentMethod?: PaymentMethod;
  fulfilment?: Fulfilment;
  state?: CustomerOrderState;
}

export function storeOrderParams(filters: StoreOrderFilters): StoreOrderParams {
  const taker = filters.taker;
  return {
    ...(taker ? { taker: taker.kind } : {}),
    ...(taker?.kind === 'REP' && taker.rep ? { repId: taker.rep.id } : {}),
    ...(filters.product ? { productId: filters.product.id } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
    ...(filters.fulfilment ? { fulfilment: filters.fulfilment } : {}),
    ...(filters.state ? { state: filters.state } : {}),
  };
}

/** The filters with one taken off (a chip's ×). */
export function withoutStoreFilter(
  filters: StoreOrderFilters,
  key: StoreOrderFilterKey,
): StoreOrderFilters {
  return { ...filters, [key]: null };
}

/** Whether two takers are the same choice (a chip shows as chosen). */
export function sameTaker(a: StoreTaker | null, b: StoreTaker | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  if (a.kind === 'REP' && b.kind === 'REP') return (a.rep?.id ?? null) === (b.rep?.id ?? null);
  return true;
}

/** A taker chip pressed: the same choice again takes it off (back to «Бүгд»). */
export function toggleTaker(current: StoreTaker | null, next: StoreTaker): StoreTaker | null {
  return sameTaker(current, next) ? null : next;
}
