import type { Decimal } from '@tugeel/shared/money';
import type { PriceBasis } from '@tugeel/shared/pricing';
import type { Fulfilment, OrderChannel, PaymentMethod } from '@tugeel/shared/sales';
import type { Tx } from '../../common/db/db.types';
import type { VatType } from '../catalog';
import type { Actor } from '../identity';
import type { LockedCustomer } from '../partners';

/**
 * What sales asks of finance (ADR-0060 #1) and tells notifications (ADR-0062 #4). The modules bind
 * these tokens with `useExisting`; `SalesOrdersService` resolves them through `ModuleRef`
 * (`strict: false`) and does without them when nothing is bound (the worker, tests that load sales
 * alone).
 */

export interface CreditCheckInput {
  customer: LockedCustomer;
  /** The order being confirmed or re-priced; its own total is never in `openOrders`. */
  orderId: number;
  /** The order's total, whole MNT. */
  amount: Decimal;
  /** The customer's other confirmed orders not yet invoiced, summed by sales. */
  openOrders: Decimal;
}

export type CreditDecision =
  | { ok: true }
  | {
      ok: false;
      /** The customer is on hold, has an overdue invoice, or would pass the limit. */
      reason: 'HOLD' | 'OVERDUE' | 'LIMIT';
      /** Balance + open orders + this order. */
      exposure: Decimal;
      limit: Decimal | null;
      /** How far the exposure passes the limit (0 unless LIMIT). */
      excess: Decimal;
      overdueAmount: Decimal;
      oldestDueDate: string | null;
      /** The customer's open credits (unapplied payments and returns), from the Finance Core (ADR-0073 #4). */
      creditsOpen?: Decimal;
    };

export interface CreditChecker {
  check(tx: Tx, input: CreditCheckInput): Promise<CreditDecision>;
}

export const CREDIT_CHECKER = Symbol('CREDIT_CHECKER');

/** A part of a line as frozen at the submit (ADR-0048 #4); the invoice fills them in order. */
export interface SoldPart {
  productUnitId: number;
  uomName: string;
  basis: PriceBasis;
  qty: Decimal;
  factorSnapshot: Decimal;
  qtyBase: Decimal;
  listPrice: Decimal;
  unitPrice: Decimal;
  discountAmount: Decimal;
}

export interface SoldLine {
  orderLineId: number;
  lineNo: number;
  productId: number;
  sku: string;
  name: string;
  baseUnit: { productUnitId: number; uomName: string };
  vatType: VatType;
  cityTax: boolean | null;
  warehouseId: number;
  /** Ordered, in base units. */
  qtyBase: Decimal;
  /** Issued by the sale, in base units; 0 when nothing was picked. */
  qtyDelivered: Decimal;
  parts: SoldPart[];
}

/** The sold order as finance needs it, by value: finance never reads a sales table. */
export interface SaleSnapshot {
  orderId: number;
  orderNumber: string;
  customerId: number;
  /** The board's branch, else the first line's warehouse branch; null when neither is known. */
  branchId: number | null;
  channel: OrderChannel;
  fulfilment: Fulfilment;
  deliveryDate: string;
  paymentMethod: PaymentMethod;
  note: string | null;
  lines: SoldLine[];
}

export interface SaleSink {
  /** Invoices the sale; null when nothing was delivered (no invoice). */
  onSold(
    tx: Tx,
    actor: Actor,
    snapshot: SaleSnapshot,
  ): Promise<{ invoiceId: number; number: string; total: Decimal } | null>;
}

export const SALE_SINK = Symbol('SALE_SINK');

/**
 * A sale told to whoever listens (ADR-0062 #4), by value, inside the sale's transaction after the
 * invoice. Notifications binds it to tell the rep their order was sold; only one listener binds.
 */
export interface SaleNotice {
  orderId: number;
  orderNumber: string;
  channel: OrderChannel;
  /** Who created the order; null for orders without an author. */
  createdBy: number | null;
  customerId: number;
  /** The total frozen at the submit, whole MNT; null when the order was never priced. */
  orderTotal: string | null;
  /** The invoice the sale issued; null without finance or when nothing was delivered. */
  invoiceId: number | null;
  invoiceNumber: string | null;
  /** The invoice's total, whole MNT strings as `orderTotal` (ADR-0079 #8: the amount sold). */
  invoiceTotal: string | null;
}

export interface SaleListener {
  /** One statement in the sale's transaction; an error aborts the sale (never caught, 25P02). */
  onSale(tx: Tx, notice: SaleNotice): Promise<void>;
}

export const SALE_LISTENER = Symbol('SALE_LISTENER');

/** A backordered line of a confirmed order, in the line's unit when it divides, else base units. */
export interface BackorderedLine {
  productId: number;
  name: string;
  qty: string;
  unitName: string;
}

/**
 * An order confirmed (the submit, ADR-0055), told by value inside its transaction after the
 * reservations (ADR-0079 #8): the store learns what was confirmed and what waits.
 */
export interface OrderConfirmedNotice {
  orderId: number;
  orderNumber: string;
  channel: OrderChannel;
  createdBy: number | null;
  customerId: number;
  /** The total frozen at the submit, whole MNT. */
  orderTotal: string;
  /** How many lines wait for stock, and the first few of them. */
  backorderedLines: number;
  backordered: BackorderedLine[];
}

/** An order cancelled with its reason, told inside the cancel's transaction (ADR-0079 #8). */
export interface OrderCancelledNotice {
  orderId: number;
  orderNumber: string;
  channel: OrderChannel;
  createdBy: number | null;
  customerId: number;
  reason: string;
}

/**
 * Confirmations and cancellations told to whoever listens (notifications binds it for the
 * customer app); one statement each in the caller's transaction, never caught (25P02).
 */
export interface OrderListener {
  onConfirmed(tx: Tx, notice: OrderConfirmedNotice): Promise<void>;
  onCancelled(tx: Tx, notice: OrderCancelledNotice): Promise<void>;
}

export const ORDER_LISTENER = Symbol('ORDER_LISTENER');
