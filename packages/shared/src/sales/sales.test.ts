import { describe, expect, it } from 'vitest';
import {
  defaultDeliveryDate,
  formatOrderNumber,
  isCancellable,
  isFinished,
  ORDER_NUMBER_DEFAULTS,
  orderHeaderIssues,
  orderNumberPatternIssues,
  orderNumberPrefix,
  renderOrderNumber,
} from './index';

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
