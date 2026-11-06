import { Decimal, roundHalfUp } from '../money';

/**
 * Discount programs (ADR-0041 #2, ADR-0159): their channels, scopes, measures, effects and steps, the rules
 * a program's shape and steps follow, and the helpers every quote uses: the step a measured value
 * reaches and the split of an amount over lines.
 */

/**
 * The sales channel of a quote and of a discount program (ADR-0048 #7): WHOLESALE, every customer
 * channel; RETAIL, the supermarket (its POS comes in delivery 9).
 */
export const PRICE_LISTS = ['WHOLESALE', 'RETAIL'] as const;
export type PriceList = (typeof PRICE_LISTS)[number];

/** Where a discount program serves (ADR-0159 #5): one channel or both. */
export const PROGRAM_LISTS = ['WHOLESALE', 'RETAIL', 'ALL'] as const;
export type ProgramList = (typeof PROGRAM_LISTS)[number];

/**
 * What a person set (ADR-0159 #1): ACTIVE counts by its dates, DRAFT and ARCHIVED never apply. The
 * screens read this with the dates as one status.
 */
export const PROGRAM_STATES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type ProgramState = (typeof PROGRAM_STATES)[number];

/**
 * What a program discounts and how it counts (ADR-0159 #2): PRODUCT, each product on its own (one
 * product, or a set of them when the program has targets); CATEGORY, the products together (a
 * category subtree, or a set); ORDER, the whole order.
 */
export const DISCOUNT_SCOPES = ['PRODUCT', 'CATEGORY', 'ORDER'] as const;
export type DiscountScope = (typeof DISCOUNT_SCOPES)[number];

/** What a step's threshold counts: a quantity or an amount in MNT. */
export const DISCOUNT_MEASURES = ['QTY', 'AMOUNT'] as const;
export type DiscountMeasure = (typeof DISCOUNT_MEASURES)[number];

/**
 * PRICE: a new unit price (per base unit in a set of products); PERCENT: % off; AMOUNT: tugriks
 * off, per unit for a product, off the subtotal for a category or the order; BONUS: N+M, of the
 * quantity written every N+M has M free, as a discount on the line (ADR-0159 #3).
 */
export const DISCOUNT_EFFECTS = ['PRICE', 'PERCENT', 'AMOUNT', 'BONUS'] as const;
export type DiscountEffect = (typeof DISCOUNT_EFFECTS)[number];

/** When a step applies (ADR-0159 #6): from its threshold on, exactly at it, or at its multiples. */
export const STEP_RULES = ['MINIMUM', 'EXACT', 'EVERY'] as const;
export type StepRule = (typeof STEP_RULES)[number];

/** How a program's resulting unit price is rounded (ADR-0159 #7). */
export const PRICE_ADJUSTS = ['NONE', 'ROUND', 'FLOOR', 'CEIL', 'ENDS_9'] as const;
export type PriceAdjust = (typeof PRICE_ADJUSTS)[number];
export const MAX_ADJUST_FACTOR = 1_000_000;

/** The kinds of products a program's set is made of (ADR-0159 #2). */
export const PROGRAM_TARGETS = ['PRODUCT', 'CATEGORY', 'SUPPLIER', 'SEGMENT'] as const;
export type ProgramTarget = (typeof PROGRAM_TARGETS)[number];
export const MAX_PROGRAM_TARGETS = 500;

/** What a screen calls a program by what it applies to. */
export const PROGRAM_APPLY_TYPES = ['PRODUCT', 'CATEGORY', 'SUPPLIER', 'SEGMENT', 'ORDER'] as const;
export type ProgramApplyType = (typeof PROGRAM_APPLY_TYPES)[number];

export function programApplyType(program: {
  scope: DiscountScope;
  targetKind?: ProgramTarget | null;
}): ProgramApplyType {
  return program.targetKind ?? program.scope;
}

export const MAX_DISCOUNT_STEPS = 20;
export const MAX_QUOTE_LINES = 200;
/** NUMERIC(14,3) thresholds, NUMERIC(14,2) prices and amounts. */
const MAX_THRESHOLD = new Decimal('99999999999.999');
const MAX_MONEY = new Decimal('999999999999');

export interface DiscountStep {
  /** PRODUCT QTY: base units; CATEGORY QTY: units of the counted unit of measure; AMOUNT: MNT. */
  threshold: Decimal;
  /**
   * PRICE and AMOUNT: whole MNT; PERCENT: a percentage below 100 with at most two decimals. BONUS:
   * the threshold is N and the value M, in the same units.
   */
  value: Decimal;
  /** Absent: MINIMUM. */
  rule?: StepRule;
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
  /** The kind of a program's set; absent or null: its one product, category or the order. */
  targetKind?: ProgramTarget | null;
  /** Applies alone (ADR-0159 #4); only a program counting each product on its own. */
  priority?: boolean;
  adjustKind?: PriceAdjust;
}

export type DiscountShapeIssue =
  | 'PRODUCT_REQUIRED'
  | 'UNIT_REQUIRED'
  | 'CATEGORY_REQUIRED'
  | 'COUNT_UNIT_REQUIRED'
  | 'MEASURE_NOT_ALLOWED'
  | 'EFFECT_NOT_ALLOWED'
  | 'TARGET_NOT_ALLOWED'
  | 'PRIORITY_NOT_ALLOWED'
  | 'ADJUST_NOT_ALLOWED';

/**
 * Why a program's shape is not allowed, or null. The database checks the same rules
 * (`discount_programs_shape`); the api and the web form use this to explain them.
 */
export function discountShapeIssue(shape: DiscountShape): DiscountShapeIssue | null {
  const targeted = shape.targetKind !== undefined && shape.targetKind !== null;
  if (shape.scope !== 'PRODUCT') {
    if (shape.priority === true) return 'PRIORITY_NOT_ALLOWED';
    if (shape.effect === 'BONUS') return 'EFFECT_NOT_ALLOWED';
  }
  if (
    shape.adjustKind !== undefined &&
    shape.adjustKind !== 'NONE' &&
    (shape.scope !== 'PRODUCT' || shape.effect === 'BONUS')
  ) {
    return 'ADJUST_NOT_ALLOWED';
  }
  switch (shape.scope) {
    case 'PRODUCT':
      if (!targeted && shape.productId === null) return 'PRODUCT_REQUIRED';
      if (shape.categoryId !== null || shape.countUomId !== null) return 'TARGET_NOT_ALLOWED';
      if (
        targeted &&
        (shape.productId !== null || shape.productUnitId !== null || shape.thresholdUnitId !== null)
      ) {
        return 'TARGET_NOT_ALLOWED';
      }
      if (shape.effect === 'BONUS') {
        if (shape.measure !== 'QTY') return 'MEASURE_NOT_ALLOWED';
        return shape.productUnitId === null ? null : 'TARGET_NOT_ALLOWED';
      }
      if (!targeted && shape.effect !== 'PERCENT' && shape.productUnitId === null) {
        return 'UNIT_REQUIRED';
      }
      return null;
    case 'CATEGORY':
      if (!targeted && shape.categoryId === null) return 'CATEGORY_REQUIRED';
      if (
        shape.productId !== null ||
        shape.productUnitId !== null ||
        shape.thresholdUnitId !== null ||
        (targeted && shape.categoryId !== null)
      ) {
        return 'TARGET_NOT_ALLOWED';
      }
      if (shape.effect === 'PRICE') return 'EFFECT_NOT_ALLOWED';
      if (shape.measure === 'QTY' && shape.countUomId === null) return 'COUNT_UNIT_REQUIRED';
      if (shape.measure === 'AMOUNT' && shape.countUomId !== null) return 'TARGET_NOT_ALLOWED';
      return null;
    case 'ORDER':
      if (
        targeted ||
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

/**
 * Why a rounding is not allowed, or null: a whole factor up to a million; «ends in 9» needs a power
 * of ten from 10 (…9, …99, …999).
 */
export function priceAdjustIssue(kind: PriceAdjust, factor: Decimal): 'ADJUST_FACTOR' | null {
  if (kind === 'NONE') return null;
  if (!factor.isInteger() || factor.lt(1) || factor.gt(MAX_ADJUST_FACTOR)) return 'ADJUST_FACTOR';
  if (kind === 'ENDS_9' && !/^10+$/.test(factor.toFixed())) return 'ADJUST_FACTOR';
  return null;
}

/**
 * A program's unit price rounded (ADR-0159 #7), to a multiple of the factor, or down to the nearest
 * price ending in 9s. The caller holds it under the price it started from; a result of zero or less
 * keeps the price as it was.
 */
export function adjustedPrice(price: Decimal, kind: PriceAdjust, factor: Decimal): Decimal {
  const result = adjustedRaw(price, kind, factor);
  return result.gt(0) ? result : price;
}

function adjustedRaw(price: Decimal, kind: PriceAdjust, factor: Decimal): Decimal {
  switch (kind) {
    case 'NONE':
      return price;
    case 'ROUND':
      return roundHalfUp(price.div(factor), 0).times(factor);
    case 'FLOOR':
      return price.div(factor).floor().times(factor);
    case 'CEIL':
      return price.div(factor).ceil().times(factor);
    case 'ENDS_9':
      return price.plus(1).div(factor).floor().times(factor).minus(1);
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
  if (effect === 'BONUS') {
    // N+M: one pair, both above zero.
    const [step] = steps;
    if (steps.length > 1 || !step) return { issue: 'TOO_MANY_STEPS', index: null };
    const { threshold, value } = step;
    if (!threshold.gt(0) || threshold.gt(MAX_THRESHOLD) || threshold.decimalPlaces() > 3) {
      return { issue: 'THRESHOLD_RANGE', index: 0 };
    }
    if (!value.gt(0) || value.gt(MAX_THRESHOLD) || value.decimalPlaces() > 2) {
      return { issue: 'VALUE_RANGE', index: 0 };
    }
    return null;
  }
  for (const [index, step] of steps.entries()) {
    const { threshold, value } = step;
    if (threshold.isNeg() || threshold.gt(MAX_THRESHOLD) || threshold.decimalPlaces() > 3) {
      return { issue: 'THRESHOLD_RANGE', index };
    }
    if (step.rule === 'EVERY' && threshold.isZero()) return { issue: 'THRESHOLD_RANGE', index };
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
  /**
   * PRODUCT: the unit a program applies to; null = every unit of the product (a PERCENT or BONUS,
   * or a set's PRICE and AMOUNT, which are per base unit).
   */
  productUnitId: number | null;
  /** CATEGORY: the program's category and every category below it. */
  categoryIds: ReadonlySet<number> | null;
  /** A program with targets (ADR-0159 #2): its products, expanded and with exclusions taken out. */
  productIds?: ReadonlySet<number> | null;
  /** Applies alone on a product (ADR-0159 #4); the newest of several. */
  priority?: boolean;
  /** Rounds the resulting unit price (ADR-0159 #7). */
  adjust?: { kind: PriceAdjust; factor: Decimal } | null;
  /** The tills it serves at the store edge (ADR-0159 #5); empty or absent: all of them. */
  tillIds?: readonly number[];
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

/** The highest step the measured value meets by its rule, or null. */
export function reachedStep(
  steps: readonly DiscountStep[],
  measured: Decimal,
): DiscountStep | null {
  let reached: DiscountStep | null = null;
  for (const step of steps) {
    if (stepMet(step, measured) && (!reached || step.threshold.gt(reached.threshold))) {
      reached = step;
    }
  }
  return reached;
}

function stepMet(step: DiscountStep, measured: Decimal): boolean {
  switch (step.rule ?? 'MINIMUM') {
    case 'MINIMUM':
      return step.threshold.lte(measured);
    case 'EXACT':
      return step.threshold.eq(measured);
    case 'EVERY':
      return step.threshold.gt(0) && measured.gt(0) && measured.mod(step.threshold).isZero();
  }
}

/**
 * Whether a program serves this place (ADR-0159 #5): no pipelines or tills named means everywhere
 * in its channel; an unknown place (a calculator, a badge) takes only those.
 */
export function programServes(
  program: { pipelineIds?: readonly number[]; tillIds?: readonly number[] },
  list: PriceList,
  place: { pipelineId?: number | null; tillId?: number | null },
): boolean {
  const named = (list === 'WHOLESALE' ? program.pipelineIds : program.tillIds) ?? [];
  const here = list === 'WHOLESALE' ? place.pipelineId : place.tillId;
  return named.length === 0 || (here !== undefined && here !== null && named.includes(here));
}
