import { describe, expect, it } from 'vitest';
import {
  isPeriod,
  nextPeriod,
  normalizeTaxId,
  periodDays,
  periodMonth,
  periodOf,
  periodOfDate,
  periodYear,
  previousPeriod,
  splitRegisters,
} from './index';

describe('periods', () => {
  it('holds a month in one number', () => {
    expect(periodOf(2026, 10)).toBe(202610);
    expect(periodYear(202512)).toBe(2025);
    expect(periodMonth(202512)).toBe(12);
  });

  it('refuses what is not a month', () => {
    expect(isPeriod(202600)).toBe(false);
    expect(isPeriod(202613)).toBe(false);
    expect(isPeriod(199912)).toBe(false);
    expect(isPeriod(202606.5)).toBe(false);
    expect(isPeriod(202606)).toBe(true);
  });

  it('turns the year', () => {
    expect(nextPeriod(202512)).toBe(202601);
    expect(previousPeriod(202601)).toBe(202512);
    expect(nextPeriod(202606)).toBe(202607);
  });

  it('knows a month’s days, February too', () => {
    expect(periodDays(202602)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodDays(202802)).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodDays(202612)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('reads a date’s period', () => {
    expect(periodOfDate('2026-10-08')).toBe(202610);
    expect(periodOfDate('08/10/2026')).toBeNull();
    expect(periodOfDate('2026-13-01')).toBeNull();
  });
});

describe('taxpayer numbers', () => {
  it('compares as the file and a typed register do', () => {
    expect(normalizeTaxId('71000.0')).toBe('71000');
    expect(normalizeTaxId(' 011 ')).toBe('11');
    expect(normalizeTaxId(7100010)).toBe('7100010');
    expect(normalizeTaxId('аа12345678')).toBe('АА12345678');
    expect(normalizeTaxId(null)).toBe('');
    // Latin look-alikes and spaces make no other number.
    expect(normalizeTaxId('AA12345678')).toBe('АА12345678');
    expect(normalizeTaxId('АА 12345678')).toBe('АА12345678');
  });

  it('splits every way the registers were typed', () => {
    expect(splitRegisters('7100001;7100002')).toEqual(['7100001', '7100002']);
    expect(splitRegisters('7100003 .7100004')).toEqual(['7100003', '7100004']);
    expect(splitRegisters('7100005, 7100006')).toEqual(['7100005', '7100006']);
    expect(splitRegisters('7100007/7100008')).toEqual(['7100007', '7100008']);
  });

  it('drops the empty, a bare zero and repeats', () => {
    expect(splitRegisters('АА 12345678; 7100001')).toEqual(['АА12345678', '7100001']);
    expect(splitRegisters('aa 12345678')).toEqual(['АА12345678']);
    expect(splitRegisters('')).toEqual([]);
    expect(splitRegisters(null)).toEqual([]);
    expect(splitRegisters('0')).toEqual([]);
    expect(splitRegisters('7100009;7100009')).toEqual(['7100009']);
  });
});
