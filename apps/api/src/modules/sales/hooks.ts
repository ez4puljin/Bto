import type { Decimal } from '@tugeel/shared/money';
import type { PriceBasis } from '@tugeel/shared/pricing';
import type { Fulfilment, OrderChannel, PaymentMethod } from '@tugeel/shared/sales';
import type { Tx } from '../../common/db/db.types';
import type { VatType } from '../catalog';
import type { Actor } from '../identity';
import type { LockedCustomer } from '../partners';

/**
 * What sales asks of finance (ADR-0060 #1). Finance binds these tokens with `useExisting`;
 * `SalesOrdersService` resolves them through `ModuleRef` (`strict: false`) and does without them
 * when nothing is bound (the worker, tests that load sales alone).
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
  ): Promise<{ invoiceId: number; number: string } | null>;
}

export const SALE_SINK = Symbol('SALE_SINK');
