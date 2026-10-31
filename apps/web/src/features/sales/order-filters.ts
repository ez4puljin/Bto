import {
  FULFILMENTS,
  type Fulfilment,
  ORDER_CHANNELS,
  type OrderChannel,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@tugeel/shared/sales';
import { isIsoDate } from '@tugeel/shared/time';

/**
 * The filters of the warehouse sales page (ADR-0057 #7), shared by the board and the list. The
 * URL keeps them in short keys so a filtered view can be shared or reloaded.
 */
export interface OrderFilters {
  customer?: number;
  /** Only the orders with a line in this warehouse (ADR-0126 #2: a keeper's own goods). */
  warehouse?: number;
  deliveryFrom?: string;
  deliveryTo?: string;
  mine?: boolean;
  channel?: OrderChannel;
  fulfilment?: Fulfilment;
  payment?: PaymentMethod;
}

export const ORDER_FILTER_FIELDS = [
  'customer',
  'warehouse',
  'delivery',
  'mine',
  'channel',
  'fulfilment',
  'payment',
] as const;
export type OrderFilterField = (typeof ORDER_FILTER_FIELDS)[number];

const KEYS = {
  customer: 'c',
  warehouse: 'w',
  deliveryFrom: 'df',
  deliveryTo: 'dt',
  mine: 'm',
  channel: 'ch',
  fulfilment: 'f',
  payment: 'p',
} as const;

const oneOf = <T extends string>(values: readonly T[], value: string | null): T | undefined =>
  values.find((entry) => entry === value);

export function readOrderFilters(params: URLSearchParams): OrderFilters {
  const customer = Number.parseInt(params.get(KEYS.customer) ?? '', 10);
  const from = params.get(KEYS.deliveryFrom);
  const to = params.get(KEYS.deliveryTo);
  const filters: OrderFilters = {};
  if (customer > 0) filters.customer = customer;
  const warehouse = Number.parseInt(params.get(KEYS.warehouse) ?? '', 10);
  if (warehouse > 0) filters.warehouse = warehouse;
  if (from && isIsoDate(from)) filters.deliveryFrom = from;
  if (to && isIsoDate(to)) filters.deliveryTo = to;
  if (params.get(KEYS.mine) === '1') filters.mine = true;
  const channel = oneOf(ORDER_CHANNELS, params.get(KEYS.channel));
  if (channel) filters.channel = channel;
  const fulfilment = oneOf(FULFILMENTS, params.get(KEYS.fulfilment));
  if (fulfilment) filters.fulfilment = fulfilment;
  const payment = oneOf(PAYMENT_METHODS, params.get(KEYS.payment));
  if (payment) filters.payment = payment;
  return filters;
}

/** The params with the filters written in (and the others of the page kept). */
export function writeOrderFilters(params: URLSearchParams, filters: OrderFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const key of Object.values(KEYS)) next.delete(key);
  if (filters.customer) next.set(KEYS.customer, String(filters.customer));
  if (filters.warehouse) next.set(KEYS.warehouse, String(filters.warehouse));
  if (filters.deliveryFrom) next.set(KEYS.deliveryFrom, filters.deliveryFrom);
  if (filters.deliveryTo) next.set(KEYS.deliveryTo, filters.deliveryTo);
  if (filters.mine) next.set(KEYS.mine, '1');
  if (filters.channel) next.set(KEYS.channel, filters.channel);
  if (filters.fulfilment) next.set(KEYS.fulfilment, filters.fulfilment);
  if (filters.payment) next.set(KEYS.payment, filters.payment);
  return next;
}

export function activeOrderFilters(filters: OrderFilters): OrderFilterField[] {
  return ORDER_FILTER_FIELDS.filter((field) => {
    switch (field) {
      case 'customer':
        return filters.customer !== undefined;
      case 'warehouse':
        return filters.warehouse !== undefined;
      case 'delivery':
        return filters.deliveryFrom !== undefined || filters.deliveryTo !== undefined;
      case 'mine':
        return filters.mine === true;
      case 'channel':
        return filters.channel !== undefined;
      case 'fulfilment':
        return filters.fulfilment !== undefined;
      case 'payment':
        return filters.payment !== undefined;
    }
  });
}

export function withoutField(filters: OrderFilters, field: OrderFilterField): OrderFilters {
  const next = { ...filters };
  switch (field) {
    case 'customer':
      delete next.customer;
      break;
    case 'warehouse':
      delete next.warehouse;
      break;
    case 'delivery':
      delete next.deliveryFrom;
      delete next.deliveryTo;
      break;
    case 'mine':
      delete next.mine;
      break;
    case 'channel':
      delete next.channel;
      break;
    case 'fulfilment':
      delete next.fulfilment;
      break;
    case 'payment':
      delete next.payment;
      break;
  }
  return next;
}

/** The API's query for these filters and the search text. */
export function orderFilterQuery(filters: OrderFilters, q: string) {
  return {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(filters.customer ? { customerId: filters.customer } : {}),
    ...(filters.warehouse ? { warehouseId: filters.warehouse } : {}),
    ...(filters.mine ? { mine: true } : {}),
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.fulfilment ? { fulfilment: filters.fulfilment } : {}),
    ...(filters.payment ? { paymentMethod: filters.payment } : {}),
    ...(filters.deliveryFrom ? { deliveryFrom: filters.deliveryFrom } : {}),
    ...(filters.deliveryTo ? { deliveryTo: filters.deliveryTo } : {}),
  };
}
