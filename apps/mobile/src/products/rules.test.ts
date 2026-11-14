import type { components } from '@tugeel/api-client';
import { SKU_PATTERN as SHARED_SKU, WEIGHT_PATTERN as SHARED_WEIGHT } from '@tugeel/shared/catalog';
import { gtinCheckDigit } from '@tugeel/shared/gtin';
import { FACTOR_PATTERN as SHARED_FACTOR } from '@tugeel/shared/units';
import { describe, expect, it } from 'vitest';
import {
  bodyOf,
  categoryOptions,
  emptyForm,
  FACTOR_PATTERN,
  filledBy,
  type FormPicture,
  hasProblems,
  isTyped,
  pictureFailureOf,
  problemsOf,
  type ProductForm,
  type Proposal,
  SKU_PATTERN,
  WEIGHT_PATTERN,
  withBarcode,
  withoutBarcode,
  withProposal,
} from './rules';

type Schemas = components['schemas'];
const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;

const UOMS: Schemas['Uom'][] = [
  { id: 1, code: 'PCS', name: 'ш', fractional: false, measureUnit: null },
  { id: 2, code: 'BLOCK', name: 'блок', fractional: false, measureUnit: null },
  { id: 3, code: 'BOX', name: 'хайрцаг', fractional: false, measureUnit: null },
  { id: 4, code: 'KG', name: 'кг', fractional: true, measureUnit: null },
];
const PICTURE: FormPicture = { imageFileId: 71, thumbFileId: 72, uri: 'data:', made: true };
const EMPTY = emptyForm({ categoryId: null, supplier: null, homeWarehouseId: null, baseUomId: 1 });
const FULL: ProductForm = {
  ...EMPTY,
  categoryId: 13,
  sku: '10024',
  name: ' Цэвэр ус 0.5л ',
  boxFactor: '12',
  supplier: { id: 9, name: 'МСМ ХХК' },
  homeWarehouseId: 4,
};
const piece = ean('865000100001');
const taken = ean('865000100009');
const PROPOSAL: Proposal = {
  name: 'Цэвэр ус 0.5л',
  categoryId: 13,
  categoryPath: 'Ундаа / Ус',
  baseUomId: 1,
  boxFactor: '12',
  weightKg: '0.5',
  baseBarcodes: [piece, taken],
  boxBarcodes: [],
  units: [{ uomId: 2, factorToBase: '6', barcodes: [] }],
  supplier: { id: 9, code: 'S0009', name: 'МСМ ХХК' },
  frontPhoto: 1,
  frontPhotoFileId: 502,
  productBox: null,
  droppedBarcodes: 0,
  existing: [{ code: taken, productId: 77, sku: '900', name: 'Хуучин ус 1л' }],
  note: '',
};

describe('the phone’s registration form (ADR-0199)', () => {
  it('keeps the shapes of the shared rules', () => {
    expect(SKU_PATTERN.source).toBe(SHARED_SKU.source);
    expect(WEIGHT_PATTERN.source).toBe(SHARED_WEIGHT.source);
    expect(FACTOR_PATTERN.source).toBe(SHARED_FACTOR.source);
  });

  it('fills what a reading proposed and leaves a registered barcode out', () => {
    const filled = withProposal({ ...EMPTY, sku: '777' }, PROPOSAL, UOMS);
    expect(filled).toMatchObject({
      categoryId: 13,
      sku: '', // the new category suggests its own code
      name: 'Цэвэр ус 0.5л',
      baseUomId: 1,
      boxFactor: '12',
      weightKg: '0.5',
      baseBarcodes: [piece],
      blockFactor: '6',
      supplier: { id: 9, name: 'МСМ ХХК' },
    });
    expect(filledBy(PROPOSAL)).toEqual([
      'category',
      'name',
      'unit',
      'box',
      'weight',
      'barcode',
      'units',
      'supplier',
    ]);
  });

  it('keeps what the form had where the reading proposed nothing', () => {
    const before: ProductForm = { ...FULL, baseBarcodes: [piece], weightKg: '1.2' };
    const nothing: Proposal = {
      ...PROPOSAL,
      name: null,
      categoryId: null,
      baseUomId: null,
      boxFactor: null,
      weightKg: null,
      baseBarcodes: [],
      units: [],
      supplier: null,
      existing: [],
    };
    expect(withProposal(before, nothing, UOMS)).toEqual(before);
    expect(filledBy(nothing)).toEqual([]);
    // The same category keeps the code it already suggested.
    expect(withProposal(before, { ...nothing, categoryId: 13 }, UOMS).sku).toBe('10024');
  });

  it('adds a scanned barcode once across the units', () => {
    const first = withBarcode(EMPTY, 'baseBarcodes', ` ${piece} `);
    if (!first.ok) throw new Error('the barcode was expected to be taken');
    expect(first.form.baseBarcodes).toEqual([piece]);
    expect(withBarcode(first.form, 'boxBarcodes', piece)).toEqual({
      ok: false,
      reason: 'repeated',
    });
    expect(withBarcode(EMPTY, 'baseBarcodes', '')).toEqual({ ok: false, reason: 'invalid' });
    expect(withoutBarcode(first.form, 'baseBarcodes', piece).baseBarcodes).toEqual([]);
  });

  it('says what the save still needs', () => {
    expect(problemsOf(EMPTY, UOMS, null)).toEqual({
      category: 'required',
      sku: 'required',
      name: 'required',
      boxFactor: 'required',
      supplier: 'required',
      warehouse: 'required',
      picture: 'required',
    });
    expect(hasProblems(problemsOf(FULL, UOMS, PICTURE))).toBe(false);
    const of = (patch: Partial<ProductForm>) => problemsOf({ ...FULL, ...patch }, UOMS, PICTURE);
    expect(of({ sku: 'A12' })).toEqual({ sku: 'sku' });
    expect(of({ name: 'Н'.repeat(201) })).toEqual({ name: 'tooLong' });
    expect(of({ boxFactor: '2.5' })).toEqual({ boxFactor: 'factor' }); // pieces are whole
    expect(of({ boxFactor: '2,5', baseUomId: 4 })).toEqual({}); // kilograms are not
    expect(of({ baseUomId: 3 })).toEqual({ baseUnit: 'required' }); // never the box
    expect(of({ weightKg: '0' })).toEqual({ weight: 'weight' });
    expect(of({ weightKg: '0,111' })).toEqual({});
    expect(of({ blockFactor: '6' })).toEqual({});
    expect(of({ blockFactor: '6', baseUomId: 2 })).toEqual({ blockFactor: 'blockUnit' });
    expect(of({ blockFactor: 'зургаа' })).toEqual({ blockFactor: 'factor' });
  });

  it('builds the registration’s body as the web does', () => {
    const form: ProductForm = {
      ...FULL,
      weightKg: '0,5',
      baseBarcodes: [piece],
      blockFactor: ' 6 ',
      blockBarcodes: [],
    };
    expect(bodyOf(form, UOMS, PICTURE)).toEqual({
      sku: '10024',
      name: 'Цэвэр ус 0.5л',
      categoryId: 13,
      baseUomId: 1,
      weightKg: '0.5',
      baseBarcodes: [piece],
      boxFactor: '12',
      boxBarcodes: [],
      units: [{ uomId: 2, factorToBase: '6', barcodes: [] }],
      supplierId: 9,
      homeWarehouseId: 4,
      fixedBinCode: null,
      images: [{ imageFileId: 71, thumbFileId: 72 }],
    });
    expect(bodyOf(FULL, UOMS, PICTURE).units).toEqual([]);
    expect(() => bodyOf(EMPTY, UOMS, PICTURE)).toThrow();
  });

  it('knows when leaving would lose something', () => {
    expect(isTyped(EMPTY, null)).toBe(false);
    // The category, supplier and warehouse stay from the product before: not typed for this one.
    expect(isTyped({ ...EMPTY, categoryId: 13, homeWarehouseId: 4 }, null)).toBe(false);
    expect(isTyped({ ...EMPTY, name: 'Ус' }, null)).toBe(true);
    expect(isTyped(EMPTY, PICTURE)).toBe(true);
  });

  it('lists the categories with their paths, parents before children', () => {
    const category = (id: number, name: string, parentId: number | null) =>
      ({ id, name, parentId }) as Schemas['Category'];
    expect(
      categoryOptions([
        category(13, 'Ус', 12),
        category(20, 'Бусад', null),
        category(12, 'Ундаа', null),
        category(14, 'Жүүс', 12),
      ]),
    ).toEqual([
      { id: 20, path: 'Бусад' },
      { id: 12, path: 'Ундаа' },
      { id: 14, path: 'Ундаа / Жүүс' },
      { id: 13, path: 'Ундаа / Ус' },
    ]);
  });

  it('explains a picture kept as taken by the service’s code', () => {
    const of = (reason: string, status: number | null, providerCode: string | null = null) =>
      pictureFailureOf({ reason, status, providerCode });
    expect(of('HTTP', 402)).toBe('credit');
    expect(of('HTTP', 400, 'insufficient_credits')).toBe('credit');
    expect(of('HTTP', 403, 'auth_failed')).toBe('badKey');
    expect(of('HTTP', 429)).toBe('rateLimit');
    expect(of('TIMEOUT', null)).toBe('timeout');
    expect(of('EMPTY', null)).toBe('empty');
    expect(of('HTTP', 500)).toBe('other');
  });
});
