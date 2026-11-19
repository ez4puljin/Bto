import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  fallbackSimilar,
  kindWords,
  likenessOf,
  packSizeOf,
  prefilterSimilar,
  sameSizeOf,
  searchWordsOf,
  SIMILAR_MAX_CANDIDATES,
  type SimilarCandidate,
} from './index';

const product = (
  id: number,
  name: string,
  categoryId = 1,
  weightKg: string | null = null,
): SimilarCandidate => ({ id, name, categoryId, weightKg });

describe('similar products, the pre-filter (ADR-0231)', () => {
  it('reads a pack size from a name in either script, with a comma or a space', () => {
    expect(packSizeOf('Лапша Ролтон 3кг')).toEqual({ measure: 'MASS', amount: new Decimal(3000) });
    expect(packSizeOf('Гурил 500 гр')?.amount.toFixed()).toBe('500');
    expect(packSizeOf('Ус 0,5л')).toEqual({ measure: 'VOLUME', amount: new Decimal(500) });
    expect(packSizeOf('Coca-Cola 330ml')?.amount.toFixed()).toBe('330');
    expect(packSizeOf('Rice 3KG')?.amount.toFixed()).toBe('3000');
    expect(packSizeOf('Шүдэнз')).toBeNull();
  });

  it('keeps the words that say the kind, without sizes, and searches the long ones', () => {
    expect(kindWords('Лапша Ролтон 3кг')).toEqual(['лапша', 'ролтон']);
    expect(searchWordsOf('Лапша Ролтон 3 кг')).toEqual(['лапша', 'ролтон']);
    expect(likenessOf(['лапша'], ['лапша'])).toBe(1);
    expect(likenessOf(['лапша'], ['будаа'])).toBe(0);
  });

  it('compares sizes by the name, else by the weight within 5 %', () => {
    const source = product(1, 'Лапша Ролтон 3кг');
    expect(sameSizeOf(source, product(2, 'Лапша Доширак 3 кг'))).toBe(true);
    expect(sameSizeOf(source, product(3, 'Лапша Доширак 1кг'))).toBe(false);
    expect(sameSizeOf(source, product(4, 'Лапша Мивина', 1, '2.95'))).toBe(true);
    expect(sameSizeOf(source, product(5, 'Лапша Мивина', 1, '2.5'))).toBe(false);
    expect(sameSizeOf(source, product(6, 'Лапша Мивина'))).toBeNull();
  });

  it('keeps every noodle of 3 kg, drops other sizes, other kinds and the source itself', () => {
    const source = product(1, 'Лапша Ролтон 3кг', 7, '3');
    const ranked = prefilterSimilar(source, [
      product(1, 'Лапша Ролтон 3кг', 7, '3'),
      product(2, 'Лапша Доширак 3кг', 7),
      product(3, 'Лапша Доширак 1кг', 7),
      product(4, 'Будаа Тайланд 3кг', 7),
      product(5, 'Lapsha Big Bon 3 кг', 9),
      product(6, 'Лапша гэрийн', 7),
      product(2, 'Лапша Доширак 3кг', 7),
    ]);
    expect(ranked.map((entry) => entry.product.id)).toEqual([2, 6]);
    expect(ranked[0]).toMatchObject({ sameKind: true, sameSize: true, sameCategory: true });
    // Of unknown size: shown to the model, but not the answer without it.
    expect(ranked[1]).toMatchObject({ sameSize: null });
    expect(fallbackSimilar(source, ranked).map((row) => row.id)).toEqual([2]);
  });

  it('answers by kind alone when the source has no size', () => {
    const source = product(1, 'Лапша гэрийн', 7);
    const ranked = prefilterSimilar(source, [
      product(2, 'Лапша Доширак 3кг', 7),
      product(3, 'Будаа Тайланд', 7),
    ]);
    expect(fallbackSimilar(source, ranked).map((row) => row.id)).toEqual([2]);
  });

  it('shows the model at most SIMILAR_MAX_CANDIDATES, those of the same size first', () => {
    const source = product(1, 'Лапша 3кг', 7);
    const many = Array.from({ length: 50 }, (_, at) =>
      product(at + 2, at % 2 ? `Лапша ${at} 3кг` : `Лапша ${at}`, 7),
    );
    const ranked = prefilterSimilar(source, many);
    expect(ranked).toHaveLength(SIMILAR_MAX_CANDIDATES);
    expect(ranked.slice(0, 25).every((entry) => entry.sameSize === true)).toBe(true);
  });
});
