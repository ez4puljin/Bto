import { erkhetCodeFree, nextCodeOf, packQtyOf, uomOf, weightOf } from './erkhet-new-product';

// Synthetic values in the shape of Erkhet's item list; no row here is the company's.

describe('A product added from Erkhet (ADR-0222)', () => {
  it('reads the box from «Задрах харьцаа» either way round', () => {
    expect(packQtyOf('0.0833333333333')?.toFixed()).toBe('12');
    expect(packQtyOf('0.08333333333329999')?.toFixed()).toBe('12');
    expect(packQtyOf('0.0416666666667')?.toFixed()).toBe('24');
    expect(packQtyOf('24')?.toFixed()).toBe('24');
    // No box: none, one, a count that is not whole, nothing.
    expect(packQtyOf(null)).toBeNull();
    expect(packQtyOf('1')).toBeNull();
    expect(packQtyOf('0.990099009901')).toBeNull();
    expect(packQtyOf('0.14')).toBeNull();
    expect(packQtyOf('0')).toBeNull();
  });

  it('keeps a weight above nothing, to four places', () => {
    expect(weightOf('0.5')?.toFixed()).toBe('0.5');
    expect(weightOf('1.012345')?.toFixed()).toBe('1.0123');
    expect(weightOf('0')).toBeNull();
    expect(weightOf('0.00001')).toBeNull();
    expect(weightOf(null)).toBeNull();
  });

  it("finds Bto's unit by Erkhet's unit name or code", () => {
    const uoms = [
      { id: 1, code: 'PCS', nameKey: 'ш' },
      { id: 2, code: 'BOX', nameKey: 'хайрцаг' },
      { id: 3, code: 'KG', nameKey: 'кг' },
    ];
    expect(uomOf(uoms, 'ш', 'ширхэг')?.id).toBe(1);
    expect(uomOf(uoms, 'ха', 'Хайрцаг')?.id).toBe(2);
    expect(uomOf(uoms, 'кг', 'Килограмм')?.id).toBe(3);
    expect(uomOf(uoms, 'гр', 'грамм')).toBeNull();
    expect(uomOf(uoms, null, null)).toBeNull();
  });

  it("takes Erkhet's code only when it is digits and free", () => {
    const taken = new Set([100001n]);
    expect(erkhetCodeFree('100002', taken)).toBe(true);
    expect(erkhetCodeFree('100001', taken)).toBe(false);
    expect(erkhetCodeFree('0100001', taken)).toBe(false);
    expect(erkhetCodeFree('AB-12', taken)).toBe(false);
  });

  it("gives the next free code of the category's range, skipping a subcategory's block", () => {
    const categories = [
      { id: 1, parentId: null, name: 'Ундаа', skuFrom: '200000', skuTo: '299999' },
      { id: 2, parentId: 1, name: 'Ус', skuFrom: '210000', skuTo: '219999' },
      { id: 3, parentId: 1, name: 'Шүүс', skuFrom: null, skuTo: null },
      { id: 4, parentId: null, name: 'Бусад', skuFrom: null, skuTo: null },
    ];
    expect(nextCodeOf(categories, 1, new Set())).toBe('200000');
    expect(nextCodeOf(categories, 3, new Set([200000n, 209999n, 215000n]))).toBe('220000');
    expect(nextCodeOf(categories, 2, new Set([215000n]))).toBe('215001');
    // Without a range: past the largest code outside every range.
    expect(nextCodeOf(categories, 4, new Set([5n, 250000n]))).toBe('6');
    // The end of the range reached: the lowest free code.
    expect(nextCodeOf(categories, 2, new Set([210000n, 219999n]))).toBe('210001');
  });
});
