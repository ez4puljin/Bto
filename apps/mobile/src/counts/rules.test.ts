import { describe, expect, it } from 'vitest';
import { baseQtyOf, isPack, sameQty, totalAfter } from './rules';

describe('count rules', () => {
  it('turns a typed number into base units', () => {
    expect(baseQtyOf('2', '24.000000')).toBe('48');
    expect(baseQtyOf('0', '24')).toBe('0');
    expect(baseQtyOf('1.5', '1')).toBe('1.5');
    expect(baseQtyOf('', '24')).toBeNull();
    expect(baseQtyOf('1.', '24')).toBeNull();
  });

  it('adds a second count to the first: 10 then 2 is 12', () => {
    expect(totalAfter('10.000', '2')).toBe('12');
    expect(totalAfter('10.000', null)).toBe('10');
  });

  it('compares quantities as numbers', () => {
    expect(sameQty('12', '12.000')).toBe(true);
    expect(sameQty('12', '13')).toBe(false);
  });

  it('knows a pack from the base unit', () => {
    expect(isPack({ isBase: true, factorToBase: '1' })).toBe(false);
    expect(isPack({ isBase: false, factorToBase: '24.000000' })).toBe(true);
  });
});
