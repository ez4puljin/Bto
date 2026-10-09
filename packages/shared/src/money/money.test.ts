import { Decimal as GlobalDecimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { Decimal, isDecimal, roundHalfUp, toMoney, toWholeMnt } from './index';

describe('money Decimal clone', () => {
  it('rounds HALF_UP, away from zero on .5', () => {
    expect(toWholeMnt('2.5').toString()).toBe('3');
    expect(toWholeMnt('-2.5').toString()).toBe('-3');
    expect(toWholeMnt('1197.95').toString()).toBe('1198');
    expect(toMoney('10.005').toString()).toBe('10.01');
    expect(roundHalfUp('0.0005', 3).toString()).toBe('0.001');
  });

  it('keeps products of NUMERIC(14,3) and NUMERIC(14,2) exact', () => {
    const qty = new Decimal('99999999999.999');
    const price = new Decimal('999999999999.99');
    // (1e11 - 0.001) * (1e12 - 0.01) = 1e23 - 2e9 + 0.00001: 28 significant digits
    expect(qty.times(price).toFixed(5)).toBe('99999999999998000000000.00001');
  });

  it('never prints exponents for the column ranges in use', () => {
    expect(new Decimal('0.000001').toString()).toBe('0.000001');
    expect(new Decimal('99999999999999.99').toString()).toBe('99999999999999.99');
  });

  it('does not change the global decimal.js configuration', () => {
    expect(GlobalDecimal.rounding).toBe(GlobalDecimal.ROUND_HALF_UP);
    expect(GlobalDecimal.precision).toBe(20);
    expect(Decimal.precision).toBe(40);
  });

  it('recognises its own instances', () => {
    expect(isDecimal(new Decimal(1))).toBe(true);
    expect(isDecimal('1')).toBe(false);
    expect(isDecimal(1)).toBe(false);
  });
});
