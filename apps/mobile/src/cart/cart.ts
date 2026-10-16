import { Decimal } from '@tugeel/shared/money';
import type { Fulfilment, PaymentMethod } from '@tugeel/shared/sales';

/** At most this many lines in one order (ORDER_LIMITS.maxLines on the server). */
export const MAX_LINES = 200;

/** A line of the cart: one product unit and how many of it. */
export interface CartLine {
  productId: number;
  productUnitId: number;
  sku: string;
  name: string;
  uomName: string;
  /** Base units in one of this unit. */
  factorToBase: string;
  isBase: boolean;
  /** In the unit, a whole number: pieces and boxes are counted, never weighed, in the rep app. */
  qty: string;
  /** One unit at the WHOLESALE list when it was added; the server prices the order. */
  wholesale: string | null;
  thumbUrl: string | null;
}

export interface CartCustomer {
  id: number;
  code: string;
  name: string;
}

export interface Cart {
  lines: CartLine[];
  customer: CartCustomer | null;
  fulfilment: Fulfilment;
  addressId: number | null;
  /** YYYY-MM-DD; null until chosen (the screen proposes tomorrow). */
  deliveryDate: string | null;
  paymentMethod: PaymentMethod | null;
  note: string;
}

export const EMPTY_CART: Cart = {
  lines: [],
  customer: null,
  fulfilment: 'DELIVERY',
  addressId: null,
  deliveryDate: null,
  paymentMethod: null,
  note: '',
};

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'qty'>; qty: number }
  | { type: 'setQty'; productUnitId: number; qty: number }
  | { type: 'remove'; productUnitId: number }
  | {
      type: 'customer';
      customer: CartCustomer;
      /** The customer's default address: DELIVERY there; none means PICKUP. */
      defaultAddressId: number | null;
    }
  | { type: 'address'; addressId: number }
  | { type: 'pickup' }
  | { type: 'deliveryDate'; date: string }
  | { type: 'payment'; method: PaymentMethod }
  | { type: 'note'; note: string }
  | { type: 'sent' }
  | { type: 'load'; cart: Cart };

const whole = (qty: number) => (Number.isFinite(qty) ? Math.max(0, Math.floor(qty)) : 0);

/**
 * The cart's rules (ADR-0061 #8): one line per product unit (a second add raises its quantity),
 * a quantity of 0 removes the line, at most MAX_LINES lines, delivery to the chosen customer's
 * address or pickup when they have none. A sent order empties the lines and the customer and
 * keeps the date and the payment for the next shop.
 */
export function cartReducer(cart: Cart, action: CartAction): Cart {
  switch (action.type) {
    case 'add': {
      const qty = whole(action.qty);
      if (qty === 0) return cart;
      const existing = cart.lines.find((line) => line.productUnitId === action.line.productUnitId);
      if (existing) {
        return {
          ...cart,
          lines: cart.lines.map((line) =>
            line === existing ? { ...line, qty: new Decimal(line.qty).plus(qty).toFixed(0) } : line,
          ),
        };
      }
      if (cart.lines.length >= MAX_LINES) return cart;
      return { ...cart, lines: [...cart.lines, { ...action.line, qty: String(qty) }] };
    }
    case 'setQty': {
      const qty = whole(action.qty);
      return {
        ...cart,
        lines:
          qty === 0
            ? cart.lines.filter((line) => line.productUnitId !== action.productUnitId)
            : cart.lines.map((line) =>
                line.productUnitId === action.productUnitId ? { ...line, qty: String(qty) } : line,
              ),
      };
    }
    case 'remove':
      return {
        ...cart,
        lines: cart.lines.filter((line) => line.productUnitId !== action.productUnitId),
      };
    case 'customer':
      return {
        ...cart,
        customer: action.customer,
        addressId: action.defaultAddressId,
        fulfilment: action.defaultAddressId === null ? 'PICKUP' : 'DELIVERY',
      };
    case 'address':
      return { ...cart, addressId: action.addressId, fulfilment: 'DELIVERY' };
    case 'pickup':
      return { ...cart, addressId: null, fulfilment: 'PICKUP' };
    case 'deliveryDate':
      return { ...cart, deliveryDate: action.date };
    case 'payment':
      return { ...cart, paymentMethod: action.method };
    case 'note':
      return { ...cart, note: action.note.slice(0, 500) };
    case 'sent':
      return { ...EMPTY_CART, deliveryDate: cart.deliveryDate, paymentMethod: cart.paymentMethod };
    case 'load':
      return action.cart;
  }
}

/** How many of a product unit the cart holds (0 when none). */
export function qtyOf(cart: Cart, productUnitId: number): number {
  const line = cart.lines.find((entry) => entry.productUnitId === productUnitId);
  return line ? Number.parseInt(line.qty, 10) : 0;
}

/** The lines as a quote and an order take them. */
export function linesOf(cart: Cart): { productUnitId: number; qty: string }[] {
  return cart.lines.map((line) => ({ productUnitId: line.productUnitId, qty: line.qty }));
}

/** What still keeps the cart from being sent, in the order the screen shows them. */
export type CartIssue = 'lines' | 'customer' | 'address' | 'deliveryDate' | 'payment' | 'stage';

export function cartIssues(cart: Cart, today: string, stageId: number | null): CartIssue[] {
  const issues: CartIssue[] = [];
  if (cart.lines.length === 0) issues.push('lines');
  if (!cart.customer) issues.push('customer');
  if (cart.fulfilment === 'DELIVERY' && cart.addressId === null) issues.push('address');
  if (!cart.deliveryDate || cart.deliveryDate < today) issues.push('deliveryDate');
  if (!cart.paymentMethod) issues.push('payment');
  if (stageId === null) issues.push('stage');
  return issues;
}

/** POST /sales-rep/orders' body (ADR-0061 #5). */
export interface OrderRequest {
  stageId: number;
  customerId: number;
  fulfilment: Fulfilment;
  deliveryDate: string;
  addressId: number | null;
  paymentMethod: PaymentMethod;
  note: string | null;
  lines: { productUnitId: number; qty: string }[];
}

/** The order the cart makes; a pending send compares it in canonical form (send.ts). */
export function orderRequestOf(cart: Cart, stageId: number): OrderRequest {
  return {
    stageId,
    customerId: cart.customer?.id ?? 0,
    fulfilment: cart.fulfilment,
    deliveryDate: cart.deliveryDate ?? '',
    addressId: cart.fulfilment === 'DELIVERY' ? cart.addressId : null,
    paymentMethod: cart.paymentMethod ?? 'CASH',
    note: cart.note.trim() === '' ? null : cart.note.trim(),
    lines: linesOf(cart),
  };
}

/** A stored cart read back: anything that is not a cart is an empty one. */
export function cartFrom(value: unknown): Cart {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Cart).lines)) {
    return EMPTY_CART;
  }
  const cart = value as Cart;
  return { ...EMPTY_CART, ...cart, lines: cart.lines.slice(0, MAX_LINES) };
}
