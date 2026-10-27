import { Decimal } from '../money';

/**
 * Discount programs (ADR-0041 #2): their channels, scopes, measures, effects and steps, the rules
 * a program's shape and steps follow, and the helpers every quote uses: the step a measured value
 * reaches and the split of an amount over lines.
 */

/**
 * The sales channel of a quote and of a discount program (ADR-0048 #7): WHOLESALE, every customer
 * channel; RETAIL, the supermarket (its POS comes in delivery 9).
 */
export const PRICE_LISTS = ['WHOLESALE', 'RETAIL'] as const;
export type PriceList = (typeof PRICE_LISTS)[number];

/** What a program discounts: one product, the products of a category subtree, or the whole order. */
export const DISCOUNT_SCOPES = ['PRODUCT', 'CATEGORY', 'ORDER'] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

/** What a step's threshold counts: a quantity or an amount in MNT. */
export const DISCOUNT_MEASURES = ['QTY', 'AMOUNT'] as const;
export type DiscountMeasure = (typeof DISCOUNT_MEASURES)[number];

/**
 * PRICE: a new unit price (a product's unit only); PERCENT: % off; AMOUNT: tugriks off, per unit
 * for a product, off the subtotal for a category or the order.
 */
export const DISCOUNT_EFFECTS = ['PRICE', 'PERCENT', 'AMOUNT'] as const;
export type DiscountEffect = (typeof DISCOUNT_EFFECTS)[number];

export const MAX_DISCOUNT_STEPS = 20;
export const MAX_QUOTE_LINES = 200;
/** NUMERIC(14,3) thresholds, NUMERIC(14,2) prices and amounts. */
const MAX_THRESHOLD = new Decimal('99999999999.999');
const MAX_MONEY = new Decimal('999999999999');

export interface DiscountStep {
  /** PRODUCT QTY: base units; CATEGORY QTY: units of the counted unit of measure; AMOUNT: MNT. */
  threshold: Decimal;
  /** PRICE and AMOUNT: whole MNT; PERCENT: a percentage below 100 with at most two decimals. */
  value: Decimal;
}

/** The fields that decide which targets and effects a program may have. */
export interface DiscountShape {
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productId: number | null;
  productUnitId: number | null;
  thresholdUnitId: number | null;
  categoryId: number | null;
  countUomId: number | null;
}

export type DiscountShapeIssue =
  | 'PRODUCT_REQUIRED'
  | 'UNIT_REQUIRED'
  | 'CATEGORY_REQUIRED'
  | 'COUNT_UNIT_REQUIRED'
  | 'MEASURE_NOT_ALLOWED'
  | 'EFFECT_NOT_ALLOWED'
  | 'TARGET_NOT_ALLOWED';

/**
 * Why a program's shape is not allowed, or null. The database checks the same rules
 * (`discount_programs_shape`); the api and the web form use this to explain them.
 */
export function discountShapeIssue(shape: DiscountShape): DiscountShapeIssue | null {
  switch (shape.scope) {
    case 'PRODUCT':
      if (shape.productId === null) return 'PRODUCT_REQUIRED';
      if (shape.categoryId !== null || shape.countUomId !== null) return 'TARGET_NOT_ALLOWED';
      if (shape.measure !== 'QTY') return 'MEASURE_NOT_ALLOWED';
      if (shape.effect !== 'PERCENT' && shape.productUnitId === null) return 'UNIT_REQUIRED';
      return null;
    case 'CATEGORY':
      if (shape.categoryId === null) return 'CATEGORY_REQUIRED';
      if (
        shape.productId !== null ||
        shape.productUnitId !== null ||
        shape.thresholdUnitId !== null
      ) {
        return 'TARGET_NOT_ALLOWED';
      }
      if (shape.effect === 'PRICE') return 'EFFECT_NOT_ALLOWED';
      if (shape.measure === 'QTY' && shape.countUomId === null) return 'COUNT_UNIT_REQUIRED';
      if (shape.measure === 'AMOUNT' && shape.countUomId !== null) return 'TARGET_NOT_ALLOWED';
      return null;
    case 'ORDER':
      if (
        shape.productId !== null ||
        shape.productUnitId !== null ||
        shape.thresholdUnitId !== null ||
        shape.categoryId !== null ||
        shape.countUomId !== null
      ) {
        return 'TARGET_NOT_ALLOWED';
      }
      if (shape.measure !== 'AMOUNT') return 'MEASURE_NOT_ALLOWED';
      if (shape.effect === 'PRICE') return 'EFFECT_NOT_ALLOWED';
      return null;
  }
}

export type DiscountStepsIssue =
  'NO_STEPS' | 'TOO_MANY_STEPS' | 'THRESHOLD_RANGE' | 'THRESHOLD_ORDER' | 'VALUE_RANGE';

/**
 * Why a program's steps are not allowed, with the step's index (null for the whole list), or null.
 * Thresholds rise strictly from the first step (0 allowed: the step always applies).
 */
export function discountStepsIssue(
  effect: DiscountEffect,
  steps: readonly DiscountStep[],
): { issue: DiscountStepsIssue; index: number | null } | null {
  if (steps.length === 0) return { issue: 'NO_STEPS', index: null };
  if (steps.length > MAX_DISCOUNT_STEPS) return { issue: 'TOO_MANY_STEPS', index: null };
  for (const [index, step] of steps.entries()) {
    const { threshold, value } = step;
    if (threshold.isNeg() || threshold.gt(MAX_THRESHOLD) || threshold.decimalPlaces() > 3) {
      return { issue: 'THRESHOLD_RANGE', index };
    }
    const previous = steps[index - 1];
    if (previous && !threshold.gt(previous.threshold)) {
      return { issue: 'THRESHOLD_ORDER', index };
    }
    const valueOk =
      effect === 'PERCENT'
        ? value.gt(0) && value.lt(100) && value.decimalPlaces() <= 2
        : value.gt(0) && value.lte(MAX_MONEY) && value.isInteger();
    if (!valueOk) return { issue: 'VALUE_RANGE', index };
  }
  return null;
}

export interface QuoteProgram {
  id: number;
  name: string;
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productId: number | null;
  /** PRODUCT: the unit a program applies to; null = every unit of the product (PERCENT only). */
  productUnitId: number | null;
  /** CATEGORY: the program's category and every category below it. */
  categoryIds: ReadonlySet<number> | null;
  /** CATEGORY QTY: the unit of measure counted, e.g. boxes. */
  countUomId: number | null;
  steps: readonly DiscountStep[];
}

export interface AppliedDiscount {
  programId: number;
  name: string;
  scope: DiscountScope;
  effect: DiscountEffect;
  /** The step reached. */
  threshold: Decimal;
  value: Decimal;
  /** Tugriks a category or order program took off the line; null for a product program, whose effect is in the unit price. */
  amount: Decimal | null;
  /** A till's coupon (ADR-0110): its code; programId is 0. */
  code?: string;
}

const ZERO = new Decimal(0);

/**
 * Splits a whole-MNT amount over whole-MNT weights in proportion (largest remainder, ties to the
 * earlier line); the parts add up to the amount exactly. The amount never exceeds the weights' sum.
 */
export function allocate(amount: Decimal, weights: readonly Decimal[]): Decimal[] {
  const sum = weights.reduce((total, weight) => total.plus(weight), ZERO);
  if (sum.isZero() || amount.isZero()) return weights.map(() => ZERO);
  const exact = weights.map((weight) => amount.times(weight).div(sum));
  const parts = exact.map((value) => value.floor());
  let remainder = amount.minus(parts.reduce((total, part) => total.plus(part), ZERO));
  const order = exact
    .map((value, index) => ({ index, fraction: value.minus(value.floor()) }))
    .sort((a, b) => b.fraction.comparedTo(a.fraction) || a.index - b.index);
  for (const { index } of order) {
    if (!remainder.gt(0)) break;
    parts[index] = (parts[index] ?? ZERO).plus(1);
    remainder = remainder.minus(1);
  }
  return parts;
}

/** The highest step whose threshold the measured value reaches, or null. */
export function reachedStep(
  steps: readonly DiscountStep[],
  measured: Decimal,
): DiscountStep | null {
  let reached: DiscountStep | null = null;
  for (const step of steps) {
    if (step.threshold.lte(measured) && (!reached || step.threshold.gt(reached.threshold))) {
      reached = step;
    }
  }
  return reached;
}
