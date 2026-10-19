import { describe, expect, it } from 'vitest';
import { dateLineOf, givenNameOf, newProductsOf } from './home';

describe('givenNameOf', () => {
  it('takes the last word: the given name follows the family name', () => {
    expect(givenNameOf('Туршилтын Төлөөлөгч')).toBe('Төлөөлөгч');
    expect(givenNameOf('  Бат   Болд ')).toBe('Болд');
  });

  it('keeps a one-word name and gives nothing for an empty one', () => {
    expect(givenNameOf('Болд')).toBe('Болд');
    expect(givenNameOf('   ')).toBe('');
  });
});

describe('dateLineOf', () => {
  it('gives the weekday, the month and the day without leading zeros', () => {
    expect(dateLineOf('2026-10-16')).toEqual({ weekday: 5, month: 10, day: 16 });
    expect(dateLineOf('2026-03-01')).toEqual({ weekday: 0, month: 3, day: 1 });
  });
});

describe('newProductsOf', () => {
  it('keeps the new ones in order, at most the given count', () => {
    const products = [
      { id: 1, isNew: true },
      { id: 2, isNew: false },
      { id: 3, isNew: true },
      { id: 4, isNew: true },
    ];
    expect(newProductsOf(products).map((product) => product.id)).toEqual([1, 3, 4]);
    expect(newProductsOf(products, 2).map((product) => product.id)).toEqual([1, 3]);
  });
});
