import { describe, expect, it } from 'vitest';
import type { Me } from '../api/session';
import { isZero, mayScoreKpi, monthParts, parseScore, percentText, salaryFraction } from './logic';

const person = (permissions: string[]) => ({ permissions }) as unknown as Me;

describe('payroll on the phone', () => {
  it('lets only a scorer or a payroll manager score', () => {
    expect(mayScoreKpi(person([]))).toBe(false);
    expect(mayScoreKpi(person(['hr.payroll.view']))).toBe(false);
    expect(mayScoreKpi(person(['hr.payroll.score']))).toBe(true);
    expect(mayScoreKpi(person(['hr.payroll.manage']))).toBe(true);
  });

  it('reads a month', () => {
    expect(monthParts('2026-11')).toEqual({ year: '2026', month: 11 });
    expect(monthParts('2026-02')).toEqual({ year: '2026', month: 2 });
  });

  it('shows percents without trailing zeros', () => {
    expect(percentText('86.90')).toBe('86.9');
    expect(percentText('100.00')).toBe('100');
    expect(percentText(null)).toBeNull();
  });

  it('parses a typed score', () => {
    expect(parseScore('')).toEqual({ ok: true, value: null });
    expect(parseScore(' 87,5 ')).toEqual({ ok: true, value: '87.5' });
    expect(parseScore('100')).toEqual({ ok: true, value: '100' });
    for (const text of ['100.5', '101', '-1', 'abc'])
      expect(parseScore(text)).toEqual({ ok: false });
  });

  it('knows a zero amount', () => {
    expect(isZero('0.00')).toBe(true);
    expect(isZero('12.00')).toBe(false);
  });

  it('shows the salary’s workdays only when the month was split', () => {
    expect(salaryFraction({ salaryDays: 11, salaryMonthDays: 22 })).toEqual({
      days: 11,
      total: 22,
    });
    expect(salaryFraction({ salaryDays: 22, salaryMonthDays: 22 })).toBeNull();
    expect(salaryFraction({ salaryDays: null, salaryMonthDays: null })).toBeNull();
  });
});
