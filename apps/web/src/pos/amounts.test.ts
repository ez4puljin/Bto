import { Decimal } from '@tugeel/shared/money';
import { describe, expect, it } from 'vitest';
import { moneyOrZero, parseMoney, parseQty, quickCash } from './amounts';

describe('kiosk amounts', () => {
  it('reads typed tugrik without floats', () => {
    expect(parseMoney('12,500')?.toFixed(2)).toBe('12500.00');
    expect(parseMoney(' 1250.5 ')?.toFixed(2)).toBe('1250.50');
    expect(parseMoney('12.345')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(moneyOrZero('')?.toFixed(2)).toBe('0.00');
    expect(moneyOrZero('abc')).toBeNull();
  });

  it('reads a positive quantity, a comma as the point', () => {
    expect(parseQty('2')).toBe('2');
    expect(parseQty('0,5')).toBe('0.5');
    expect(parseQty('1.250')).toBe('1.25');
    expect(parseQty('0')).toBeNull();
    expect(parseQty('-1')).toBeNull();
    expect(parseQty('1.2345')).toBeNull();
  });

  it('offers the next notes above the amount due, without repeats', () => {
    expect(quickCash(new Decimal('12350')).map((amount) => amount.toFixed())).toEqual([
      '13000',
      '15000',
      '20000',
    ]);
    expect(quickCash(new Decimal('5000')).map((amount) => amount.toFixed())).toEqual([
      '10000',
      '20000',
    ]);
    expect(quickCash(new Decimal('0'))).toEqual([]);
  });
});
