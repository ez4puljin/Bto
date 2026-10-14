import { describe, expect, it } from 'vitest';
import { Decimal } from '../money';
import {
  allocate,
  type DiscountShape,
  discountShapeIssue,
  discountStepsIssue,
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
