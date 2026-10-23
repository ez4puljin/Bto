import { describe, expect, it } from 'vitest';
import { settlementDueDate, settlementPeriodOf, settlementSummary } from './index';

describe('settlement days (ADR-0101)', () => {
  it('DAY_20: the 21st to the 20th, due on the 20th', () => {
    expect(settlementPeriodOf('DAY_20', '2026-10-01')).toEqual({
      from: '2026-09-21',
      to: '2026-10-20',
      dueDate: '2026-10-20',
    });
    expect(settlementDueDate('DAY_20', '2026-10-20')).toBe('2026-10-20');
    expect(settlementPeriodOf('DAY_20', '2026-10-21')).toEqual({
      from: '2026-10-21',
      to: '2026-11-20',
      dueDate: '2026-11-20',
    });
    expect(settlementDueDate('DAY_20', '2026-10-31')).toBe('2026-11-20');
  });

  it('DAY_20 across the year and February', () => {
    expect(settlementPeriodOf('DAY_20', '2026-12-21')).toEqual({
      from: '2026-12-21',
      to: '2027-01-20',
      dueDate: '2027-01-20',
    });
    expect(settlementPeriodOf('DAY_20', '2027-01-05').from).toBe('2026-12-21');
    expect(settlementDueDate('DAY_20', '2027-01-31')).toBe('2027-02-20');
    expect(settlementPeriodOf('DAY_20', '2027-03-01').from).toBe('2027-02-21');
  });

  it('MONTH_END: the month, due on its last day (February and leap years)', () => {
    expect(settlementPeriodOf('MONTH_END', '2026-10-01')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      dueDate: '2026-10-31',
    });
    expect(settlementDueDate('MONTH_END', '2026-10-31')).toBe('2026-10-31');
    expect(settlementDueDate('MONTH_END', '2027-02-10')).toBe('2027-02-28');
    expect(settlementDueDate('MONTH_END', '2028-02-10')).toBe('2028-02-29');
    expect(settlementDueDate('MONTH_END', '2026-12-15')).toBe('2026-12-31');
  });

  it('a weekend moves nothing', () => {
    // 2026-12-20 is a Sunday, 2027-01-31 a Sunday.
    expect(settlementDueDate('DAY_20', '2026-12-01')).toBe('2026-12-20');
    expect(settlementDueDate('MONTH_END', '2027-01-03')).toBe('2027-01-31');
  });

  it('the summary: days left, the positive net, the overdue part within it', () => {
    const summary = settlementSummary('MONTH_END', '2026-10-21', {
      net: '1284600',
      overdue: '200000',
    });
    expect(summary).toMatchObject({
      group: 'MONTH_END',
      periodFrom: '2026-10-01',
      periodTo: '2026-10-31',
      dueDate: '2026-10-31',
      daysLeft: 10,
    });
    expect(summary.amountDue.toFixed(0)).toBe('1284600');
    expect(summary.overdueAmount.toFixed(0)).toBe('200000');
    expect(settlementSummary('DAY_20', '2026-10-20', { net: 0, overdue: 0 }).daysLeft).toBe(0);
    const advance = settlementSummary('DAY_20', '2026-10-25', { net: '-5000', overdue: '3000' });
    expect(advance.amountDue.toFixed(0)).toBe('0');
    expect(advance.overdueAmount.toFixed(0)).toBe('0');
    const netted = settlementSummary('DAY_20', '2026-10-25', { net: '2000', overdue: '3000' });
    expect(netted.overdueAmount.toFixed(0)).toBe('2000');
  });
});
