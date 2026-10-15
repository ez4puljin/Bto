import { normalizeMnPhone } from '../phone';
import { addDays, businessDate, isIsoDate } from '../time';

/**
 * Customer orders (architecture §5.6, ADR-0055): the states, how an order is fulfilled and paid,
 * the limits, and the checks of an order header the api and the web share. Messages live in
 * mn.json under `sales`.
 */
export const ORDER_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVAL_PENDING',
  'CONFIRMED',
  'PICKING',
  'PACKED',
  'DISPATCHED',
  'DELIVERED',
  'DELIVERY_FAILED',
  'INVOICED',
  'CLOSED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Where an order came from; the office enters ADMIN orders. */
export const ORDER_CHANNELS = ['ADMIN', 'CUSTOMER_APP', 'SALES_REP', 'POS'] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

/** PICKUP: the customer collects at the warehouse; DELIVERY: a company truck brings it. */
export const FULFILMENTS = ['PICKUP', 'DELIVERY'] as const;
export type Fulfilment = (typeof FULFILMENTS)[number];

/** How the customer means to pay (owner 2026-10-15); finance uses it from delivery 3. */
export const PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CREDIT'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const ORDER_LIMITS = {
  maxLines: 200,
  maxNote: 500,
  maxContactName: 120,
  maxCancelReason: 500,
} as const;

/** States an order may be cancelled from today (picking and packing join when they are built). */
export const CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVAL_PENDING',
  'CONFIRMED',
];

export function isCancellable(status: OrderStatus): boolean {
  return CANCELLABLE_STATUSES.includes(status);
}

/** The delivery date a new order proposes: tomorrow in Ulaanbaatar. */
export function defaultDeliveryDate(today: string = businessDate()): string {
  return addDays(today, 1);
}

export interface OrderHeaderInput {
  fulfilment: Fulfilment;
  deliveryDate: string;
  addressId: number | null;
  contactPhone: string | null;
}

export type OrderHeaderIssue =
  | { path: 'deliveryDate'; code: 'isDate' | 'notPast' }
  | { path: 'addressId'; code: 'required' }
  | { path: 'contactPhone'; code: 'phone' };

/**
 * What is wrong with an order header: a delivery date that is not a date or lies in the past, a
 * delivery without an address, a contact phone that is not a Mongolian mobile number.
 */
export function orderHeaderIssues(
  input: OrderHeaderInput,
  today: string = businessDate(),
): OrderHeaderIssue[] {
  const issues: OrderHeaderIssue[] = [];
  if (!isIsoDate(input.deliveryDate)) issues.push({ path: 'deliveryDate', code: 'isDate' });
  else if (input.deliveryDate < today) issues.push({ path: 'deliveryDate', code: 'notPast' });
  if (input.fulfilment === 'DELIVERY' && input.addressId === null) {
    issues.push({ path: 'addressId', code: 'required' });
  }
  if (input.contactPhone !== null && normalizeMnPhone(input.contactPhone) === null) {
    issues.push({ path: 'contactPhone', code: 'phone' });
  }
  return issues;
}
