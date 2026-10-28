import { describe, expect, it } from 'vitest';
import { CODE128_PATTERNS, code128CModules, code128CSymbols } from './code128';

const widths = (pattern: string) => [...pattern].map((digit) => digit.charCodeAt(0) - 48);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe('Code 128, set C', () => {
  it('has 107 symbols of 11 modules, the stop 13', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.slice(0, 106).forEach((pattern) => {
      expect(pattern).toHaveLength(6);
      expect(sum(widths(pattern))).toBe(11);
    });
    expect(sum(widths(CODE128_PATTERNS[106] ?? ''))).toBe(13);
    // Every pattern is distinct, or a scanner could not tell two symbols apart.
    expect(new Set(CODE128_PATTERNS).size).toBe(107);
  });

  it('encodes "1234567890" with its checksum', () => {
    // Pairs 12 34 56 78 90; checksum = (105 + 1·12 + 2·34 + 3·56 + 4·78 + 5·90) mod 103
    // = (105 + 12 + 68 + 168 + 312 + 450) mod 103 = 1115 mod 103 = 1115 − 1030 = 85.
    expect(code128CSymbols('1234567890')).toEqual([105, 12, 34, 56, 78, 90, 85, 106]);
  });

  it('draws start C and the stop as the standard bar patterns', () => {
    const modules = code128CModules('1234567890');
    // 11 × (2 + 10 / 2) + 13 = 90 modules: start, 5 pairs and the checksum, then the stop.
    expect(sum(modules)).toBe(11 * (2 + 10 / 2) + 13);
    expect(modules).toHaveLength(7 * 6 + 7);
    const bits = (values: number[]) =>
      values.map((width, index) => (index % 2 === 0 ? '1' : '0').repeat(width)).join('');
    expect(bits(modules.slice(0, 6))).toBe('11010011100');
    expect(bits(modules.slice(-7))).toBe('1100011101011');
  });

  it('encodes a 16-digit voucher code in 123 modules', () => {
    // Start, 8 pairs, checksum: 10 symbols × 11, then the 13-module stop.
    expect(sum(code128CModules('9912345678901234'))).toBe(11 * (2 + 16 / 2) + 13);
    // (105 + 1·99 + 2·12 + 3·34 + 4·56 + 5·78 + 6·90 + 7·12 + 8·34) mod 103
    // = (105 + 99 + 24 + 102 + 224 + 390 + 540 + 84 + 272) mod 103 = 1840 mod 103
    // = 1840 − 1751 = 89.
    expect(code128CSymbols('9912345678901234').at(-2)).toBe(89);
  });

  it('refuses an odd length or anything but digits', () => {
    expect(() => code128CSymbols('123')).toThrow();
    expect(() => code128CSymbols('12a4')).toThrow();
    expect(() => code128CSymbols('')).toThrow();
  });
});
