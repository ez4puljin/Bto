import { describe, expect, it } from 'vitest';
import { defaultDeliveryDate, isCancellable, orderHeaderIssues } from './index';

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
