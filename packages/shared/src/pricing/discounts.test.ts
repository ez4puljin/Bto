import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  adjustedPrice,
  allocate,
  type DiscountShape,
  discountShapeIssue,
  discountStepsIssue,
  priceAdjustIssue,
  programServes,
  reachedStep,
} from './discounts';

const d = (value: string | number) => new Decimal(value);

const steps = (...pairs: [string | number, string | number][]) =>
  pairs.map(([threshold, value]) => ({ threshold: d(threshold), value: d(value) }));

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
    // ADR-0159: a product may be measured by its amount, a set counted and rounded, N+M given.
    [shape({ measure: 'AMOUNT' }), null],
    [shape({ productId: null, targetKind: 'SUPPLIER' }), null],
    [shape({ productId: null, targetKind: 'SEGMENT', effect: 'PRICE' }), null],
    [shape({ productId: null, productUnitId: 2, targetKind: 'PRODUCT' }), 'TARGET_NOT_ALLOWED'],
    [shape({ targetKind: 'PRODUCT' }), 'TARGET_NOT_ALLOWED'],
    [shape({ effect: 'BONUS' }), null],
    [shape({ effect: 'BONUS', measure: 'AMOUNT' }), 'MEASURE_NOT_ALLOWED'],
    [shape({ effect: 'BONUS', productUnitId: 2 }), 'TARGET_NOT_ALLOWED'],
    [shape({ priority: true }), null],
    [shape({ adjustKind: 'ROUND' }), null],
    [shape({ effect: 'BONUS', adjustKind: 'ROUND' }), 'ADJUST_NOT_ALLOWED'],
    [
      shape({ scope: 'CATEGORY', productId: null, targetKind: 'SUPPLIER', measure: 'AMOUNT' }),
      null,
    ],
    [
      shape({
        scope: 'CATEGORY',
        productId: null,
        categoryId: 3,
        targetKind: 'SUPPLIER',
        measure: 'AMOUNT',
      }),
      'TARGET_NOT_ALLOWED',
    ],
    [
      shape({ scope: 'CATEGORY', productId: null, categoryId: 3, countUomId: 2, priority: true }),
      'PRIORITY_NOT_ALLOWED',
    ],
    [
      shape({ scope: 'CATEGORY', productId: null, categoryId: 3, countUomId: 2, effect: 'BONUS' }),
      'EFFECT_NOT_ALLOWED',
    ],
    [
      shape({
        scope: 'CATEGORY',
        productId: null,
        categoryId: 3,
        countUomId: 2,
        adjustKind: 'FLOOR',
      }),
      'ADJUST_NOT_ALLOWED',
    ],
    [
      shape({ scope: 'ORDER', productId: null, measure: 'AMOUNT', targetKind: 'SUPPLIER' }),
      'TARGET_NOT_ALLOWED',
    ],
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

describe('N+M and rule steps (ADR-0159)', () => {
  it('takes one pair above zero', () => {
    expect(discountStepsIssue('BONUS', steps([1, 1]))).toBeNull();
    expect(discountStepsIssue('BONUS', steps([0, 1]))).toEqual({
      issue: 'THRESHOLD_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('BONUS', [{ threshold: d(1), value: d(0) }])).toEqual({
      issue: 'VALUE_RANGE',
      index: 0,
    });
    expect(discountStepsIssue('BONUS', steps([1, 1], [2, 2]))).toEqual({
      issue: 'TOO_MANY_STEPS',
      index: null,
    });
  });

  it('refuses every zero', () => {
    expect(
      discountStepsIssue('PERCENT', [{ threshold: d(0), value: d(5), rule: 'EVERY' }]),
    ).toEqual({ issue: 'THRESHOLD_RANGE', index: 0 });
  });

  it('meets each rule, the highest threshold met winning', () => {
    const rows = [
      { threshold: d(5), value: d(1) },
      { threshold: d(10), value: d(2), rule: 'EXACT' as const },
      { threshold: d(7), value: d(3), rule: 'EVERY' as const },
    ];
    expect(reachedStep(rows, d(4))).toBeNull();
    expect(reachedStep(rows, d(5))?.value.toFixed()).toBe('1');
    expect(reachedStep(rows, d(10))?.value.toFixed()).toBe('2');
    expect(reachedStep(rows, d(11))?.value.toFixed()).toBe('1');
    expect(reachedStep(rows, d(14))?.value.toFixed()).toBe('3');
  });
});

describe('rounding (ADR-0159 #7)', () => {
  it.each([
    ['ROUND', 1234, 10, '1230'],
    ['ROUND', 1235, 10, '1240'],
    ['FLOOR', 1239, 10, '1230'],
    ['CEIL', 1231, 10, '1240'],
    ['ENDS_9', 1234, 10, '1229'],
    ['ENDS_9', 1239, 10, '1239'],
    ['ENDS_9', 1234, 100, '1199'],
    ['ENDS_9', 1299, 100, '1299'],
    ['NONE', 1234, 1, '1234'],
  ] as const)('%s of %i by %i is %s', (kind, price, factor, expected) => {
    expect(adjustedPrice(d(price), kind, d(factor)).toFixed()).toBe(expected);
  });

  it('keeps a price the rounding would take to nothing', () => {
    expect(adjustedPrice(d(40), 'FLOOR', d(100)).toFixed()).toBe('40');
    expect(adjustedPrice(d(5), 'ENDS_9', d(100)).toFixed()).toBe('5');
  });

  it('takes whole factors, and powers of ten for an ending in 9', () => {
    expect(priceAdjustIssue('ROUND', d(50))).toBeNull();
    expect(priceAdjustIssue('NONE', d(0))).toBeNull();
    expect(priceAdjustIssue('ROUND', d(0))).toBe('ADJUST_FACTOR');
    expect(priceAdjustIssue('ROUND', d('2.5'))).toBe('ADJUST_FACTOR');
    expect(priceAdjustIssue('ENDS_9', d(100))).toBeNull();
    expect(priceAdjustIssue('ENDS_9', d(50))).toBe('ADJUST_FACTOR');
    expect(priceAdjustIssue('ENDS_9', d(1))).toBe('ADJUST_FACTOR');
  });
});

describe('programServes (ADR-0159 #5)', () => {
  it('serves everywhere when nothing is named', () => {
    expect(programServes({}, 'WHOLESALE', {})).toBe(true);
    expect(programServes({ pipelineIds: [], tillIds: [] }, 'RETAIL', { tillId: 4 })).toBe(true);
  });

  it('serves only the pipelines and tills named', () => {
    const named = { pipelineIds: [1], tillIds: [4] };
    expect(programServes(named, 'WHOLESALE', { pipelineId: 1 })).toBe(true);
    expect(programServes(named, 'WHOLESALE', { pipelineId: 2 })).toBe(false);
    expect(programServes(named, 'WHOLESALE', {})).toBe(false);
    expect(programServes(named, 'RETAIL', { tillId: 4 })).toBe(true);
    expect(programServes(named, 'RETAIL', { tillId: 5 })).toBe(false);
    expect(programServes(named, 'RETAIL', { pipelineId: 1 })).toBe(false);
  });
});
