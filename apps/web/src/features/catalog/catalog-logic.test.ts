import { describe, expect, it } from 'vitest';
import type { Category, Uom } from './api';
import { categoryPaths, categoryTree, subtreeIds } from './category-tree';
import { createBody, emptyProduct, productSchema } from './product-schema';

const category = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  parentId,
  name,
  defaultClassificationCode: null,
  productCount: 0,
  childCount: 0,
});
const CATEGORIES = [
  category(3, 'Ундаа'),
  category(1, 'Хүнс'),
  category(5, 'Гурил', 1),
  category(4, 'Будаа', 1),
  category(6, 'Цагаан будаа', 4),
];
const UOMS: Uom[] = [
  { id: 1, code: 'PCS', name: 'ш', fractional: false, measureUnit: null },
  { id: 3, code: 'BOX', name: 'хайрцаг', fractional: false, measureUnit: null },
  { id: 4, code: 'KG', name: 'кг', fractional: true, measureUnit: null },
];

describe('category tree', () => {
  it('orders categories depth-first with siblings by name and full paths', () => {
    expect(categoryTree(CATEGORIES).map((node) => [node.depth, node.path])).toEqual([
      [0, 'Ундаа'],
      [0, 'Хүнс'],
      [1, 'Хүнс / Будаа'],
      [2, 'Хүнс / Будаа / Цагаан будаа'],
      [1, 'Хүнс / Гурил'],
    ]);
    expect(categoryPaths(CATEGORIES).get(6)).toBe('Хүнс / Будаа / Цагаан будаа');
  });

  it('collects a category with everything below it', () => {
    expect([...subtreeIds(CATEGORIES, 1)].sort()).toEqual([1, 4, 5, 6]);
    expect([...subtreeIds(CATEGORIES, 5)]).toEqual([5]);
  });
});

describe('product form schema', () => {
  const valid = {
    ...emptyProduct('10024', '1'),
    name: 'Кока кола 0.5 л',
    categoryId: '3',
    units: [
      {
        uomId: '3',
        factorToBase: '24',
        isDefaultSales: true,
        isDefaultPurchase: true,
        barcodes: [],
      },
    ],
  };
  const messages = (values: unknown, mode: 'create' | 'edit' = 'create') => {
    const result = productSchema(mode, UOMS).safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };

  it('accepts a product with a box unit and maps it to the API body', () => {
    expect(messages(valid)).toEqual([]);
    expect(createBody(valid)).toEqual({
      sku: '10024',
      name: 'Кока кола 0.5 л',
      categoryId: 3,
      vatType: 'VAT_ABLE',
      cityTax: null,
      classificationCode: null,
      taxProductCode: null,
      weightKg: null,
      baseUomId: 1,
      baseBarcodes: [],
      units: [
        {
          uomId: 3,
          factorToBase: '24',
          isDefaultSales: true,
          isDefaultPurchase: true,
          barcodes: [],
        },
      ],
    });
  });

  it('wants whole factors for piece products and allows grams for kilogram products', () => {
    const half = { ...valid, units: [{ ...valid.units[0], factorToBase: '2.5' }] };
    expect(messages(half)).toEqual([['units.0.factorToBase', 'validation.factor']]);
    expect(messages({ ...half, baseUomId: '4' })).toEqual([]);
    const grams = {
      ...half,
      baseUomId: '4',
      units: [{ ...valid.units[0], factorToBase: '0.0005' }],
    };
    expect(messages(grams)).toEqual([['units.0.factorToBase', 'validation.factor']]);
    const garbage = { ...valid, units: [{ ...valid.units[0], factorToBase: 'abc' }] };
    expect(messages(garbage)).toEqual([['units.0.factorToBase', 'validation.factor']]);
  });

  it('refuses a unit of measure twice, bad codes and a zero weight', () => {
    expect(messages({ ...valid, units: [{ ...valid.units[0], uomId: '1' }] })).toEqual([
      ['units.0.uomId', 'validation.unitRepeated'],
    ]);
    expect(
      messages({ ...valid, sku: 'A1', classificationCode: '123', weightKg: '0' }).sort(),
    ).toEqual([
      ['classificationCode', 'validation.classificationCode'],
      ['sku', 'validation.sku'],
      ['weightKg', 'validation.weight'],
    ]);
  });

  it('ignores the unit fields when editing', () => {
    expect(messages({ ...valid, baseUomId: '', units: [] }, 'edit')).toEqual([]);
  });
});
