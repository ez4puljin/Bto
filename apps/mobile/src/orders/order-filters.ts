import type { Fulfilment, PaymentMethod, RepOrderState } from '@tugeel/shared/sales';

// The order history's filters (the owner, 2026-10-18: by customer, product, payment, delivery and
// state, with the days, from a filter button instead of a search). Kept while the tab lives.

/** A customer or a product a filter keeps, with its name for the chip. */
export interface PickedRecord {
  id: number;
  name: string;
}

export interface OrderFilters {
  customer: PickedRecord | null;
  /** Orders with a line of this product. */
  product: PickedRecord | null;
  paymentMethod: PaymentMethod | null;
  fulfilment: Fulfilment | null;
  /** DRAFT, ACTIVE (sent, not yet delivered), SOLD (delivered), CANCELLED. */
  state: RepOrderState | null;
}

export type OrderFilterKey = keyof OrderFilters;

/** The filters in the order their chips show. */
export const ORDER_FILTER_KEYS: readonly OrderFilterKey[] = [
  'customer',
  'product',
  'paymentMethod',
  'fulfilment',
  'state',
];

export const EMPTY_ORDER_FILTERS: OrderFilters = {
  customer: null,
  product: null,
  paymentMethod: null,
  fulfilment: null,
  state: null,
};

/** The filters that are on, in their chips' order. */
export function activeOrderFilters(filters: OrderFilters): OrderFilterKey[] {
  return ORDER_FILTER_KEYS.filter((key) => filters[key] !== null);
}

/** How many filters are on: the number on the filter button (the days are not a filter). */
export function orderFilterCount(filters: OrderFilters): number {
  return activeOrderFilters(filters).length;
}

/** The filters as `GET /sales-rep/orders` takes them; a filter that is off is left out. */
export interface OrderFilterParams {
  customerId?: number;
  productId?: number;
  paymentMethod?: PaymentMethod;
  fulfilment?: Fulfilment;
  state?: RepOrderState;
}

export function orderFilterParams(filters: OrderFilters): OrderFilterParams {
  return {
    ...(filters.customer ? { customerId: filters.customer.id } : {}),
    ...(filters.product ? { productId: filters.product.id } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
    ...(filters.fulfilment ? { fulfilment: filters.fulfilment } : {}),
    ...(filters.state ? { state: filters.state } : {}),
  };
}

/** The filters with one taken off (a chip's ×). */
export function withoutFilter(filters: OrderFilters, key: OrderFilterKey): OrderFilters {
  return { ...filters, [key]: null };
}

/** A chip row's choice: tapping the chosen chip again takes it off (back to «Бүгд»). */
export function toggleChoice<T extends string>(current: T | null, value: T): T | null {
  return current === value ? null : value;
}
