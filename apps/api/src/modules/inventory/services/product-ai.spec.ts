import { gtinCheckDigit } from '@tugeel/shared/gtin';
import {
  PRODUCT_READ_INSTRUCTIONS,
  PRODUCT_READ_SCHEMA,
  type ProductReadAnswer,
  ProductReadAnswer as Answer,
  productReadData,
  type ProductReadLists,
  proposalOf,
} from './product-ai';

const ean = (body: string) => `${body}${gtinCheckDigit(body)}`;

const LISTS: ProductReadLists = {
  categories: [
    { id: 12, path: 'Ундаа' },
    { id: 13, path: 'Ундаа / Ус' },
  ],
  uoms: [
    { id: 1, code: 'PCS', name: 'ш', fractional: false },
    { id: 2, code: 'BLOCK', name: 'блок', fractional: false },
    { id: 3, code: 'BOX', name: 'хайрцаг', fractional: false },
    { id: 4, code: 'KG', name: 'кг', fractional: true },
  ],
  suppliers: [{ id: 9, code: 'S0009', name: 'МСМ ХХК' }],
};

const answer = (patch: Partial<ProductReadAnswer> = {}): ProductReadAnswer => ({
  name: 'Цэвэр ус 0.5л',
  categoryId: 13,
  baseUnitId: 1,
  boxQuantity: '12',
  blockQuantity: null,
  weightKg: '0.5',
  pieceBarcodes: [ean('865000100001')],
  cartonBarcodes: [],
  blockBarcodes: [],
  supplierId: 9,
  frontPhoto: 2,
  productBox: { left: 200, top: 100, width: 500, height: 800 },
  note: '',
  ...patch,
});

describe('product reading: the answer as form values (ADR-0198)', () => {
  it('keeps what fits the catalogue', () => {
    expect(proposalOf(answer(), LISTS, 3)).toEqual({
      name: 'Цэвэр ус 0.5л',
      categoryId: 13,
      categoryPath: 'Ундаа / Ус',
      baseUomId: 1,
      boxFactor: '12',
      weightKg: '0.5',
      baseBarcodes: [ean('865000100001')],
      boxBarcodes: [],
      units: [],
      supplier: { id: 9, code: 'S0009', name: 'МСМ ХХК' },
      frontPhoto: 1,
      productBox: { left: 0.2, top: 0.1, width: 0.5, height: 0.8 },
      droppedBarcodes: 0,
      note: '',
    });
  });

  it('drops ids the lists do not hold, and never takes the box as the base unit', () => {
    const values = proposalOf(answer({ categoryId: 999, baseUnitId: 3, supplierId: 77 }), LISTS, 1);
    expect(values).toMatchObject({
      categoryId: null,
      categoryPath: null,
      baseUomId: null,
      supplier: null,
    });
  });

  it('takes a carton only when it converts exactly', () => {
    const of = (boxQuantity: string | null, baseUnitId = 1) =>
      proposalOf(answer({ boxQuantity, baseUnitId }), LISTS, 1).boxFactor;
    expect(of('24')).toBe('24');
    expect(of(' 24 ')).toBe('24');
    expect(of('2.5')).toBeNull(); // pieces do not come in halves
    expect(of('2.5', 4)).toBe('2.5'); // kilograms do
    expect(of('1')).toBeNull(); // a carton of one is no carton
    expect(of('0')).toBeNull();
    expect(of('24 ширхэг')).toBeNull();
    expect(of(null)).toBeNull();
  });

  it('adds a block with its barcodes when the catalogue has the unit', () => {
    const block = ean('865000100002');
    const values = proposalOf(answer({ blockQuantity: '6', blockBarcodes: [block] }), LISTS, 1);
    expect(values.units).toEqual([{ uomId: 2, factorToBase: '6', barcodes: [block] }]);
    const without = proposalOf(
      answer({ blockQuantity: '6' }),
      { ...LISTS, uoms: LISTS.uoms.filter((uom) => uom.code !== 'BLOCK') },
      1,
    );
    expect(without.units).toEqual([]);
  });

  it('keeps only barcodes with a valid check digit, each once', () => {
    const piece = ean('865000100001');
    const carton = `1${'865000100001'}`; // 13 digits, check digit not computed
    const values = proposalOf(
      answer({
        pieceBarcodes: [
          `${piece.slice(0, 1)} ${piece.slice(1, 7)} ${piece.slice(7)}`,
          '12345',
          piece,
        ],
        cartonBarcodes: [piece, carton.slice(0, 12) + '0', 'ABC-123'],
      }),
      LISTS,
      1,
    );
    expect(values.baseBarcodes).toEqual([piece]);
    // The piece's code is not repeated on the carton; the others are no valid GTIN.
    expect(values.boxBarcodes).toEqual([]);
    expect(values.droppedBarcodes).toBeGreaterThanOrEqual(2);
  });

  it('cuts the weight to the scale of the catalogue and refuses nonsense', () => {
    const of = (weightKg: string | null) => proposalOf(answer({ weightKg }), LISTS, 1).weightKg;
    expect(of('0.111')).toBe('0.111');
    expect(of('0,111')).toBe('0.111');
    expect(of('0.11149')).toBe('0.1115');
    expect(of('111 g')).toBeNull();
    expect(of('0')).toBeNull();
    expect(of('-1')).toBeNull();
  });

  it('falls back to the first photo and drops a place that is none', () => {
    expect(proposalOf(answer({ frontPhoto: 9 }), LISTS, 2).frontPhoto).toBe(0);
    expect(proposalOf(answer({ frontPhoto: 0 }), LISTS, 2).frontPhoto).toBe(0);
    expect(
      proposalOf(answer({ productBox: { left: 500, top: 500, width: 0, height: 300 } }), LISTS, 1)
        .productBox,
    ).toBeNull();
    expect(
      proposalOf(answer({ productBox: { left: 900, top: -50, width: 400, height: 300 } }), LISTS, 1)
        .productBox,
    ).toEqual({ left: 0.9, top: 0, width: 0.1, height: 0.25 });
  });

  it('trims the name and the note to what the form holds', () => {
    const values = proposalOf(
      answer({ name: `  ${'Н'.repeat(300)}  `, note: `а\n\nб ${'я'.repeat(900)}` }),
      LISTS,
      1,
    );
    expect(values.name).toHaveLength(200);
    expect(values.note.startsWith('а б ')).toBe(true);
    expect(values.note).toHaveLength(500);
    expect(proposalOf(answer({ name: '   ' }), LISTS, 1).name).toBeNull();
  });
});

describe('product reading: the request (ADR-0198)', () => {
  it('lists the catalogue for the model without codes it does not need', () => {
    const data = JSON.parse(productReadData(LISTS, ['Кока кола 500мл'])) as Record<string, unknown>;
    expect(data).toEqual({
      categories: LISTS.categories,
      units: LISTS.uoms.map(({ id, code, name }) => ({ id, code, name })),
      suppliers: [{ id: 9, name: 'МСМ ХХК' }],
      nameExamples: ['Кока кола 500мл'],
    });
  });

  it('names every field of the schema in the instructions, and the schema matches the parser', () => {
    for (const field of PRODUCT_READ_SCHEMA.schema.required) {
      expect(PRODUCT_READ_INSTRUCTIONS).toContain(field);
    }
    expect(Object.keys(PRODUCT_READ_SCHEMA.schema.properties).sort()).toEqual(
      Object.keys(Answer.shape).sort(),
    );
    expect(Answer.safeParse(answer()).success).toBe(true);
    expect(Answer.safeParse({ ...answer(), frontPhoto: 'first' }).success).toBe(false);
  });
});
