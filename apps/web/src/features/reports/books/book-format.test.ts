import { describe, expect, it } from 'vitest';
import {
  addMoney,
  amount,
  categoryOptions,
  COL,
  isZero,
  MINUS,
  paperRem,
  periodText,
  presetRange,
  quantity,
  sidesOf,
  tableMinRem,
  textColumn,
} from './book-format';
import { stockDocHref } from './book-links';

describe('the paper of the ledger reports (ADR-0133)', () => {
  it('writes amounts at the chosen precision, rounding half up without floats', () => {
    expect(amount('42000.00', '2')).toBe('42,000.00');
    expect(amount('1234567.005', '2')).toBe('1,234,567.01');
    expect(amount('-1234.5', '0')).toBe(`${MINUS}1,235`);
    expect(amount('0.004', '2')).toBe('');
    expect(amount('0.00', '2', '0')).toBe('0');
    expect(amount(null, '2')).toBe('—');
  });

  it('writes a real minus, never a hyphen', () => {
    expect(MINUS).toBe('−');
    expect(amount('-4727.27', '2')).toBe('−4,727.27');
    expect(quantity('-1')).toBe('−1');
  });

  it('writes quantities without trailing zeros, blank for zero unless asked', () => {
    expect(quantity('12000.000')).toBe('12,000');
    expect(quantity('2.500')).toBe('2.5');
    expect(quantity('-3')).toBe(`${MINUS}3`);
    expect(quantity('0')).toBe('');
    expect(quantity('0.000', '0')).toBe('0');
    expect(isZero('-0.00')).toBe(true);
    expect(isZero('0.01')).toBe(false);
  });

  it('writes a period with an en dash and offers the usual periods', () => {
    expect(periodText('2026-10-01', '2026-11-01')).toBe('2026-10-01 – 2026-11-01');
    expect(presetRange('thisMonth', '2026-11-02')).toEqual({
      from: '2026-11-01',
      to: '2026-11-02',
    });
    expect(presetRange('lastMonth', '2026-03-15')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(presetRange('lastMonth', '2026-01-10')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('thisQuarter', '2026-11-02')).toEqual({
      from: '2026-10-01',
      to: '2026-11-02',
    });
    expect(presetRange('thisYear', '2026-11-02')).toEqual({ from: '2026-01-01', to: '2026-11-02' });
  });

  it('sizes the paper from its columns, narrower below 1600px', () => {
    const columns = [COL.code, textColumn(16), COL.money, COL.money];
    expect(tableMinRem(columns)).toBe(6 + 12 + 15);
    expect(tableMinRem(columns, true)).toBe(5.75 + 12 + 13);
    expect(paperRem(columns)).toBe(6 + 16 + 15 + 4);
    expect(paperRem(columns, true)).toBe(5.75 + 16 + 13 + 2);
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
