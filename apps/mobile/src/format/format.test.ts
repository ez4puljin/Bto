import { describe, expect, it } from 'vitest';
import { deliveryDays, shiftMonth, ubDate, ubTime, weekdayOf } from '../dates/dates';
import { formatMnt, formatQty, packsOf } from './format';

describe('formatting', () => {
  it('groups money and trims quantities', () => {
    expect(formatMnt('1250000')).toBe('1,250,000');
    expect(formatMnt('1150.50')).toBe('1,150.50');
    expect(formatMnt('-500')).toBe('-500');
    expect(formatQty('12.000')).toBe('12');
    expect(formatQty('2.500')).toBe('2.5');
  });

  it('tells stock in packs and pieces', () => {
    const units = [
      { factor: '1', name: 'ш' },
      { factor: '12', name: 'хайрцаг' },
    ];
    expect(packsOf('30', units)).toEqual([
      { qty: '2', name: 'хайрцаг' },
      { qty: '6', name: 'ш' },
    ]);
    expect(packsOf('24', units)).toEqual([{ qty: '2', name: 'хайрцаг' }]);
    expect(packsOf('0', units)).toEqual([]);
    expect(packsOf('2.5', [{ factor: '1', name: 'кг' }])).toEqual([{ qty: '2.5', name: 'кг' }]);
  });
});

describe('dates without time zones', () => {
  it('gives weekdays, delivery days and months', () => {
    expect(weekdayOf('2026-10-15')).toBe(4);
    expect(deliveryDays('2026-12-30', 3)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01']);
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-10', 1)).toBe('2026-11');
  });

  it('reads instants in Ulaanbaatar time', () => {
    expect(ubDate('2026-09-30T16:30:00Z')).toBe('2026-10-01');
    expect(ubDate('2026-09-30T15:59:00Z')).toBe('2026-09-30');
    expect(ubTime('2026-10-15T02:05:00Z')).toBe('10:05');
    expect(ubDate('garbage')).toBe('');
  });
});
