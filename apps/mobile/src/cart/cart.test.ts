import { describe, expect, it } from 'vitest';
import {
  type Cart,
  cartFrom,
  cartIssues,
  cartReducer,
  EMPTY_CART,
  lineOf,
  MAX_LINES,
  orderRequestOf,
  qtyOf,
} from './cart';
import { canonical, outcomeOf, pendingFor } from './send';

const unit = (productUnitId: number, isBase = true) => ({
  productId: 100 + productUnitId,
  productUnitId,
  sku: `SKU${productUnitId}`,
  name: 'Кола',
  uomName: isBase ? 'ш' : 'хайрцаг',
  uomCode: isBase ? 'PCS' : 'BOX',
  factorToBase: isBase ? '1' : '12',
  isBase,
  wholesale: isBase ? '1150' : '12000',
  thumbUrl: null,
});

describe('the cart (ADR-0061 #8)', () => {
  it('keeps one line per product unit and removes a line at 0', () => {
    let cart = cartReducer(EMPTY_CART, { type: 'add', line: unit(1), qty: 2 });
    cart = cartReducer(cart, { type: 'add', line: unit(1), qty: 3 });
    cart = cartReducer(cart, { type: 'add', line: unit(2, false), qty: 1 });
    expect(cart.lines.map((line) => [line.productUnitId, line.qty])).toEqual([
      [1, '5'],
      [2, '1'],
    ]);
    expect(qtyOf(cart, 1)).toBe(5);
    cart = cartReducer(cart, { type: 'setQty', productUnitId: 1, qty: 0 });
    expect(cart.lines.map((line) => line.productUnitId)).toEqual([2]);
    expect(cartReducer(cart, { type: 'add', line: unit(3), qty: 0 })).toBe(cart);
    expect(cartReducer(cart, { type: 'setQty', productUnitId: 2, qty: 2.7 }).lines[0]?.qty).toBe(
      '2',
    );
  });

  it('keeps one line per product from its page: another unit replaces it in place', () => {
    const pieces = { ...unit(1), productId: 7 };
    const boxes = { ...unit(2, false), productId: 7 };
    let cart = cartReducer(EMPTY_CART, { type: 'add', line: unit(5), qty: 1 });
    cart = cartReducer(cart, { type: 'setLine', line: pieces, qty: 6 });
    cart = cartReducer(cart, { type: 'add', line: unit(6), qty: 1 });
    cart = cartReducer(cart, { type: 'setLine', line: boxes, qty: 2 });
    expect(cart.lines.map((line) => [line.productUnitId, line.qty])).toEqual([
      [5, '1'],
      [2, '2'],
      [6, '1'],
    ]);
    expect(lineOf(cart, 7)?.uomCode).toBe('BOX');
    cart = cartReducer(cart, { type: 'setLine', line: boxes, qty: 0 });
    expect(lineOf(cart, 7)).toBeUndefined();
    expect(cart.lines).toHaveLength(2);
  });

  it('holds at most the lines an order takes', () => {
    let cart: Cart = EMPTY_CART;
    for (let id = 1; id <= MAX_LINES + 5; id += 1) {
      cart = cartReducer(cart, { type: 'add', line: unit(id), qty: 1 });
    }
    expect(cart.lines).toHaveLength(MAX_LINES);
  });

  it('delivers to the customer’s default address, or lets them pick up without one', () => {
    const customer = { id: 9, code: '1009', name: 'Дэлгүүр' };
    let cart = cartReducer(EMPTY_CART, { type: 'customer', customer, defaultAddressId: 31 });
    expect(cart).toMatchObject({ fulfilment: 'DELIVERY', addressId: 31 });
    cart = cartReducer(cart, { type: 'customer', customer, defaultAddressId: null });
    expect(cart).toMatchObject({ fulfilment: 'PICKUP', addressId: null });
    cart = cartReducer(cart, { type: 'address', addressId: 32 });
    expect(cart).toMatchObject({ fulfilment: 'DELIVERY', addressId: 32 });
    // Pickup and back keeps the chosen address.
    cart = cartReducer(cart, { type: 'pickup' });
    expect(orderRequestOf(cart, 1).addressId).toBeNull();
    cart = cartReducer(cart, { type: 'delivery' });
    expect(cart).toMatchObject({ fulfilment: 'DELIVERY', addressId: 32 });
  });

  it('takes the customer’s first contact unless one was typed, and cuts it to the limits', () => {
    const customer = { id: 9, code: '1009', name: 'Дэлгүүр' };
    let cart = cartReducer(EMPTY_CART, {
      type: 'customer',
      customer,
      defaultAddressId: null,
      contact: { name: 'Бат', phone: '99112233' },
    });
    expect(cart).toMatchObject({ contactName: 'Бат', contactPhone: '99112233' });
    cart = cartReducer(cart, { type: 'contact', name: 'Дорж' });
    cart = cartReducer(cart, {
      type: 'customer',
      customer: { ...customer, id: 10 },
      defaultAddressId: null,
      contact: { name: 'Сүх', phone: null },
    });
    expect(cart).toMatchObject({ contactName: 'Дорж', contactPhone: '99112233' });
    cart = cartReducer(cart, { type: 'contact', phone: '9'.repeat(40) });
    expect(cart.contactPhone).toHaveLength(30);
  });

  it('lists what keeps it from being sent, and builds the order body', () => {
    const today = '2026-10-15';
    expect(cartIssues(EMPTY_CART, today, null)).toEqual([
      'lines',
      'customer',
      'address',
      'deliveryDate',
      'payment',
      'stage',
    ]);
    let cart = cartReducer(EMPTY_CART, { type: 'add', line: unit(1), qty: 3 });
    cart = cartReducer(cart, {
      type: 'customer',
      customer: { id: 9, code: '1009', name: 'Дэлгүүр' },
      defaultAddressId: null,
    });
    cart = cartReducer(cart, { type: 'deliveryDate', date: '2026-10-14' });
    cart = cartReducer(cart, { type: 'payment', method: 'CREDIT' });
    expect(cartIssues(cart, today, 5)).toEqual(['deliveryDate']);
    cart = cartReducer(cart, { type: 'deliveryDate', date: '2026-10-16' });
    cart = cartReducer(cart, { type: 'note', note: '  Өглөө  ' });
    cart = cartReducer(cart, { type: 'contact', name: ' Бат ', phone: '' });
    expect(cartIssues(cart, today, 5)).toEqual([]);
    expect(orderRequestOf(cart, 5)).toEqual({
      stageId: 5,
      customerId: 9,
      fulfilment: 'PICKUP',
      deliveryDate: '2026-10-16',
      addressId: null,
      contactName: 'Бат',
      contactPhone: null,
      paymentMethod: 'CREDIT',
      note: 'Өглөө',
      lines: [{ productUnitId: 1, qty: '3' }],
    });
  });

  it('starts the next order on today once one is sent, keeping only the payment', () => {
    let cart = cartReducer(EMPTY_CART, { type: 'add', line: unit(1), qty: 3 });
    cart = cartReducer(cart, {
      type: 'customer',
      customer: { id: 9, code: '1009', name: 'Дэлгүүр' },
      defaultAddressId: 31,
      contact: { name: 'Бат', phone: '99112233' },
    });
    cart = cartReducer(cart, { type: 'deliveryDate', date: '2026-10-18' });
    cart = cartReducer(cart, { type: 'payment', method: 'CREDIT' });
    cart = cartReducer(cart, { type: 'note', note: 'Өглөө' });
    const sent = cartReducer(cart, { type: 'sent' });
    expect(sent).toEqual({ ...EMPTY_CART, paymentMethod: 'CREDIT' });
    // The date is the screen's to propose again: today, an issue until it does.
    expect(sent.deliveryDate).toBeNull();
    expect(cartIssues(sent, '2026-10-17', 5)).toContain('deliveryDate');
  });

  it('reads a stored cart back safely', () => {
    expect(cartFrom(null)).toEqual(EMPTY_CART);
    expect(cartFrom({ lines: 'x' })).toEqual(EMPTY_CART);
    expect(cartFrom({ lines: [unit(1)], note: 'n' })).toMatchObject({
      note: 'n',
      fulfilment: 'DELIVERY',
      contactName: '',
    });
    // A cart stored before units had codes.
    const { uomCode: _code, ...old } = unit(1);
    expect(cartFrom({ lines: [old] }).lines[0]?.uomCode).toBeNull();
  });
});

describe('the pending send (ADR-0061 #8)', () => {
  const now = new Date('2026-10-15T10:00:00Z');
  let keys = 0;
  const newKey = () => `key-${(keys += 1)}`;

  it('keeps the key for the same body and takes a new one for another', () => {
    const body = { b: 1, a: [{ y: 2, x: 1 }] };
    const first = pendingFor(null, body, newKey, now);
    expect(pendingFor(first, { a: [{ x: 1, y: 2 }], b: 1 }, newKey, now)).toBe(first);
    expect(pendingFor(first, { ...body, b: 2 }, newKey, now).key).not.toBe(first.key);
    const old = { ...first, startedAt: '2026-10-08T09:00:00Z' };
    expect(pendingFor(old, body, newKey, now).key).not.toBe(first.key);
    expect(canonical({ b: 1, a: undefined, c: null })).toBe('{"b":1,"c":null}');
  });

  it('reads an answer: sent, wait, unknown or refused', () => {
    expect(outcomeOf(201, null)).toBe('sent');
    expect(outcomeOf(409, 'IDEMPOTENCY_KEY_IN_PROGRESS')).toBe('wait');
    expect(outcomeOf(0, 'NETWORK')).toBe('unknown');
    expect(outcomeOf(503, 'SERVICE_UNAVAILABLE')).toBe('unknown');
    expect(outcomeOf(422, 'VALIDATION_FAILED')).toBe('refused');
    expect(outcomeOf(409, 'IDEMPOTENCY_KEY_REUSED')).toBe('refused');
  });
});
