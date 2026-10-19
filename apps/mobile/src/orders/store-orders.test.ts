import { describe, expect, it } from 'vitest';
import { amountOf, byDay, type StoreOrderFields, takenAt, takerOf } from './store-orders';

const order = (fields: Partial<StoreOrderFields> = {}): StoreOrderFields => ({
  mine: false,
  takerName: 'Бат Болд',
  createdDate: '2026-10-18',
  createdTime: '14:05',
  total: '125000.00',
  estimatedTotal: null,
  ...fields,
});

describe('store orders', () => {
  it('names the taker: the rep, a person, or nobody known', () => {
    expect(takerOf(order({ mine: true }))).toEqual({ kind: 'me' });
    expect(takerOf(order())).toEqual({ kind: 'name', name: 'Бат Болд' });
    expect(takerOf(order({ takerName: null }))).toEqual({ kind: 'unknown' });
    expect(takerOf(order({ takerName: '  ' }))).toEqual({ kind: 'unknown' });
  });

  it('shows the day and time, or the time alone under a day title', () => {
    expect(takenAt(order())).toBe('10/18 14:05');
    expect(takenAt(order(), false)).toBe('14:05');
  });

  it('takes the total, a draft estimate, or nothing yet', () => {
    expect(amountOf(order())).toEqual({ kind: 'total', value: '125000.00' });
    expect(amountOf(order({ total: null, estimatedTotal: '98000.00' }))).toEqual({
      kind: 'estimate',
      value: '98000.00',
    });
    expect(amountOf(order({ total: null }))).toEqual({ kind: 'later' });
  });

  it('groups runs of one day, keeping the order', () => {
    const rows = [
      { id: 3, createdDate: '2026-10-18' },
      { id: 2, createdDate: '2026-10-18' },
      { id: 1, createdDate: '2026-10-16' },
    ];
    expect(byDay(rows)).toEqual([
      { day: '2026-10-18', data: [rows[0], rows[1]] },
      { day: '2026-10-16', data: [rows[2]] },
    ]);
    expect(byDay([])).toEqual([]);
  });
});
