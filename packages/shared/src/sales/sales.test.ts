import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  CUSTOMER_LOW_STOCK_BASE,
  CUSTOMER_ORDER_MAX_DAYS,
  CUSTOMER_ORDER_STATES,
  customerOrderStateOf,
  customerOrderStatusesOf,
  defaultDeliveryDate,
  isCustomerDeliveryDate,
  formatOrderNumber,
  isCancellable,
  isFinished,
  ORDER_NUMBER_DEFAULTS,
  orderHeaderIssues,
  orderNumberPatternIssues,
  ORDER_STATUSES,
  orderNumberPrefix,
  REP_MAP_FRESH_DAYS,
  REP_ORDER_STATES,
  renderOrderNumber,
  repOrderStatusesOf,
  stockWord,
  storeIsStale,
} from './index';

describe('rep order states', () => {
  it('puts every order status in exactly one state', () => {
    const all = REP_ORDER_STATES.flatMap((state) => [...repOrderStatusesOf(state)]);
    expect([...all].sort()).toEqual([...ORDER_STATUSES].sort());
    expect(new Set(all).size).toBe(ORDER_STATUSES.length);
  });

  it('keeps drafts, open orders, sold and cancelled apart', () => {
    expect(repOrderStatusesOf('DRAFT')).toEqual(['DRAFT']);
    expect(repOrderStatusesOf('ACTIVE')).toEqual([
      'SUBMITTED',
      'APPROVAL_PENDING',
      'CONFIRMED',
      'PICKING',
      'PACKED',
      'DISPATCHED',
      'DELIVERY_FAILED',
    ]);
    expect(repOrderStatusesOf('SOLD')).toEqual(['DELIVERED', 'INVOICED', 'CLOSED']);
    expect(repOrderStatusesOf('CANCELLED')).toEqual(['CANCELLED']);
  });
});

describe('rep map freshness', () => {
  it('counts an order within the last seven days, today included, as fresh', () => {
    expect(REP_MAP_FRESH_DAYS).toBe(7);
    expect(storeIsStale('2026-10-18', '2026-10-18')).toBe(false);
    expect(storeIsStale('2026-10-12', '2026-10-18')).toBe(false);
    expect(storeIsStale('2026-10-11', '2026-10-18')).toBe(true);
    // Across a month's end.
    expect(storeIsStale('2026-09-27', '2026-10-03')).toBe(false);
    expect(storeIsStale('2026-09-26', '2026-10-03')).toBe(true);
  });

  it('marks a store never ordered for as stale', () => {
    expect(storeIsStale(null, '2026-10-18')).toBe(true);
  });
});

describe('order header', () => {
  const ok = {
    fulfilment: 'DELIVERY' as const,
    deliveryDate: '2026-10-16',
    addressId: 3,
    contactPhone: '9911 2233',
  };

  it('proposes tomorrow and accepts today or later', () => {
    expect(defaultDeliveryDate('2026-10-15')).toBe('2026-10-16');
    expect(orderHeaderIssues(ok, '2026-10-15')).toEqual([]);
    expect(orderHeaderIssues({ ...ok, deliveryDate: '2026-10-15' }, '2026-10-15')).toEqual([]);
    expect(orderHeaderIssues({ ...ok, deliveryDate: '2026-10-14' }, '2026-10-15')).toEqual([
      { path: 'deliveryDate', code: 'notPast' },
    ]);
    expect(orderHeaderIssues({ ...ok, deliveryDate: '16/10' }, '2026-10-15')).toEqual([
      { path: 'deliveryDate', code: 'isDate' },
    ]);
  });

  it('needs an address for a delivery only and a mobile number when a phone is given', () => {
    expect(orderHeaderIssues({ ...ok, addressId: null }, '2026-10-15')).toEqual([
      { path: 'addressId', code: 'required' },
    ]);
    expect(
      orderHeaderIssues(
        { ...ok, fulfilment: 'PICKUP', addressId: null, contactPhone: null },
        '2026-10-15',
      ),
    ).toEqual([]);
    expect(orderHeaderIssues({ ...ok, contactPhone: '123' }, '2026-10-15')).toEqual([
      { path: 'contactPhone', code: 'phone' },
    ]);
  });

  it('cancels before picking only', () => {
    expect(isCancellable('DRAFT')).toBe(true);
    expect(isCancellable('CONFIRMED')).toBe(true);
    expect(isCancellable('PICKING')).toBe(false);
    expect(isCancellable('CANCELLED')).toBe(false);
  });
});

describe('finished orders', () => {
  it('archives only what nothing more happens to', () => {
    expect(isFinished('DELIVERED')).toBe(true);
    expect(isFinished('INVOICED')).toBe(true);
    expect(isFinished('CLOSED')).toBe(true);
    expect(isFinished('CANCELLED')).toBe(true);
    expect(isFinished('CONFIRMED')).toBe(false);
    expect(isFinished('PACKED')).toBe(false);
  });
});

describe('order number format', () => {
  it('renders the owner’s format with the day and a padded counter', () => {
    const { pattern, digits } = ORDER_NUMBER_DEFAULTS;
    expect(orderNumberPatternIssues(pattern, digits)).toEqual([]);
    expect(orderNumberPrefix(pattern, '2026-10-05')).toBe('20261005_');
    expect(renderOrderNumber(pattern, digits, '2026-10-05', 1)).toBe('20261005_0001');
    expect(renderOrderNumber(pattern, digits, '2026-10-05', 2)).toBe('20261005_0002');
    expect(renderOrderNumber('ORD-{year}-', 5, '2026-10-05', 42)).toBe('ORD-2026-00042');
    // A counter longer than its digits is never cut.
    expect(formatOrderNumber('20261005_', 4, 12345)).toBe('20261005_12345');
  });

  it('refuses formats that could make two numbers alike', () => {
    expect(orderNumberPatternIssues('', 4)).toEqual([{ path: 'pattern', code: 'EMPTY' }]);
    expect(orderNumberPatternIssues('{year}{month}{day}', 4)).toEqual([
      { path: 'pattern', code: 'ENDS_WITH_DIGIT' },
    ]);
    expect(orderNumberPatternIssues('A1', 4)).toEqual([
      { path: 'pattern', code: 'ENDS_WITH_DIGIT' },
    ]);
    expect(orderNumberPatternIssues('{week}_', 4)).toEqual([
      { path: 'pattern', code: 'UNKNOWN_TOKEN' },
    ]);
    expect(orderNumberPatternIssues('{year} _', 4)).toEqual([
      { path: 'pattern', code: 'BAD_CHAR' },
    ]);
    expect(orderNumberPatternIssues('{year_', 4)).toEqual([{ path: 'pattern', code: 'BAD_CHAR' }]);
    expect(orderNumberPatternIssues('so-{year}-', 6)).toEqual([
      { path: 'pattern', code: 'RESERVED' },
    ]);
    expect(orderNumberPatternIssues('x'.repeat(25), 4)).toEqual([
      { path: 'pattern', code: 'TOO_LONG' },
    ]);
    expect(orderNumberPatternIssues('ХРХ-{year}-', 0)).toEqual([{ path: 'digits', code: 'RANGE' }]);
    expect(orderNumberPatternIssues('ХРХ-{year}-', 9)).toEqual([{ path: 'digits', code: 'RANGE' }]);
    expect(orderNumberPatternIssues('ХРХ-{year}-', 4)).toEqual([]);
  });
});

describe('the customer app (ADR-0079)', () => {
  const d = (value: number | string) => new Decimal(value);

  it('says OUT, LOW or IN by the minimum level, else one pack, else 10 base units', () => {
    expect(stockWord(d(0), d(5), d(12))).toBe('OUT');
    expect(stockWord(d(-1), null, null)).toBe('OUT');
    expect(stockWord(d(4), d(5), d(12))).toBe('LOW');
    expect(stockWord(d(5), d(5), d(12))).toBe('IN');
    expect(stockWord(d(11), null, d(12))).toBe('LOW');
    expect(stockWord(d(12), null, d(12))).toBe('IN');
    expect(stockWord(d(11), d(0), d(12))).toBe('LOW');
    expect(stockWord(d('9.5'), null, null)).toBe('LOW');
    expect(stockWord(d(CUSTOMER_LOW_STOCK_BASE), null, null)).toBe('IN');
  });

  it('puts every order status into exactly one customer word', () => {
    const all = CUSTOMER_ORDER_STATES.flatMap((state) => customerOrderStatusesOf(state));
    expect([...all].sort()).toEqual([...ORDER_STATUSES].sort());
    expect(new Set(all).size).toBe(ORDER_STATUSES.length);
    expect(customerOrderStateOf('DRAFT')).toBe('PENDING');
    expect(customerOrderStateOf('CONFIRMED')).toBe('CONFIRMED');
    expect(customerOrderStateOf('PICKING')).toBe('PREPARING');
    expect(customerOrderStateOf('PACKED')).toBe('READY');
    expect(customerOrderStateOf('INVOICED')).toBe('DELIVERED');
    expect(customerOrderStateOf('CANCELLED')).toBe('CANCELLED');
  });

  it('takes delivery days from today to 60 days ahead', () => {
    expect(isCustomerDeliveryDate('2026-10-19', '2026-10-19')).toBe(true);
    expect(isCustomerDeliveryDate('2026-12-18', '2026-10-19')).toBe(true);
    expect(isCustomerDeliveryDate('2026-12-19', '2026-10-19')).toBe(false);
    expect(isCustomerDeliveryDate('2026-10-18', '2026-10-19')).toBe(false);
    expect(isCustomerDeliveryDate('2026-02-30', '2026-01-19')).toBe(false);
    expect(CUSTOMER_ORDER_MAX_DAYS).toBe(60);
  });
});
