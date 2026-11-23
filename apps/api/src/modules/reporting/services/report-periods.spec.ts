import {
  boardPeriods,
  boardTrend,
  checkedRange,
  daysIn,
  monthEnd,
  monthPeriods,
  trailingMonths,
} from './report-periods';

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

describe('profit board periods (ADR-0237)', () => {
  it('compares a running quarter with the same days of the quarter before and a year earlier', () => {
    expect(boardPeriods('quarter', '2026-Q4', '2026-11-23')).toEqual({
      kind: 'quarter',
      period: '2026-Q4',
      running: true,
      current: { from: '2026-10-01', to: '2026-11-23' },
      previous: { from: '2026-07-01', to: '2026-08-23' },
      lastYear: { from: '2025-10-01', to: '2025-11-23' },
    });
  });

  it('compares a running month as the dashboard does and a running year by the same days', () => {
    const month = boardPeriods('month', '2026-10', '2026-10-24');
    const dashboard = monthPeriods('2026-10', '2026-10-24');
    expect([month.current, month.previous, month.lastYear]).toEqual([
      dashboard.current,
      dashboard.previous,
      dashboard.lastYear,
    ]);
    expect(boardPeriods('year', '2026', '2026-11-23')).toMatchObject({
      current: { from: '2026-01-01', to: '2026-11-23' },
      previous: { from: '2025-01-01', to: '2025-11-23' },
      lastYear: { from: '2025-01-01', to: '2025-11-23' },
    });
  });

  it('compares whole periods once a period has ended, and refuses a later one or a bad key', () => {
    expect(boardPeriods('quarter', '2026-Q1', '2026-11-23')).toMatchObject({
      running: false,
      current: { from: '2026-01-01', to: '2026-03-31' },
      previous: { from: '2025-10-01', to: '2025-12-31' },
      lastYear: { from: '2025-01-01', to: '2025-03-31' },
    });
    expect(() => boardPeriods('quarter', '2027-Q1', '2026-11-23')).toThrow();
    expect(() => boardPeriods('year', '2027', '2026-11-23')).toThrow();
    expect(() => boardPeriods('month', '2026-Q1', '2026-11-23')).toThrow();
  });

  it('draws 12 months, 8 quarters or 5 years, the running one to today', () => {
    const months = boardTrend('month', '2026-11', '2026-11-23');
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({
      period: '2025-12',
      range: { from: '2025-12-01', to: '2025-12-31' },
    });
    expect(months[11]).toEqual({
      period: '2026-11',
      range: { from: '2026-11-01', to: '2026-11-23' },
    });
    const quarters = boardTrend('quarter', '2026-Q4', '2026-11-23');
    expect(quarters.map((point) => point.period)).toEqual([
      '2025-Q1',
      '2025-Q2',
      '2025-Q3',
      '2025-Q4',
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
    ]);
    expect(boardTrend('year', '2024', '2026-11-23').map((point) => point.period)).toEqual([
      '2020',
      '2021',
      '2022',
      '2023',
      '2024',
    ]);
  });
});
