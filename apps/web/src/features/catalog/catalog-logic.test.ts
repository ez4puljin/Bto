import { describe, expect, it } from 'vitest';
import type { Category, Uom } from './api';
import { categoryPaths, categoryTree, subtreeIds } from './category-tree';
import { type PendingPhoto, photosMessage } from './photo-uploads';
import { productSchema } from './product-schema';
import { emptyRegistration, registrationBody, registrationSchema } from './registration-schema';

const category = (id: number, name: string, parentId: number | null = null): Category => ({
  id,
  parentId,
  name,
  defaultClassificationCode: null,
  skuFrom: null,
  skuTo: null,
  productCount: 0,
  childCount: 0,
  imageUrl: null,
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
  { id: 2, code: 'BLOCK', name: 'блок', fractional: false, measureUnit: null },
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

describe('registration form schema', () => {
  const sticky = {
    categoryId: '3',
    supplier: { id: 9, code: 'S0009', name: 'МСМ ХХК' },
    homeWarehouseId: '2',
    baseUomId: '1',
  };
  const valid = {
    ...emptyRegistration(sticky),
    sku: '10024',
    name: 'Кока кола 0.5 л',
    boxFactor: '24',
    baseBarcodes: ['4870001000011'],
    units: [{ uomId: '2', factorToBase: '6', barcodes: [] }],
    fixedBinCode: 'A-01-03',
  };
  const messages = (values: unknown) => {
    const result = registrationSchema(UOMS).safeParse(values);
    return result.success
      ? []
      : result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  };
  const photo = (key: string, status: PendingPhoto['status'], ids: [number, number] | null) => ({
    key,
    preview: `blob:${key}`,
    status,
    files: ids ? { imageFileId: ids[0], thumbFileId: ids[1] } : null,
  });

  it('accepts a registration and maps it to the API body with the uploaded photos', () => {
    expect(messages(valid)).toEqual([]);
    const photos = [
      photo('a', 'ready', [11, 12]),
      photo('b', 'failed', null),
      photo('c', 'ready', [13, 14]),
    ];
    expect(registrationBody(valid, photos)).toEqual({
      sku: '10024',
      name: 'Кока кола 0.5 л',
      categoryId: 3,
      baseUomId: 1,
      weightKg: null,
      baseBarcodes: ['4870001000011'],
      boxFactor: '24',
      boxBarcodes: [],
      units: [{ uomId: 2, factorToBase: '6', barcodes: [] }],
      supplierId: 9,
      homeWarehouseId: 2,
      fixedBinCode: 'A-01-03',
      images: [
        { imageFileId: 11, thumbFileId: 12 },
        { imageFileId: 13, thumbFileId: 14 },
      ],
    });
    expect(registrationBody({ ...valid, fixedBinCode: '' }, photos).fixedBinCode).toBeNull();
  });

  it('wants whole factors for piece products and allows grams for kilogram products', () => {
    expect(messages({ ...valid, boxFactor: '2.5' })).toEqual([['boxFactor', 'validation.factor']]);
    expect(messages({ ...valid, boxFactor: '2.5', baseUomId: '4' })).toEqual([]);
    const grams = {
      ...valid,
      baseUomId: '4',
      units: [{ uomId: '2', factorToBase: '0.0005', barcodes: [] }],
    };
    expect(messages(grams)).toEqual([['units.0.factorToBase', 'validation.factor']]);
    expect(messages({ ...valid, boxFactor: '' })).toEqual([['boxFactor', 'validation.factor']]);
  });

  it('needs a category, a supplier and a home, and refuses a unit twice and a zero weight', () => {
    expect(
      messages({ ...valid, categoryId: '', supplier: null, homeWarehouseId: '' }).sort(),
    ).toEqual([
      ['categoryId', 'validation.required'],
      ['homeWarehouseId', 'validation.required'],
      ['supplier', 'validation.required'],
    ]);
    expect(
      messages({ ...valid, units: [{ uomId: '1', factorToBase: '6', barcodes: [] }] }),
    ).toEqual([['units.0.uomId', 'validation.unitRepeated']]);
    expect(messages({ ...valid, sku: 'A1', weightKg: '0' }).sort()).toEqual([
      ['sku', 'validation.sku'],
      ['weightKg', 'validation.weight'],
    ]);
  });

  it('keeps the category, supplier, home and base unit for the next product', () => {
    expect(emptyRegistration(sticky)).toEqual({
      ...sticky,
      sku: '',
      name: '',
      boxFactor: '',
      weightKg: '',
      baseBarcodes: [],
      boxBarcodes: [],
      units: [],
      fixedBinCode: '',
    });
  });

  it('wants one uploaded photo and every upload finished', () => {
    expect(photosMessage([])).toBe('validation.photoRequired');
    expect(photosMessage([photo('a', 'failed', null)])).toBe('validation.photoRequired');
    expect(photosMessage([photo('a', 'ready', [1, 2]), photo('b', 'uploading', null)])).toBe(
      'validation.photosUploading',
    );
    expect(photosMessage([photo('a', 'ready', [1, 2])])).toBeNull();
  });
});

describe('product card schema', () => {
  it('checks the code, the name and the weight', () => {
    const result = productSchema.safeParse({
      sku: 'A1',
      name: '',
      categoryId: '3',
      weightKg: '0',
      status: 'ACTIVE',
    });
    expect(
      result.success ? [] : result.error.issues.map((issue) => issue.path.join('.')).sort(),
    ).toEqual(['name', 'sku', 'weightKg']);
  });
});
