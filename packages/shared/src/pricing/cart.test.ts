import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  type PricedLine,
  type QuoteContext,
  type QuoteLineInput,
  type QuoteProduct,
  type QuoteResult,
  type QuoteTerms,
  type QuoteUnit,
  resolveQuote,
  splitWholesale,
  unitPriceTable,
} from './cart';
import type { PriceList, QuoteProgram } from './discounts';
import type { PriceProfileValues } from './profile';

const d = (value: string | number) => new Decimal(value);

// Units of measure, categories (Ундаа 100 with Шүүс 101 below it; Хүнс 200) and products.
const PCS = 1;
const BOX = 2;
const KG = 3;
const BAG = 4;
const PACK = 5;
const BLOCK = 6;
const RETIRED = 99;
const DRINKS = new Set([100, 101]);

const unit = (unitId: number, uomId: number, factor: string, isBase = false): QuoteUnit => ({
  unitId,
  uomId,
  factor: d(factor),
  isBase,
});
const COLA = 1;
const SPRITE = 2;
const JUICE = 3;
const TOBACCO = 4;
const SNACK = 5;
const RICE = 6;
const WATER = 7;
const colaPcs = unit(11, PCS, '1', true);
const colaBox = unit(12, BOX, '20');
const spritePcs = unit(21, PCS, '1', true);
const spriteBox = unit(22, BOX, '24');
const juicePcs = unit(31, PCS, '1', true);
const juiceBox = unit(32, BOX, '12');
const tobaccoPcs = unit(41, PCS, '1', true);
const tobaccoBlock = unit(42, BLOCK, '10');
const tobaccoBox = unit(43, BOX, '20');
const snackPcs = unit(51, PCS, '1', true);
const snackBlock = unit(52, BLOCK, '10');
const snackBox = unit(53, BOX, '24');
const riceKg = unit(61, KG, '1', true);
const riceBag = unit(62, BAG, '25');
const ricePack = unit(63, PACK, '1.5');
const waterPcs = unit(71, PCS, '1', true);

/** Loose +15 %, supermarket +30 %, from 24 pieces +20 %, whole tugriks. */
const PROFILE: PriceProfileValues = {
  looseMarkupPct: d(15),
  retailMarkupPct: d(30),
  retailBulkMinQty: d(24),
  retailBulkMarkupPct: d(20),
  rounding: 'WHOLE',
};
const terms = (
  warehousePrice: string | number,
  wholeUomId: number | null,
  profile: Partial<PriceProfileValues> = {},
): QuoteTerms => ({
  warehousePrice: d(warehousePrice),
  wholeUomId,
  profile: { ...PROFILE, ...profile },
});

const PRODUCTS: [number, QuoteProduct][] = [
  [COLA, { categoryId: 100, units: [colaPcs, colaBox], terms: terms(1000, BOX) }],
  [SPRITE, { categoryId: 100, units: [spritePcs, spriteBox], terms: terms(1000, BOX) }],
  [JUICE, { categoryId: 101, units: [juicePcs, juiceBox], terms: terms(500, BOX) }],
  [
    TOBACCO,
    { categoryId: 200, units: [tobaccoPcs, tobaccoBlock, tobaccoBox], terms: terms(500, BOX) },
  ],
  [SNACK, { categoryId: 200, units: [snackPcs, snackBlock, snackBox], terms: terms(500, BLOCK) }],
  [RICE, { categoryId: 200, units: [riceKg, riceBag, ricePack], terms: terms(3333, BAG) }],
  [WATER, { categoryId: 100, units: [waterPcs], terms: terms(800, null) }],
];

const context = (
  programs: QuoteProgram[] = [],
  list: PriceList = 'WHOLESALE',
  changes: [number, Partial<QuoteProduct>][] = [],
): QuoteContext => {
  const products = new Map(PRODUCTS);
  for (const [id, change] of changes) {
    const product = products.get(id);
    if (product) products.set(id, { ...product, ...change });
  }
  return { list, products, programs };
};

const line = (productId: number, of: QuoteUnit, qty: string | number): QuoteLineInput => ({
  productId,
  unitId: of.unitId,
  qty: d(qty),
  qtyBase: d(qty).times(of.factor),
});

const steps = (...pairs: [string | number, string | number][]) =>
  pairs.map(([threshold, value]) => ({ threshold: d(threshold), value: d(value) }));

const program = (
  fields: Pick<QuoteProgram, 'id' | 'scope' | 'effect' | 'steps'> & Partial<QuoteProgram>,
): QuoteProgram => ({
  name: `P${fields.id}`,
  measure: fields.scope === 'PRODUCT' ? 'QTY' : 'AMOUNT',
  productId: null,
  productUnitId: null,
  categoryIds: null,
  countUomId: null,
  ...fields,
});

const priced = (result: QuoteResult, index: number): PricedLine => {
  const found = result.lines[index];
  if (!found?.priced) throw new Error(`line ${index} is not priced`);
  return found;
};
/** A line's parts as "qty×unitId basis listPrice→unitPrice = total". */
const partsOf = (result: QuoteResult, index: number) =>
  priced(result, index).parts.map(
    (part) =>
      `${part.qty.toFixed()}×${part.unitId} ${part.basis} ${part.listPrice.toFixed()}→${part.unitPrice.toFixed()} = ${part.total.toFixed()}`,
  );
const split = (of: QuoteUnit, qty: string | number, whole: QuoteUnit | null, base: QuoteUnit) =>
  splitWholesale({ unit: of, qty: d(qty), qtyBase: d(qty).times(of.factor) }, whole, base).map(
    (part) => `${part.qty.toFixed()}×${part.unitId} ${part.basis}`,
  );

describe('whole packs and loose pieces', () => {
  it('splits 25 pieces of a box of 20 into 1 box and 5 loose pieces', () => {
    expect(split(colaPcs, 25, colaBox, colaPcs)).toEqual(['1×12 WAREHOUSE', '5×11 LOOSE']);
  });

  it('keeps whole packs whole: in boxes as typed, or pieces counted as boxes', () => {
    expect(split(colaBox, 2, colaBox, colaPcs)).toEqual(['2×12 WAREHOUSE']);
    expect(split(colaPcs, 40, colaBox, colaPcs)).toEqual(['2×12 WAREHOUSE']);
  });

  it('charges less than a pack as loose, in the unit typed', () => {
    expect(split(colaPcs, 5, colaBox, colaPcs)).toEqual(['5×11 LOOSE']);
  });

  it('puts the rest in the unit typed when it divides, else in base units', () => {
    expect(split(colaBox, '1.5', colaBox, colaPcs)).toEqual(['1×12 WAREHOUSE', '10×11 LOOSE']);
    expect(split(tobaccoBlock, 3, tobaccoBox, tobaccoPcs)).toEqual([
      '1×43 WAREHOUSE',
      '1×42 LOOSE',
    ]);
    expect(split(snackBox, 1, snackBlock, snackPcs)).toEqual(['2×52 WAREHOUSE', '4×51 LOOSE']);
  });

  it('counts a bigger unit made of whole packs as whole', () => {
    expect(split(tobaccoBox, 1, tobaccoBlock, tobaccoPcs)).toEqual(['1×43 WAREHOUSE']);
  });

  it('charges everything at the warehouse price without a whole unit', () => {
    expect(split(colaPcs, 25, null, colaPcs)).toEqual(['25×11 WAREHOUSE']);
  });

  it('splits weighed goods too', () => {
    expect(split(riceKg, '2.5', riceBag, riceKg)).toEqual(['2.5×61 LOOSE']);
    expect(split(ricePack, 3, riceBag, riceKg)).toEqual(['3×63 LOOSE']);
    expect(split(riceBag, 2, riceBag, riceKg)).toEqual(['2×62 WAREHOUSE']);
    expect(split(riceKg, 30, riceBag, riceKg)).toEqual(['1×62 WAREHOUSE', '5×61 LOOSE']);
  });
});

describe('wholesale quotes', () => {
  it('prices the owner’s example: 1 box at the warehouse price, 5 pieces loose', () => {
    const result = resolveQuote([line(COLA, colaPcs, 25)], context());
    expect(partsOf(result, 0)).toEqual([
      '1×12 WAREHOUSE 20000→20000 = 20000',
      '5×11 LOOSE 1150→1150 = 5750',
    ]);
    expect(priced(result, 0).total.toFixed()).toBe('25750');
    expect(result.total.toFixed()).toBe('25750');
  });

  it('prices a product without packs at the warehouse price', () => {
    const result = resolveQuote([line(WATER, waterPcs, 7)], context());
    expect(partsOf(result, 0)).toEqual(['7×71 WAREHOUSE 800→800 = 5600']);
  });

  it('prices everything at the warehouse price when the whole unit is gone', () => {
    const result = resolveQuote(
      [line(COLA, colaPcs, 25)],
      context([], 'WHOLESALE', [[COLA, { terms: terms(1000, RETIRED) }]]),
    );
    expect(partsOf(result, 0)).toEqual(['25×11 WAREHOUSE 1000→1000 = 25000']);
  });

  it('rounds the loose price as the profile says', () => {
    const result = resolveQuote(
      [line(COLA, colaPcs, 5)],
      context([], 'WHOLESALE', [
        [COLA, { terms: terms(1010, BOX, { looseMarkupPct: d(5), rounding: 'UP_50' }) }],
      ]),
    );
    expect(partsOf(result, 0)).toEqual(['5×11 LOOSE 1100→1100 = 5500']);
  });

  it('marks a line without price terms, whose quantity still counts', () => {
    const boxes = program({
      id: 1,
      scope: 'CATEGORY',
      measure: 'QTY',
      effect: 'PERCENT',
      categoryIds: DRINKS,
      countUomId: BOX,
      steps: steps([3, 10]),
    });
    const result = resolveQuote(
      [line(COLA, colaPcs, 40), line(JUICE, juiceBox, 1)],
      context([boxes], 'WHOLESALE', [[COLA, { terms: null }]]),
    );
    expect(result.lines[0]).toEqual({ priced: false, problem: 'PRICE_MISSING' });
    expect(priced(result, 1).total.toFixed()).toBe('5400');
    expect(result.total.toFixed()).toBe('5400');
  });
});

describe('the product’s programs on parts', () => {
  it('gives a box price only to the whole boxes of a line in pieces', () => {
    const boxPrice = program({
      id: 1,
      scope: 'PRODUCT',
      effect: 'PRICE',
      productId: COLA,
      productUnitId: colaBox.unitId,
      steps: steps([240, 18000]),
    });
    const result = resolveQuote([line(COLA, colaPcs, 245)], context([boxPrice]));
    expect(partsOf(result, 0)).toEqual([
      '12×12 WAREHOUSE 20000→18000 = 216000',
      '5×11 LOOSE 1150→1150 = 5750',
    ]);
  });

  it('takes a percentage without a unit off every part', () => {
    const tenPercent = program({
      id: 1,
      scope: 'PRODUCT',
      effect: 'PERCENT',
      productId: COLA,
      steps: steps([0, 10]),
    });
    const result = resolveQuote([line(COLA, colaPcs, 25)], context([tenPercent]));
    expect(partsOf(result, 0)).toEqual([
      '1×12 WAREHOUSE 20000→18000 = 18000',
      '5×11 LOOSE 1150→1035 = 5175',
    ]);
  });

  it('takes tugriks per unit only off the parts in that unit', () => {
    const offPieces = program({
      id: 1,
      scope: 'PRODUCT',
      effect: 'AMOUNT',
      productId: COLA,
      productUnitId: colaPcs.unitId,
      steps: steps([0, 500]),
    });
    const result = resolveQuote([line(COLA, colaPcs, 25)], context([offPieces]));
    expect(partsOf(result, 0)).toEqual([
      '1×12 WAREHOUSE 20000→20000 = 20000',
      '5×11 LOOSE 1150→650 = 3250',
    ]);
  });
});

describe('category and order programs on parts', () => {
  it('splits an order amount over every part in proportion, to the tugrik', () => {
    const order = program({ id: 1, scope: 'ORDER', effect: 'AMOUNT', steps: steps([0, 1000]) });
    const result = resolveQuote(
      [line(COLA, colaPcs, 25), line(WATER, waterPcs, 7)],
      context([order]),
    );
    expect(partsOf(result, 0)).toEqual([
      '1×12 WAREHOUSE 20000→20000 = 19362',
      '5×11 LOOSE 1150→1150 = 5567',
    ]);
    expect(priced(result, 0).discountAmount.toFixed()).toBe('821');
    expect(partsOf(result, 1)).toEqual(['7×71 WAREHOUSE 800→800 = 5421']);
    expect(result.discountTotal.toFixed()).toBe('1000');
    expect(result.total.toFixed()).toBe('30350');
  });

  it('stacks every stage in order: the owner’s example of 2026-10-13 on the new prices', () => {
    const boxPrice = program({
      id: 1,
      scope: 'PRODUCT',
      effect: 'PRICE',
      productId: SPRITE,
      productUnitId: spriteBox.unitId,
      steps: steps([240, 22800]),
    });
    const drinks = program({
      id: 2,
      scope: 'CATEGORY',
      measure: 'QTY',
      effect: 'PERCENT',
      categoryIds: DRINKS,
      countUomId: BOX,
      steps: steps([50, 2]),
    });
    const order = program({
      id: 3,
      scope: 'ORDER',
      effect: 'PERCENT',
      steps: steps([1000000, 1]),
    });
    const programs = [boxPrice, drinks, order];
    const result = resolveQuote([line(SPRITE, spriteBox, 50)], context(programs));
    expect(partsOf(result, 0)).toEqual(['50×22 WAREHOUSE 24000→22800 = 1106028']);
    expect(result.total.toFixed()).toBe('1106028');
    expect(result.discountTotal.toFixed()).toBe('33972');
    // The programs' order of arrival changes nothing.
    const reversed = resolveQuote([line(SPRITE, spriteBox, 50)], context([...programs].reverse()));
    expect(reversed.total.toFixed()).toBe('1106028');
  });
});

describe('supermarket quotes', () => {
  it('charges the supermarket price below the threshold, counted over the whole cart', () => {
    const result = resolveQuote(
      [line(COLA, colaPcs, 10), line(COLA, colaPcs, 13)],
      context([], 'RETAIL'),
    );
    expect(partsOf(result, 0)).toEqual(['10×11 RETAIL 1300→1300 = 13000']);
    expect(partsOf(result, 1)).toEqual(['13×11 RETAIL 1300→1300 = 16900']);
  });

  it('charges the bulk price once the cart holds the threshold, over two lines', () => {
    const result = resolveQuote(
      [line(COLA, colaPcs, 10), line(COLA, colaPcs, 14)],
      context([], 'RETAIL'),
    );
    expect(partsOf(result, 0)).toEqual(['10×11 RETAIL_BULK 1200→1200 = 12000']);
    expect(partsOf(result, 1)).toEqual(['14×11 RETAIL_BULK 1200→1200 = 16800']);
  });

  it('never splits packs at the supermarket', () => {
    const result = resolveQuote([line(COLA, colaBox, 1)], context([], 'RETAIL'));
    expect(partsOf(result, 0)).toEqual(['1×12 RETAIL 26000→26000 = 26000']);
  });

  it('has only the supermarket price without a bulk threshold', () => {
    const result = resolveQuote(
      [line(COLA, colaPcs, 100)],
      context([], 'RETAIL', [
        [COLA, { terms: terms(1000, BOX, { retailBulkMinQty: null, retailBulkMarkupPct: null }) }],
      ]),
    );
    expect(partsOf(result, 0)).toEqual(['100×11 RETAIL 1300→1300 = 130000']);
  });
});

describe('the price table of a product', () => {
  it('shows each unit on both channels', () => {
    const rows = unitPriceTable(terms(1000, BOX), [colaPcs, colaBox]).map((row) => [
      row.unitId,
      row.wholesale.toFixed(),
      row.wholesaleBasis,
      row.retail.toFixed(),
      row.retailBulk?.toFixed() ?? null,
    ]);
    expect(rows).toEqual([
      [11, '1150', 'LOOSE', '1300', '1200'],
      [12, '20000', 'WAREHOUSE', '26000', '24000'],
    ]);
  });

  it('marks a unit that is not a whole number of packs', () => {
    const rows = unitPriceTable(terms(500, BLOCK), [snackPcs, snackBlock, snackBox]);
    expect(rows.map((row) => [row.unitId, row.wholesale.toFixed(), row.wholesaleBasis])).toEqual([
      [51, '575', 'LOOSE'],
      [52, '5000', 'WAREHOUSE'],
      [53, '12300', 'MIXED'],
    ]);
  });
});

describe('the till coupons (ADR-0110)', () => {
  it('takes coupons off after the order programs, each on what the earlier ones left', () => {
    const order = program({ id: 1, scope: 'ORDER', effect: 'AMOUNT', steps: steps([0, 1000]) });
    const result = resolveQuote([line(COLA, colaPcs, 25), line(WATER, waterPcs, 7)], {
      ...context([order]),
      coupons: [
        { code: '9910000000000001', name: 'Арав', effect: 'PERCENT', value: d(10) },
        { code: '9910000000000002', name: 'Мянга', effect: 'AMOUNT', value: d(1000) },
      ],
    });
    // 30,350 after the order program; 10 % per part (3,035), then 1,000 split by amount.
    expect(result.discountTotal.toFixed()).toBe('5035');
    expect(result.total.toFixed()).toBe('26315');
    const codes = priced(result, 1).parts[0]?.applied.map((entry) => entry.code ?? null);
    expect(codes).toEqual([null, '9910000000000001', '9910000000000002']);
  });

  it('never takes more than the cart comes to', () => {
    const result = resolveQuote([line(WATER, waterPcs, 2)], {
      ...context(),
      coupons: [{ code: '9910000000000003', name: 'Их', effect: 'AMOUNT', value: d(5000) }],
    });
    expect(result.total.toFixed()).toBe('0');
    expect(result.discountTotal.toFixed()).toBe('1600');
  });
});
