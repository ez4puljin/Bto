import { describe, expect, it } from 'vitest';
import { maskDate } from './mask';

describe('the date mask', () => {
  it('adds the dashes while the digits are typed', () => {
    expect(maskDate('')).toBe('');
    expect(maskDate('2')).toBe('2');
    expect(maskDate('2026')).toBe('2026');
    expect(maskDate('20261')).toBe('2026-1');
    expect(maskDate('202611')).toBe('2026-11');
    expect(maskDate('2026110')).toBe('2026-11-0');
    expect(maskDate('20261107')).toBe('2026-11-07');
  });

  it('takes what the field already shows, keeps eight digits and drops anything else', () => {
    expect(maskDate('2026-11-07')).toBe('2026-11-07');
    expect(maskDate('2026-11-')).toBe('2026-11');
    expect(maskDate('2026/11/07')).toBe('2026-11-07');
    expect(maskDate('20261107999')).toBe('2026-11-07');
    expect(maskDate('abc')).toBe('');
  });
});
