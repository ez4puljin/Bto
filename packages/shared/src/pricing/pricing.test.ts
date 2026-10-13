import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  allocate,
  type DiscountShape,
  discountShapeIssue,
  discountStepsIssue,
  type QuoteContext,
  type QuoteLineInput,
  type QuoteProgram,
  type QuoteResult,
  type QuoteUnit,
  reachedStep,
  resolveQuote,
} from './index';

const d = (value: string | number) => new Decimal(value);

// Units of measure, categories (Ундаа 100 with Шүүс 101 below it; Хүнс 200) and products.
const PCS = 1;
const BOX = 2;
const KG = 3;
const BAG = 4;
const PACK = 5;
const DRINKS = new Set([100, 101]);

const unit = (unitId: number, uomId: number, factor: string, isBase = false): QuoteUnit => ({
  unitId,
  uomId,
  factor: d(factor),
  isBase,
});
const COLA = 1;
const JUICE = 2;
const WATER = 3;
const RICE = 4;
const colaPcs = unit(11, PCS, '1', true);
const colaBox = unit(12, BOX, '24');
const juicePcs = unit(21, PCS, '1', true);
const juiceBox = unit(22, BOX, '12');
const waterPcs = unit(31, PCS, '1', true);
const riceKg = unit(41, KG, '1', true);
const riceBag = unit(42, BAG, '25');
const ricePack = unit(43, PACK, '1.5');

const products = new Map([
  [COLA, { categoryId: 100, units: [colaPcs, colaBox] }],
  [JUICE, { categoryId: 101, units: [juicePcs, juiceBox] }],
  [WATER, { categoryId: 100, units: [waterPcs] }],
  [RICE, { categoryId: 200, units: [riceKg, riceBag, ricePack] }],
]);

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

const context = (
  prices: [QuoteUnit, string | number][],
  programs: QuoteProgram[] = [],
): QuoteContext => ({
  products,
  prices: new Map(prices.map(([of, price]) => [of.unitId, d(price)])),
  programs,
});

/** The numbers of a quote as strings, for readable expectations. */
function summary(result: QuoteResult) {
  return {
    lines: result.lines.map((row) =>
      row.priced
        ? {
            list: row.listPrice.toString(),
            source: row.priceSource,
            unit: row.unitPrice.toString(),
            subtotal: row.subtotal.toString(),
            discount: row.discountAmount.toString(),
            total: row.total.toString(),
            applied: row.applied.map(
              (entry) =>
                `${entry.name}:${entry.value.toString()}${entry.amount ? `=${entry.amount.toString()}` : ''}`,
            ),
          }
        : row.problem,
    ),
    subtotal: result.subtotal.toString(),
    discount: result.discountTotal.toString(),
    total: result.total.toString(),
  };
}

const totals = (result: QuoteResult) =>
  summary(result).lines.map((row) => (typeof row === 'string' ? row : row.total));

describe('list prices', () => {
  it("takes the unit's own price, else the base unit's price times the factor, HALF_UP", () => {
    const prices = context([
      [colaPcs, 1_000],
      [colaBox, 22_800],
      [juicePcs, 1_235],
      [riceKg, 2_345],
    ]);
    const result = resolveQuote(
      [
        line(COLA, colaBox, 1),
        line(COLA, colaPcs, 3),
        line(JUICE, juiceBox, 2),
        line(RICE, riceBag, 1),
        line(RICE, ricePack, 1),
        line(RICE, riceKg, '0.4'),
      ],
      prices,
    );
    expect(summary(result).lines).toMatchObject([
      { list: '22800', source: 'UNIT', unit: '22800', subtotal: '22800' },
      { list: '1000', source: 'UNIT', subtotal: '3000' },
      { list: '14820', source: 'DERIVED', subtotal: '29640' },
      { list: '58625', source: 'DERIVED', subtotal: '58625' },
      // 2,345 × 1.5 = 3,517.5 → 3,518
      { list: '3518', source: 'DERIVED', subtotal: '3518' },
      // 2,345 × 0.4 kg = 938
      { list: '2345', source: 'UNIT', subtotal: '938' },
    ]);
    expect(summary(result).total).toBe('118521');
  });

  it('marks a line without any price, even when another unit of the product has one', () => {
    const result = resolveQuote(
      [line(COLA, colaPcs, 2), line(COLA, colaBox, 1), line(WATER, waterPcs, 5)],
      context([[colaBox, 22_800]]),
    );
    expect(summary(result)).toEqual({
      lines: ['PRICE_MISSING', expect.objectContaining({ total: '22800' }), 'PRICE_MISSING'],
      subtotal: '22800',
      discount: '0',
      total: '22800',
    });
  });
});

describe('product programs', () => {
  const boxBreak = program({
    id: 7,
    name: 'Бөөний',
    scope: 'PRODUCT',
    effect: 'PRICE',
    productId: COLA,
    productUnitId: colaBox.unitId,
    // 10 boxes (240 pieces) → 22,800; 20 boxes → 22,000
    steps: steps([240, 22_800], [480, 22_000]),
  });
  const prices = (programs: QuoteProgram[]) =>
    context(
      [
        [colaPcs, 1_000],
        [colaBox, 24_000],
      ],
      programs,
    );

  it('reaches a price step by the quantity of the product in the whole cart', () => {
    const at = (cart: QuoteLineInput[]) => summary(resolveQuote(cart, prices([boxBreak]))).lines;
    expect(at([line(COLA, colaBox, 9)])).toMatchObject([{ unit: '24000', applied: [] }]);
    expect(at([line(COLA, colaBox, 10)])).toMatchObject([
      { list: '24000', unit: '22800', applied: ['Бөөний:22800'] },
    ]);
    expect(at([line(COLA, colaBox, 20)])).toMatchObject([{ unit: '22000' }]);
    // 9 boxes and 24 pieces reach 240 pieces: the box line gets its price, pieces keep theirs.
    expect(at([line(COLA, colaBox, 9), line(COLA, colaPcs, 24)])).toMatchObject([
      { unit: '22800' },
      { unit: '1000', applied: [] },
    ]);
  });

  it('never raises a price', () => {
    const cheap = context([[colaBox, 22_000]], [boxBreak]);
    expect(summary(resolveQuote([line(COLA, colaBox, 10)], cheap)).lines).toMatchObject([
      { unit: '22000', applied: [] },
    ]);
  });

  it('applies the new price, then percentages, then tugriks per unit, before rounding once', () => {
    const promo = program({
      id: 1,
      name: 'Урамшуулал',
      scope: 'PRODUCT',
      effect: 'PERCENT',
      productId: COLA,
      steps: steps([0, 5]),
    });
    const perBox = program({
      id: 2,
      name: 'Хасалт',
      scope: 'PRODUCT',
      effect: 'AMOUNT',
      productId: COLA,
      productUnitId: colaBox.unitId,
      steps: steps([0, 500]),
    });
    const result = resolveQuote(
      [line(COLA, colaBox, 10), line(COLA, colaPcs, 3)],
      prices([perBox, promo, { ...boxBreak, id: 3 }]),
    );
    // 22,800 × 0.95 = 21,660 − 500 = 21,160 per box; pieces: 1,000 × 0.95 = 950.
    expect(summary(result).lines).toMatchObject([
      {
        unit: '21160',
        subtotal: '211600',
        applied: ['Бөөний:22800', 'Урамшуулал:5', 'Хасалт:500'],
      },
      { unit: '950', subtotal: '2850', applied: ['Урамшуулал:5'] },
    ]);
  });

  it('rounds the unit price HALF_UP and never takes it below zero', () => {
    const percent = program({
      id: 1,
      scope: 'PRODUCT',
      effect: 'PERCENT',
      productId: JUICE,
      steps: steps([0, 3]),
    });
    const tugriks = program({
      id: 2,
      scope: 'PRODUCT',
      effect: 'AMOUNT',
      productId: WATER,
      productUnitId: waterPcs.unitId,
      steps: steps([0, 500]),
    });
    const result = resolveQuote(
      [line(JUICE, juicePcs, 1), line(WATER, waterPcs, 2)],
      context(
        [
          [juicePcs, 1_235],
          [waterPcs, 300],
        ],
        [percent, tugriks],
      ),
    );
    // 1,235 × 0.97 = 1,197.95 → 1,198
    expect(totals(result)).toEqual(['1198', '0']);
  });
});

describe('category programs', () => {
  const drinksByBoxes = program({
    id: 5,
    name: 'Ундаа',
    scope: 'CATEGORY',
    measure: 'QTY',
    effect: 'PERCENT',
    categoryIds: DRINKS,
    countUomId: BOX,
    steps: steps([50, 2]),
  });
  const prices = (programs: QuoteProgram[]) =>
    context(
      [
        [colaPcs, 1_000],
        [colaBox, 24_000],
        [juicePcs, 1_000],
        [juiceBox, 12_000],
        [waterPcs, 500],
        [riceKg, 2_000],
      ],
      programs,
    );

  it('counts every box as one, pieces in boxes, below the category too', () => {
    const at = (cart: QuoteLineInput[]) => summary(resolveQuote(cart, prices([drinksByBoxes])));
    // 30 boxes of 24 and 20 boxes of 12 make 50 boxes.
    expect(
      at([line(COLA, colaBox, 30), line(JUICE, juiceBox, 20), line(RICE, riceKg, 10)]).lines,
    ).toMatchObject([
      { subtotal: '720000', discount: '14400', applied: ['Ундаа:2=14400'] },
      { subtotal: '240000', discount: '4800' },
      { subtotal: '20000', discount: '0', applied: [] },
    ]);
    expect(at([line(COLA, colaBox, 29), line(JUICE, juiceBox, 20)]).discount).toBe('0');
    // 24 pieces are one more box; water has no box unit, so its pieces do not count but it
    // still gets the category's discount.
    expect(
      at([
        line(COLA, colaBox, 29),
        line(COLA, colaPcs, 24),
        line(JUICE, juiceBox, 20),
        line(WATER, waterPcs, 100),
      ]).lines,
    ).toMatchObject([
      { discount: '13920' },
      { discount: '480' },
      { discount: '4800' },
      { subtotal: '50000', discount: '1000' },
    ]);
  });

  it('counts the quantity of a line without a price', () => {
    const tiny = { ...drinksByBoxes, steps: steps([2, 10]) };
    const result = resolveQuote(
      [line(COLA, colaBox, 1), line(JUICE, juiceBox, 1)],
      context([[colaBox, 24_000]], [tiny]),
    );
    expect(summary(result).lines).toEqual([
      expect.objectContaining({ discount: '2400' }),
      'PRICE_MISSING',
    ]);
  });

  it('measures an amount after the products’ own discounts', () => {
    const drinksByAmount = program({
      id: 6,
      name: 'Ундаа дүн',
      scope: 'CATEGORY',
      effect: 'PERCENT',
      categoryIds: DRINKS,
      steps: steps([240_000, 3]),
    });
    const boxBreak = program({
      id: 7,
      scope: 'PRODUCT',
      effect: 'PRICE',
      productId: COLA,
      productUnitId: colaBox.unitId,
      steps: steps([240, 23_000]),
    });
    // 10 boxes: 240,000 at the list price, 230,000 after the box price: below the threshold.
    const after = resolveQuote([line(COLA, colaBox, 10)], prices([drinksByAmount, boxBreak]));
    expect(summary(after).lines).toMatchObject([{ subtotal: '230000', discount: '0' }]);
    const without = resolveQuote([line(COLA, colaBox, 10)], prices([drinksByAmount]));
    expect(summary(without).lines).toMatchObject([{ subtotal: '240000', discount: '7200' }]);
  });

  it('applies percentages before amounts, each program measured on the same starting amounts', () => {
    const drinksAmount = program({
      id: 4,
      name: 'Ундаа хасалт',
      scope: 'CATEGORY',
      measure: 'QTY',
      effect: 'AMOUNT',
      categoryIds: DRINKS,
      countUomId: BOX,
      steps: steps([50, 10_000]),
    });
    const result = resolveQuote(
      [line(COLA, colaBox, 30), line(JUICE, juiceBox, 20)],
      prices([drinksAmount, drinksByBoxes]),
    );
    // 2 %: 14,400 + 4,800; then 10,000 split by 705,600 : 235,200 → 7,500 : 2,500.
    expect(summary(result).lines).toMatchObject([
      { applied: ['Ундаа:2=14400', 'Ундаа хасалт:10000=7500'], total: '698100' },
      { applied: ['Ундаа:2=4800', 'Ундаа хасалт:10000=2500'], total: '232700' },
    ]);
    expect(summary(result).discount).toBe('29200');
  });
});

describe('order programs', () => {
  const owner = [
    program({
      id: 1,
      name: 'Бөөний',
      scope: 'PRODUCT',
      effect: 'PRICE',
      productId: COLA,
      productUnitId: colaBox.unitId,
      steps: steps([240, 22_800]),
    }),
    program({
      id: 2,
      name: 'Ундаа',
      scope: 'CATEGORY',
      measure: 'QTY',
      effect: 'PERCENT',
      categoryIds: DRINKS,
      countUomId: BOX,
      steps: steps([50, 2]),
    }),
    program({
      id: 3,
      name: 'Их захиалга',
      scope: 'ORDER',
      effect: 'PERCENT',
      steps: steps([1_000_000, 1]),
    }),
  ];
  const prices = (programs: QuoteProgram[]) =>
    context(
      [
        [colaBox, 24_000],
        [juiceBox, 12_000],
        [riceKg, 300_000],
      ],
      programs,
    );

  it('stacks every stage in order: the owner’s example of 2026-10-13', () => {
    // 50 boxes: 22,800 each = 1,140,000; −2 % = 1,117,200; ≥ 1,000,000 so −1 % = 1,106,028.
    const result = resolveQuote([line(COLA, colaBox, 50)], prices(owner));
    expect(summary(result)).toEqual({
      lines: [
        {
          list: '24000',
          source: 'UNIT',
          unit: '22800',
          subtotal: '1140000',
          discount: '33972',
          total: '1106028',
          applied: ['Бөөний:22800', 'Ундаа:2=22800', 'Их захиалга:1=11172'],
        },
      ],
      subtotal: '1140000',
      discount: '33972',
      total: '1106028',
    });
  });

  it('checks the order threshold after the earlier discounts', () => {
    // 40 boxes of cola and 5 of juice: 1,020,000 at list prices; the category takes 4 % (40 800)
    // so 979,200 stays below 1,000,000 and the order discount does not apply.
    const categoryFour = owner.map((entry) =>
      entry.scope === 'CATEGORY' ? { ...entry, steps: steps([40, 4]) } : entry,
    );
    const noBreak = categoryFour.filter((entry) => entry.scope !== 'PRODUCT');
    const result = resolveQuote(
      [line(COLA, colaBox, 40), line(JUICE, juiceBox, 5)],
      prices(noBreak),
    );
    expect(summary(result)).toMatchObject({ subtotal: '1020000', total: '979200' });
    expect(summary(result).lines).toMatchObject([
      { applied: ['Ундаа:4=38400'] },
      { applied: ['Ундаа:4=2400'] },
    ]);
  });

  it('splits an amount over every priced line in proportion, to the tugrik', () => {
    const off = program({
      id: 9,
      name: 'Хасалт',
      scope: 'ORDER',
      effect: 'AMOUNT',
      steps: steps([1_000_000, 20_000]),
    });
    const result = resolveQuote(
      [line(RICE, riceKg, 2), line(COLA, colaBox, 1), line(JUICE, juiceBox, 1)],
      context(
        [
          [riceKg, 300_000],
          [colaBox, 300_001],
          [juiceBox, 100_000],
        ],
        [off],
      ),
    );
    // Amounts 600,000 / 300,001 / 100,000: shares 11,999.99 / 6,000.01 / 1,999.99 → 12,000 / 6,000 / 2,000.
    expect(summary(result).lines).toMatchObject([
      { subtotal: '600000', discount: '12000' },
      { subtotal: '300001', discount: '6000' },
      { subtotal: '100000', discount: '2000' },
    ]);
    expect(summary(result).discount).toBe('20000');
  });

  it('never takes more than the lines are worth', () => {
    const off = program({
      id: 9,
      scope: 'ORDER',
      effect: 'AMOUNT',
      steps: steps([0, 50_000]),
    });
    const result = resolveQuote([line(COLA, colaBox, 1)], context([[colaBox, 30_000]], [off]));
    expect(summary(result)).toMatchObject({ discount: '30000', total: '0' });
  });

  it('does not depend on the order the programs arrive in', () => {
    const cart = [line(COLA, colaBox, 50), line(JUICE, juiceBox, 7)];
    const forward = resolveQuote(cart, prices(owner));
    const backward = resolveQuote(cart, prices([...owner].reverse()));
    expect(summary(backward)).toEqual(summary(forward));
  });
});

describe('steps and shapes', () => {
  it('reaches the highest step at or below the measured value', () => {
    const ladder = steps([0, 1], [10, 2], [20, 3]);
    expect(reachedStep(ladder, d(9))?.value.toString()).toBe('1');
    expect(reachedStep(ladder, d(20))?.value.toString()).toBe('3');
    expect(reachedStep(steps([5, 1]), d('4.999'))).toBeNull();
  });

  it('splits exactly and leaves zero weights alone', () => {
    expect(allocate(d(10), [d(1), d(1), d(1)]).map(String)).toEqual(['4', '3', '3']);
    expect(allocate(d(5), [d(0), d(10)]).map(String)).toEqual(['0', '5']);
    expect(allocate(d(0), [d(3)]).map(String)).toEqual(['0']);
  });

  const shape = (fields: Partial<DiscountShape>): DiscountShape => ({
    scope: 'PRODUCT',
    measure: 'QTY',
    effect: 'PERCENT',
    productId: 1,
    productUnitId: null,
    thresholdUnitId: null,
    categoryId: null,
    countUomId: null,
    ...fields,
  });

  it.each([
    [shape({}), null],
    [shape({ effect: 'PRICE' }), 'UNIT_REQUIRED'],
    [shape({ effect: 'AMOUNT', productUnitId: 2 }), null],
    [shape({ productId: null }), 'PRODUCT_REQUIRED'],
    [shape({ measure: 'AMOUNT' }), 'MEASURE_NOT_ALLOWED'],
    [shape({ categoryId: 3 }), 'TARGET_NOT_ALLOWED'],
    [shape({ scope: 'CATEGORY', productId: null, categoryId: 3, countUomId: 2 }), null],
    [shape({ scope: 'CATEGORY', productId: null, categoryId: 3 }), 'COUNT_UNIT_REQUIRED'],
    [shape({ scope: 'CATEGORY', productId: null, categoryId: 3, measure: 'AMOUNT' }), null],
    [
      shape({
        scope: 'CATEGORY',
        productId: null,
        categoryId: 3,
        measure: 'AMOUNT',
        countUomId: 2,
      }),
      'TARGET_NOT_ALLOWED',
    ],
    [
      shape({ scope: 'CATEGORY', productId: null, categoryId: 3, countUomId: 2, effect: 'PRICE' }),
      'EFFECT_NOT_ALLOWED',
    ],
    [shape({ scope: 'CATEGORY', categoryId: 3, countUomId: 2 }), 'TARGET_NOT_ALLOWED'],
    [shape({ scope: 'CATEGORY', productId: null }), 'CATEGORY_REQUIRED'],
    [shape({ scope: 'ORDER', productId: null, measure: 'AMOUNT', effect: 'AMOUNT' }), null],
    [shape({ scope: 'ORDER', productId: null }), 'MEASURE_NOT_ALLOWED'],
    [
      shape({ scope: 'ORDER', productId: null, measure: 'AMOUNT', effect: 'PRICE' }),
      'EFFECT_NOT_ALLOWED',
    ],
    [shape({ scope: 'ORDER', measure: 'AMOUNT' }), 'TARGET_NOT_ALLOWED'],
  ])('shape %# → %s', (input, issue) => {
    expect(discountShapeIssue(input)).toBe(issue);
  });

  it('checks the steps: rising thresholds, values in range', () => {
    expect(discountStepsIssue('PERCENT', [])).toEqual({ issue: 'NO_STEPS', index: null });
    expect(
      discountStepsIssue(
        'PERCENT',
        steps(...Array.from({ length: 21 }, (_, i) => [i, 1] as [number, number])),
      ),
    ).toEqual({ issue: 'TOO_MANY_STEPS', index: null });
    expect(discountStepsIssue('PERCENT', steps([0, 1], [10, '99.99']))).toBeNull();
    expect(discountStepsIssue('PERCENT', steps([10, 1], [10, 2]))).toEqual({
      issue: 'THRESHOLD_ORDER',
      index: 1,
    });
    expect(discountStepsIssue('PERCENT', steps([-1, 1]))).toEqual({
      issue: 'THRESHOLD_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('PERCENT', steps(['0.0001', 1]))).toEqual({
      issue: 'THRESHOLD_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('PERCENT', steps([0, 100]))).toEqual({
      issue: 'VALUE_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('PERCENT', steps([0, '1.005']))).toEqual({
      issue: 'VALUE_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('PRICE', steps([0, '1000.5']))).toEqual({
      issue: 'VALUE_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('AMOUNT', steps([0, 20_000]))).toBeNull();
  });
});
