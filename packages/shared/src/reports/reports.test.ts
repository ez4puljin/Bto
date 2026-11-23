import { describe, expect, it } from 'vitest';
import {
  boardPeriodEnd,
  boardPeriodOf,
  boardPeriodRange,
  boardPeriodStart,
  boardPosition,
  boardTrendLength,
  isBoardPeriodKey,
  isPeriodPreset,
  isReportViewPage,
  isViewQuery,
  lastYearBoardPeriod,
  openViewQuery,
  presetOf,
  presetRange,
  shiftBoardPeriod,
  storedViewQuery,
} from './index';

describe('report views', () => {
  it('knows its pages and presets', () => {
    expect(isReportViewPage('product-sales')).toBe(true);
    expect(isReportViewPage('dashboard')).toBe(false);
    expect(isReportViewPage('constructor')).toBe(false);
    expect(isPeriodPreset('lastMonth')).toBe(true);
    expect(isPeriodPreset('lastYear')).toBe(false);
    expect(isViewQuery('by=brand&cn=%D0%91%D0%B0%D1%82')).toBe(true);
    expect(isViewQuery('by=brand name')).toBe(false);
    expect(isViewQuery('x'.repeat(2001))).toBe(false);
  });

  it('works a preset out from today', () => {
    expect(presetRange('thisMonth', '2026-11-13')).toEqual({
      from: '2026-11-01',
      to: '2026-11-13',
    });
    expect(presetRange('lastMonth', '2026-11-13')).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(presetRange('lastMonth', '2026-01-05')).toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(presetRange('thisQuarter', '2026-11-13')).toEqual({
      from: '2026-10-01',
      to: '2026-11-13',
    });
    expect(presetRange('thisYear', '2026-11-13')).toEqual({ from: '2026-01-01', to: '2026-11-13' });
  });

  it('suggests the preset whose dates are on screen', () => {
    expect(presetOf('2026-11-01', '2026-11-13', '2026-11-13')).toBe('thisMonth');
    expect(presetOf('2026-10-01', '2026-10-31', '2026-11-13')).toBe('lastMonth');
    expect(presetOf('2026-10-05', '2026-10-31', '2026-11-13')).toBeNull();
  });

  it('keeps the address in a stable order, without the dates of a moving period', () => {
    expect(storedViewQuery('?to=2026-11-13&by=brand&from=2026-11-01&w=3&w=1', 'thisMonth')).toBe(
      'by=brand&w=3&w=1',
    );
    expect(storedViewQuery('to=2026-11-13&by=brand&from=2026-11-01', null)).toBe(
      'by=brand&from=2026-11-01&to=2026-11-13',
    );
  });

  it('opens a view with today’s dates of its period, or its own', () => {
    expect(openViewQuery({ query: 'by=brand&w=3', period: 'lastMonth' }, '2026-12-02')).toBe(
      'by=brand&from=2026-11-01&to=2026-11-30&w=3',
    );
    expect(
      openViewQuery(
        { query: 'by=brand&from=2026-01-01&to=2026-03-31', period: null },
        '2026-12-02',
      ),
    ).toBe('by=brand&from=2026-01-01&to=2026-03-31');
  });
});

describe('profit board periods (ADR-0237)', () => {
  it('reads and writes months, quarters and years', () => {
    expect(isBoardPeriodKey('month', '2026-11')).toBe(true);
    expect(isBoardPeriodKey('month', '2026-13')).toBe(false);
    expect(isBoardPeriodKey('quarter', '2026-Q4')).toBe(true);
    expect(isBoardPeriodKey('quarter', '2026-Q5')).toBe(false);
    expect(isBoardPeriodKey('year', '2026')).toBe(true);
    expect(isBoardPeriodKey('year', '2026-11')).toBe(false);
    expect(boardPeriodOf('quarter', '2026-11-23')).toBe('2026-Q4');
    expect(boardPeriodOf('quarter', '2026-03-31')).toBe('2026-Q1');
    expect(boardPeriodOf('year', '2026-11-23')).toBe('2026');
    expect([boardPeriodStart('quarter', '2026-Q3'), boardPeriodEnd('quarter', '2026-Q3')]).toEqual([
      '2026-07-01',
      '2026-09-30',
    ]);
    expect(boardPeriodEnd('month', '2028-02')).toBe('2028-02-29');
  });

  it('steps back and forth, and a year back', () => {
    expect(shiftBoardPeriod('month', '2026-01', -1)).toBe('2025-12');
    expect(shiftBoardPeriod('quarter', '2026-Q1', -1)).toBe('2025-Q4');
    expect(shiftBoardPeriod('quarter', '2025-Q4', 1)).toBe('2026-Q1');
    expect(shiftBoardPeriod('year', '2026', -4)).toBe('2022');
    expect(lastYearBoardPeriod('month', '2026-11')).toBe('2025-11');
    expect(lastYearBoardPeriod('quarter', '2026-Q4')).toBe('2025-Q4');
    expect(lastYearBoardPeriod('year', '2026')).toBe('2025');
    expect([
      boardTrendLength('month'),
      boardTrendLength('quarter'),
      boardTrendLength('year'),
    ]).toEqual([12, 8, 5]);
  });

  it('takes the same position in an earlier period while one runs', () => {
    const asOf = boardPosition('quarter', '2026-11-23');
    expect(asOf).toEqual({ monthOffset: 1, day: 23 });
    expect(boardPeriodRange('quarter', '2026-Q4', asOf)).toEqual({
      from: '2026-10-01',
      to: '2026-11-23',
    });
    expect(boardPeriodRange('quarter', '2026-Q3', asOf)).toEqual({
      from: '2026-07-01',
      to: '2026-08-23',
    });
    // 31 March in a running quarter: the same position in Q4 is 31 December, in Q3 30 September.
    const end = boardPosition('quarter', '2027-03-31');
    expect(boardPeriodRange('quarter', '2026-Q3', end)).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    });
    expect(boardPeriodRange('year', '2025', boardPosition('year', '2026-11-23'))).toEqual({
      from: '2025-01-01',
      to: '2025-11-23',
    });
    expect(boardPeriodRange('month', '2026-02', { monthOffset: 0, day: 30 })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    expect(boardPeriodRange('month', '2026-02', null)).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});
