import { describe, expect, it } from 'vitest';
import { addMoney, amount, categoryOptions, quantity, sidesOf } from './book-format';
import { stockDocHref } from './book-links';

describe('the paper of the ledger reports (ADR-0133)', () => {
  it('writes amounts at the chosen precision, rounding half up without floats', () => {
    expect(amount('42000.00', '2')).toBe('42,000.00');
    expect(amount('1234567.005', '2')).toBe('1,234,567.01');
    expect(amount('-1234.5', '0')).toBe('-1,235');
    expect(amount('0.004', '2')).toBe('');
    expect(amount('0.00', '2', '0')).toBe('0');
    expect(amount(null, '2')).toBe('—');
  });

  it('writes quantities without trailing zeros, blank for zero', () => {
    expect(quantity('12000.000')).toBe('12,000');
    expect(quantity('2.500')).toBe('2.5');
    expect(quantity('-3')).toBe('-3');
    expect(quantity('0')).toBe('');
  });

  it('sums amounts in cents and splits a balance into debit and credit', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('-42000.00', '1000.5')).toBe('-40999.50');
    expect(addMoney(null, '1')).toBeNull();
    expect(sidesOf('-42000.00')).toEqual({ debit: '0', credit: '42000.00' });
    expect(sidesOf('15.00')).toEqual({ debit: '15.00', credit: '0' });
  });

  it('names categories by their path', () => {
    const options = categoryOptions([
      { id: 1, code: null, name: 'Хүнс', parentId: null },
      { id: 2, code: null, name: 'Амттан', parentId: 1 },
    ]);
    expect(options.map((option) => option.label)).toEqual(['Хүнс', 'Хүнс / Амттан']);
  });

  it('opens each stock document on its own page', () => {
    expect(stockDocHref('GR', 3)).toBe('/inventory/receipts/3');
    expect(stockDocHref('POS', 1)).toBe('/pos/sales?sale=1');
    expect(stockDocHref('CN', 5, 9)).toBe('/finance/invoices?invoice=9');
    expect(stockDocHref('CN', 5)).toBeNull();
  });
});
