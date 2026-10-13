import { Decimal, roundHalfUp } from '../money';

/**
 * Pricing (ADR-0041): one price for every customer per list, effective-dated unit prices, and
 * discount programs that all stack in a fixed order. The resolver below is pure: the api fetches
 * the prices and programs in force on a date and passes them in; the web shows its explanation.
 */

/** WHOLESALE: every customer channel; RETAIL: the supermarket (its POS comes in delivery 9). */
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

// ---------------------------------------------------------------------------------------------
// The resolver

export interface QuoteUnit {
  unitId: number;
  uomId: number;
  factor: Decimal;
  isBase: boolean;
}

export interface QuoteProduct {
  categoryId: number;
  /** The product's current units (derived prices, counted boxes). */
  units: readonly QuoteUnit[];
}

export interface QuoteLineInput {
  productId: number;
  unitId: number;
  /** As entered, in the line's unit. */
  qty: Decimal;
  /** The same quantity in base units. */
  qtyBase: Decimal;
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

export interface QuoteContext {
  products: ReadonlyMap<number, QuoteProduct>;
  /** Unit prices in force on the quote date in the quoted list, by unit id. */
  prices: ReadonlyMap<number, Decimal>;
  /** Programs in force on the quote date in the quoted list. */
  programs: readonly QuoteProgram[];
}

/** UNIT: the unit's own price; DERIVED: the base unit's price × the unit's factor. */
export type PriceSource = 'UNIT' | 'DERIVED';

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
}

export interface PricedLine {
  priced: true;
  listPrice: Decimal;
  priceSource: PriceSource;
  /** After the product's own discounts, whole MNT. */
  unitPrice: Decimal;
  /** unitPrice × qty, whole MNT. */
  subtotal: Decimal;
  /** Taken off by category and order programs, whole MNT. */
  discountAmount: Decimal;
  total: Decimal;
  applied: AppliedDiscount[];
}

export interface UnpricedLine {
  priced: false;
  problem: 'PRICE_MISSING';
}

export type QuoteLineResult = PricedLine | UnpricedLine;

export interface QuoteResult {
  lines: QuoteLineResult[];
  /** Over priced lines only. */
  subtotal: Decimal;
  discountTotal: Decimal;
  total: Decimal;
}

const ZERO = new Decimal(0);
const HUNDRED = new Decimal(100);

interface LineState {
  listPrice: Decimal;
  priceSource: PriceSource;
  unitPrice: Decimal;
  subtotal: Decimal;
  /** The line's amount so far, whole MNT. */
  amount: Decimal;
  applied: AppliedDiscount[];
}

/**
 * Prices a cart (ADR-0041 #3). In order:
 * 1. the list price: the unit's own price, else the base unit's price × factor (HALF_UP);
 * 2. the product's programs, reached by the product's quantity in the whole cart (base units):
 *    PRICE (never above the price so far), then PERCENT, then AMOUNT per unit; the unit price is
 *    then rounded to whole MNT and the line's subtotal is unit price × quantity (whole MNT);
 * 3. category programs, reached by the boxes counted or the amount of the category's lines after
 *    step 2; a percentage comes off each line (whole MNT), an amount is split over the lines in
 *    proportion to their amounts;
 * 4. order programs, reached by the cart's amount after step 3, applied the same way.
 * Within a stage every program is measured on the stage's starting amounts, then PERCENT programs
 * and AMOUNT programs apply in that order, each by id. A line without a price is left out of the
 * amounts but its quantity still counts.
 */
export function resolveQuote(lines: readonly QuoteLineInput[], context: QuoteContext): QuoteResult {
  const productQty = new Map<number, Decimal>();
  for (const line of lines) {
    productQty.set(line.productId, (productQty.get(line.productId) ?? ZERO).plus(line.qtyBase));
  }
  const states = lines.map((line) =>
    priceLine(line, context, productQty.get(line.productId) ?? ZERO),
  );

  const categoryPrograms = stageOrder(context.programs, 'CATEGORY');
  const reachedInCategories = categoryPrograms.map((program) => {
    const members = lines.flatMap((line, index) =>
      program.categoryIds?.has(context.products.get(line.productId)?.categoryId ?? -1)
        ? [index]
        : [],
    );
    const measured =
      program.measure === 'QTY'
        ? countedQty(program.countUomId, members, lines, context)
        : amountOf(members, states);
    return { program, members, step: reachedStep(program.steps, measured) };
  });
  for (const { program, members, step } of reachedInCategories) {
    if (step) applyToAmounts(program, step, members, states);
  }

  const everyLine = lines.map((_, index) => index);
  const orderAmount = amountOf(everyLine, states);
  for (const program of stageOrder(context.programs, 'ORDER')) {
    const step = reachedStep(program.steps, orderAmount);
    if (step) applyToAmounts(program, step, everyLine, states);
  }

  let subtotal = ZERO;
  let total = ZERO;
  const results = states.map((state): QuoteLineResult => {
    if (!state) return { priced: false, problem: 'PRICE_MISSING' };
    subtotal = subtotal.plus(state.subtotal);
    total = total.plus(state.amount);
    return {
      priced: true,
      listPrice: state.listPrice,
      priceSource: state.priceSource,
      unitPrice: state.unitPrice,
      subtotal: state.subtotal,
      discountAmount: state.subtotal.minus(state.amount),
      total: state.amount,
      applied: state.applied,
    };
  });
  return { lines: results, subtotal, discountTotal: subtotal.minus(total), total };
}

/** Steps 1–2: the list price and the product's own programs. */
function priceLine(
  line: QuoteLineInput,
  context: QuoteContext,
  productQty: Decimal,
): LineState | null {
  const product = context.products.get(line.productId);
  const unit = product?.units.find((candidate) => candidate.unitId === line.unitId);
  if (!product || !unit) return null;
  let listPrice = context.prices.get(unit.unitId);
  let priceSource: PriceSource = 'UNIT';
  if (!listPrice) {
    const base = product.units.find((candidate) => candidate.isBase);
    const basePrice = base && !unit.isBase ? context.prices.get(base.unitId) : undefined;
    if (!basePrice) return null;
    listPrice = roundHalfUp(basePrice.times(unit.factor), 0);
    priceSource = 'DERIVED';
  }

  let price = listPrice;
  const applied: AppliedDiscount[] = [];
  const programs = stageOrder(context.programs, 'PRODUCT').filter(
    (program) =>
      program.productId === line.productId &&
      (program.productUnitId === null || program.productUnitId === line.unitId),
  );
  for (const program of programs) {
    const step = reachedStep(program.steps, productQty);
    if (!step) continue;
    if (program.effect === 'PRICE') {
      if (!step.value.lt(price)) continue;
      price = step.value;
    } else if (program.effect === 'PERCENT') {
      price = price.times(HUNDRED.minus(step.value)).div(HUNDRED);
    } else {
      price = Decimal.max(ZERO, price.minus(step.value));
    }
    applied.push(appliedOf(program, step, null));
  }
  const unitPrice = roundHalfUp(price, 0);
  const subtotal = roundHalfUp(unitPrice.times(line.qty), 0);
  return { listPrice, priceSource, unitPrice, subtotal, amount: subtotal, applied };
}

/** Steps 3–4: one category or order program on the amounts of its lines. */
function applyToAmounts(
  program: QuoteProgram,
  step: DiscountStep,
  members: readonly number[],
  states: readonly (LineState | null)[],
): void {
  const priced = members.flatMap((index) => {
    const state = states[index];
    return state && state.amount.gt(0) ? [state] : [];
  });
  if (priced.length === 0) return;
  let cuts: Decimal[];
  if (program.effect === 'PERCENT') {
    cuts = priced.map((state) => roundHalfUp(state.amount.times(step.value).div(HUNDRED), 0));
  } else {
    const available = priced.reduce((sum, state) => sum.plus(state.amount), ZERO);
    cuts = allocate(
      Decimal.min(step.value, available),
      priced.map((state) => state.amount),
    );
  }
  for (const [index, state] of priced.entries()) {
    const cut = cuts[index] ?? ZERO;
    if (cut.isZero()) continue;
    state.amount = state.amount.minus(cut);
    state.applied.push(appliedOf(program, step, cut));
  }
}

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

/** A category's lines counted in the program's unit of measure: each box is 1, pieces in boxes. */
function countedQty(
  countUomId: number | null,
  members: readonly number[],
  lines: readonly QuoteLineInput[],
  context: QuoteContext,
): Decimal {
  let counted = ZERO;
  for (const index of members) {
    const line = lines[index];
    if (!line) continue;
    const unit = context.products
      .get(line.productId)
      ?.units.find((candidate) => candidate.uomId === countUomId);
    // A product without a unit of that measure does not count towards the threshold.
    if (unit) counted = counted.plus(line.qtyBase.div(unit.factor));
  }
  return counted;
}

function amountOf(members: readonly number[], states: readonly (LineState | null)[]): Decimal {
  return members.reduce((sum, index) => sum.plus(states[index]?.amount ?? ZERO), ZERO);
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

const EFFECT_ORDER: Record<DiscountEffect, number> = { PRICE: 0, PERCENT: 1, AMOUNT: 2 };

/** A stage's programs in application order: PRICE, PERCENT, AMOUNT, each by id. */
function stageOrder(programs: readonly QuoteProgram[], scope: DiscountScope): QuoteProgram[] {
  return programs
    .filter((program) => program.scope === scope)
    .sort((a, b) => EFFECT_ORDER[a.effect] - EFFECT_ORDER[b.effect] || a.id - b.id);
}

function appliedOf(
  program: QuoteProgram,
  step: DiscountStep,
  amount: Decimal | null,
): AppliedDiscount {
  return {
    programId: program.id,
    name: program.name,
    scope: program.scope,
    effect: program.effect,
    threshold: step.threshold,
    value: step.value,
    amount,
  };
}
