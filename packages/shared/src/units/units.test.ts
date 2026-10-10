import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  fromBase,
  InexactConversionError,
  isExactFactor,
  isValidEnteredQty,
  toBase,
} from './index';

describe('unit conversion (ADR-0008 #3)', () => {
  it('converts to base units exactly', () => {
    expect(toBase('3', '24').toString()).toBe('72');
    expect(toBase('0.5', '25').toString()).toBe('12.5');
    expect(toBase(new Decimal('12.345'), 1).toString()).toBe('12.345');
  });

  it('refuses conversions that would need rounding', () => {
    expect(() => toBase('0.001', '0.5')).toThrow(InexactConversionError);
    expect(() => toBase('1.25', '0.25')).toThrow(InexactConversionError);
  });

  it('accepts integer factors for pieces and up to three decimals for kg-based products', () => {
    expect(isExactFactor('24', false)).toBe(true);
    expect(isExactFactor('24.5', false)).toBe(false);
    expect(isExactFactor('0.25', true)).toBe(true);
    expect(isExactFactor('0.0005', true)).toBe(false);
    expect(isExactFactor('0', true)).toBe(false);
    expect(isExactFactor('-1', false)).toBe(false);
  });

  it('accepts whole pieces and fractional kilograms', () => {
    expect(isValidEnteredQty('2', '24', false)).toBe(true);
    expect(isValidEnteredQty('0.5', '24', false)).toBe(true);
    expect(isValidEnteredQty('0.1', '24', false)).toBe(false);
    expect(isValidEnteredQty('12.5', '1', true)).toBe(true);
    expect(isValidEnteredQty('0.5', '1', false)).toBe(false);
    expect(isValidEnteredQty('0', '1', true)).toBe(false);
  });

  it('shows base quantities in another unit, rounded for display', () => {
    expect(fromBase('30', '24').toString()).toBe('1.25');
    expect(fromBase('10', '3').toString()).toBe('3.333');
  });
});
