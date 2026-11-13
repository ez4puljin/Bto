import { describe, expect, it } from 'vitest';
import {
  isPeriodPreset,
  isReportViewPage,
  isViewQuery,
  openViewQuery,
  presetOf,
  presetRange,
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
