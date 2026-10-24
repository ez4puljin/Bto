import { checkedRange, daysIn, monthEnd, monthPeriods, trailingMonths } from './report-periods';

describe('report periods (ADR-0108 #11)', () => {
  it('compares a running month with the same days a month and a year earlier', () => {
    expect(monthPeriods('2026-10', '2026-10-24')).toEqual({
      month: '2026-10',
      running: true,
      current: { from: '2026-10-01', to: '2026-10-24' },
      previous: { from: '2026-09-01', to: '2026-09-24' },
      lastYear: { from: '2025-10-01', to: '2025-10-24' },
    });
  });

  it('cuts the same days at a shorter month’s end', () => {
    const periods = monthPeriods('2026-03', '2026-03-31');
    expect(periods.previous).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthPeriods('2028-03', '2028-03-30').previous.to).toBe('2028-02-29');
  });

  it('compares whole months once a month has ended, and refuses a future month', () => {
    expect(monthPeriods('2026-09', '2026-10-24')).toMatchObject({
      running: false,
      current: { from: '2026-09-01', to: '2026-09-30' },
      previous: { from: '2026-08-01', to: '2026-08-31' },
      lastYear: { from: '2025-09-01', to: '2025-09-30' },
    });
    expect(() => monthPeriods('2026-11', '2026-10-24')).toThrow();
    expect(() => monthPeriods('2026-13', '2026-10-24')).toThrow();
  });

  it('lists the twelve months ending with a month, and counts days', () => {
    expect(trailingMonths('2026-02')).toEqual([
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
    expect(monthEnd('2026-02-10')).toBe('2026-02-28');
    expect(daysIn({ from: '2026-10-01', to: '2026-10-24' })).toBe(24);
    expect(() => checkedRange('2026-10-02', '2026-10-01')).toThrow();
    expect(() => checkedRange('2020-01-01', '2026-01-01')).toThrow();
    expect(checkedRange('2026-10-01', '2026-10-31')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
  });
});
