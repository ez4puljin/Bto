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

/**
 * What a stage does when a card arrives (ADR-0056 #3): nothing; CONFIRM submits a draft (number,
 * prices, reservations — the "incomplete sale"); PICK starts picking; SALE issues the picked stock
 * out of STAGING (the "main sale"); CANCEL cancels with a reason.
 */
export const STAGE_ACTIONS = ['NONE', 'CONFIRM', 'PICK', 'SALE', 'CANCEL'] as const;
export type StageAction = (typeof STAGE_ACTIONS)[number];

/** The documents a stage may print when a card arrives. */
export const PRINT_KINDS = ['PICK_LIST', 'DELIVERY_NOTE'] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export const BOARD_RIGHTS = ['VIEW', 'MANAGE'] as const;
export type BoardRight = (typeof BOARD_RIGHTS)[number];
export const STAGE_RIGHTS = ['VIEW', 'EDIT', 'MOVE'] as const;
export type StageRight = (typeof STAGE_RIGHTS)[number];

export const BOARD_LIMITS = { maxName: 80, maxStages: 30, maxBoards: 50 } as const;

/** The states an order may be edited in (ADR-0056 #4): until picking starts. */
export const EDITABLE_STATUSES: readonly OrderStatus[] = ['DRAFT', 'CONFIRMED'];

export function isEditable(status: OrderStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

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
