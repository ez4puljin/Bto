import { describe, expect, it } from 'vitest';
import * as finance from '../finance';
import { Decimal, type DecimalInput, toMoney } from '../money';
import * as pos from '../pos';
import {
  CHART_ROLES,
  CHART_TEMPLATE,
  cityTaxCode,
  EBARIMT_STATUSES,
  NUMBER_DEFAULTS,
  RECEIPT_TYPES,
  taxSplit,
} from './index';

/** The split exactly as `packages/shared/src/finance/index.ts` had it at 3577787 (ADR-0010 #4). */
function taxSplitAt3577787(total: DecimalInput, vatRatePct: DecimalInput, cityPct: DecimalInput) {
  const amount = new Decimal(total);
  const vatRate = new Decimal(vatRatePct);
  const cityRate = new Decimal(cityPct);
  const divisor = new Decimal(100).plus(vatRate).plus(cityRate);
  const vat = vatRate.isZero() ? new Decimal(0) : toMoney(amount.times(vatRate).div(divisor));
  const cityTax = cityRate.isZero() ? new Decimal(0) : toMoney(amount.times(cityRate).div(divisor));
  return { vat, cityTax, net: amount.minus(vat).minus(cityTax) };
}

/** mulberry32: the same 1,000 lines on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe('the Mongolian layer (ADR-0074 #2)', () => {
  it('splits 1,000 random lines exactly as before the move', () => {
    const next = random(20261018);
    const vatRates = ['0', '10', '10', '10'];
    const cityRates = ['0', '0', '1', '2'];
    for (let i = 0; i < 1_000; i += 1) {
      const whole = Math.floor(next() * 10_000_000);
      const cents = Math.floor(next() * 100);
      const total = `${whole}.${String(cents).padStart(2, '0')}`;
      const vat = vatRates[i % vatRates.length] ?? '10';
      const city = cityRates[Math.floor(next() * cityRates.length)] ?? '0';
      const got = taxSplit(total, vat, city);
      const want = taxSplitAt3577787(total, vat, city);
      expect([got.vat.toFixed(2), got.cityTax.toFixed(2), got.net.toFixed(2)]).toEqual([
        want.vat.toFixed(2),
        want.cityTax.toFixed(2),
        want.net.toFixed(2),
      ]);
    }
  });

  it('keeps the golden values of the split', () => {
    const split = taxSplit('110000', '10', '0');
    expect([split.vat.toFixed(2), split.net.toFixed(2)]).toEqual(['10000.00', '100000.00']);
  });

  it('is what the old paths still export', () => {
    expect(finance.taxSplit).toBe(taxSplit);
    expect(finance.DEFAULT_GL_ACCOUNTS).toBe(CHART_TEMPLATE);
    expect(finance.GL_ROLES).toBe(CHART_ROLES);
    expect(finance.FINANCE_NUMBER_DEFAULTS).toBe(NUMBER_DEFAULTS);
    expect(pos.RECEIPT_TYPES).toBe(RECEIPT_TYPES);
    expect(pos.EBARIMT_STATUSES).toBe(EBARIMT_STATUSES);
  });

  it('gives every template account a distinct code and role', () => {
    const codes = CHART_TEMPLATE.map((account) => account.code);
    const roles = CHART_TEMPLATE.map((account) => account.role).filter((role) => role !== null);
    expect(new Set(codes).size).toBe(codes.length);
    expect([...roles].sort()).toEqual([...CHART_ROLES].sort());
  });

  it('builds city-tax codes from seven-digit activity codes', () => {
    expect(cityTaxCode('6331000')).toBe('MN.CITY.6331000');
    expect(() => cityTaxCode('633100')).toThrow(RangeError);
  });
});
