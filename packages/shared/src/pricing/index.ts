import { Decimal, roundHalfUp } from '../money';
import {
  type AppliedDiscount,
  allocate,
  type DiscountEffect,
  type DiscountScope,
  type DiscountStep,
  type QuoteProgram,
  reachedStep,
} from './discounts';

/**
 * Pricing (ADR-0041): one price for every customer per list, effective-dated unit prices, and
 * discount programs that all stack in a fixed order. The resolver below is pure: the api fetches
 * the prices and programs in force on a date and passes them in; the web shows its explanation.
 */

export * from './discounts';
export * from './profile';

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

export interface QuoteContext {
  products: ReadonlyMap<number, QuoteProduct>;
  /** Unit prices in force on the quote date in the quoted list, by unit id. */
  prices: ReadonlyMap<number, Decimal>;
  /** Programs in force on the quote date in the quoted list. */
  programs: readonly QuoteProgram[];
}

/** UNIT: the unit's own price; DERIVED: the base unit's price × the unit's factor. */
export type PriceSource = 'UNIT' | 'DERIVED';

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
