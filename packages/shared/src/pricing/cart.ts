import { Decimal, roundHalfUp } from '../money';
import {
  type AppliedDiscount,
  allocate,
  type DiscountEffect,
  type DiscountScope,
  type DiscountStep,
  type PriceList,
  type QuoteProgram,
  reachedStep,
} from './discounts';
import { type PerBasePrices, perBasePrices, type PriceProfileValues, unitPriceOf } from './profile';

/**
 * The quote (ADR-0041 #3, ADR-0048 #3–#4), pure: the api fetches the price terms, the profile
 * versions and the programs in force on a date and passes them in; the web shows the explanation.
 * A line is priced in parts — whole packs at the warehouse price and the loose rest in the
 * WHOLESALE channel, the supermarket price (or its bulk price) in RETAIL — and the discount
 * programs then apply to the parts.
 */

export interface QuoteUnit {
  unitId: number;
  uomId: number;
  factor: Decimal;
  isBase: boolean;
}

/** A product's price terms in force on the quote date. */
export interface QuoteTerms {
  /** Per base unit, whole MNT, VAT included. */
  warehousePrice: Decimal;
  /** The unit of measure counted as a whole pack; null for a product without packs. */
  wholeUomId: number | null;
  profile: PriceProfileValues;
}

export interface QuoteProduct {
  categoryId: number;
  /** The product's current units. */
  units: readonly QuoteUnit[];
  /** Null without price terms or a profile version on the date: its lines are PRICE_MISSING. */
  terms: QuoteTerms | null;
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
  /** WHOLESALE splits whole packs from loose pieces; RETAIL is the supermarket. */
  list: PriceList;
  products: ReadonlyMap<number, QuoteProduct>;
  /** Programs in force on the quote date in the quoted channel. */
  programs: readonly QuoteProgram[];
}

/**
 * What a part is charged on: WAREHOUSE, whole packs (or a product without packs); LOOSE, the
 * pieces that do not fill one; RETAIL and RETAIL_BULK, the supermarket's two prices.
 */
export const PRICE_BASES = ['WAREHOUSE', 'LOOSE', 'RETAIL', 'RETAIL_BULK'] as const;
export type PriceBasis = (typeof PRICE_BASES)[number];

/** A part of a line: a unit, a quantity in it and the basis it is charged on. */
export interface LinePart {
  unitId: number;
  qty: Decimal;
  qtyBase: Decimal;
  basis: PriceBasis;
}

export interface PricedPart extends LinePart {
  /** The basis' price of one unit, whole MNT. */
  listPrice: Decimal;
  /** After the product's own discounts, whole MNT. */
  unitPrice: Decimal;
  /** unitPrice × qty, whole MNT. */
  subtotal: Decimal;
  /** Taken off by category and order programs, whole MNT. */
  discountAmount: Decimal;
  total: Decimal;
  applied: AppliedDiscount[];
}

export interface PricedLine {
  priced: true;
  parts: PricedPart[];
  /** Sums of the parts. */
  subtotal: Decimal;
  discountAmount: Decimal;
  total: Decimal;
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

/**
 * WHOLESALE: a line's base quantity in whole packs of the whole unit and the loose rest.
 * - Without a whole unit: one WAREHOUSE part, as entered.
 * - Whole packs only: one WAREHOUSE part, as entered when the line's unit is the whole unit or a
 *   multiple of it, else in whole units (40 pieces with a box of 20 are 2 boxes).
 * - Otherwise the whole packs, if any, in the whole unit, and the rest LOOSE: in the line's unit
 *   when it divides evenly, else in base units. 25 pieces: 1 box + 5 pieces; 3 blocks of 10 with
 *   a box of 20: 1 box + 1 block; a box of 24 with a block of 10 as the whole unit: 2 blocks + 4
 *   pieces.
 */
export function splitWholesale(
  line: { unit: QuoteUnit; qty: Decimal; qtyBase: Decimal },
  whole: QuoteUnit | null,
  base: QuoteUnit,
): LinePart[] {
  const asEntered = (basis: PriceBasis): LinePart => ({
    unitId: line.unit.unitId,
    qty: line.qty,
    qtyBase: line.qtyBase,
    basis,
  });
  if (!whole) return [asEntered('WAREHOUSE')];
  const packs = line.qtyBase.dividedToIntegerBy(whole.factor);
  const rest = line.qtyBase.minus(packs.times(whole.factor));
  if (rest.isZero()) {
    return line.unit.factor.mod(whole.factor).isZero()
      ? [asEntered('WAREHOUSE')]
      : [{ unitId: whole.unitId, qty: packs, qtyBase: line.qtyBase, basis: 'WAREHOUSE' }];
  }
  if (packs.isZero()) return [asEntered('LOOSE')];
  const restInLineUnit = rest.dividedBy(line.unit.factor);
  return [
    { unitId: whole.unitId, qty: packs, qtyBase: packs.times(whole.factor), basis: 'WAREHOUSE' },
    restInLineUnit.isInteger()
      ? { unitId: line.unit.unitId, qty: restInLineUnit, qtyBase: rest, basis: 'LOOSE' }
      : { unitId: base.unitId, qty: rest, qtyBase: rest, basis: 'LOOSE' },
  ];
}

/** The product's current unit of its whole pack, or null (no packs, or the pack is gone). */
export function wholeUnitOf(
  units: readonly QuoteUnit[],
  wholeUomId: number | null,
): QuoteUnit | null {
  if (wholeUomId === null) return null;
  return units.find((unit) => !unit.isBase && unit.uomId === wholeUomId) ?? null;
}

/** One unit of every current unit on each channel: the price card and the dialog's preview. */
export interface UnitPrices {
  unitId: number;
  /** WHOLESALE, one unit split as a quote would split it. */
  wholesale: Decimal;
  /** WAREHOUSE: a whole pack (or a multiple, or no packs); LOOSE: less than one; MIXED: both. */
  wholesaleBasis: 'WAREHOUSE' | 'LOOSE' | 'MIXED';
  retail: Decimal;
  retailBulk: Decimal | null;
}

export function unitPriceTable(terms: QuoteTerms, units: readonly QuoteUnit[]): UnitPrices[] {
  const base = units.find((unit) => unit.isBase);
  if (!base) return [];
  const prices = perBasePrices(terms.warehousePrice, terms.profile);
  const whole = wholeUnitOf(units, terms.wholeUomId);
  return units.map((unit) => {
    const parts = splitWholesale({ unit, qty: new Decimal(1), qtyBase: unit.factor }, whole, base);
    const wholesale = parts.reduce((sum, part) => {
      const partUnit = units.find((candidate) => candidate.unitId === part.unitId) ?? base;
      return sum.plus(
        roundHalfUp(
          unitPriceOf(basisPrice(prices, part.basis), partUnit.factor).times(part.qty),
          0,
        ),
      );
    }, ZERO);
    const bases = new Set(parts.map((part) => part.basis));
    return {
      unitId: unit.unitId,
      wholesale,
      wholesaleBasis: bases.size > 1 ? 'MIXED' : bases.has('LOOSE') ? 'LOOSE' : 'WAREHOUSE',
      retail: unitPriceOf(prices.retail, unit.factor),
      retailBulk: prices.retailBulk === null ? null : unitPriceOf(prices.retailBulk, unit.factor),
    };
  });
}

function basisPrice(prices: PerBasePrices, basis: PriceBasis): Decimal {
  switch (basis) {
    case 'WAREHOUSE':
      return prices.warehouse;
    case 'LOOSE':
      return prices.loose;
    case 'RETAIL':
      return prices.retail;
    case 'RETAIL_BULK':
      return prices.retailBulk ?? prices.retail;
  }
}

interface PartState {
  part: LinePart;
  productId: number;
  listPrice: Decimal;
  unitPrice: Decimal;
  subtotal: Decimal;
  /** The part's amount so far, whole MNT. */
  amount: Decimal;
  applied: AppliedDiscount[];
}

/**
 * Prices a cart. In order:
 * 1. each line's parts and their list prices (above);
 * 2. the product's programs on each part, reached by the product's quantity in the whole cart (base
 *    units): a program for a unit reaches only the parts in that unit, a percentage without a unit
 *    every part; PRICE (never above the price so far), then PERCENT, then AMOUNT per unit, then the
 *    unit price rounded to whole MNT and the part's subtotal = unit price × quantity (whole MNT);
 * 3. category programs, reached by the boxes counted or the amount of the category's parts after
 *    step 2; a percentage comes off each part (whole MNT), an amount is split over the parts in
 *    proportion to their amounts;
 * 4. order programs, reached by the cart's amount after step 3, applied the same way.
 * Within a stage every program is measured on the stage's starting amounts, then PERCENT programs
 * and AMOUNT programs apply in that order, each by id. A line without price terms is left out of
 * the amounts but its quantity still counts.
 */
export function resolveQuote(lines: readonly QuoteLineInput[], context: QuoteContext): QuoteResult {
  const productQty = new Map<number, Decimal>();
  for (const line of lines) {
    productQty.set(line.productId, (productQty.get(line.productId) ?? ZERO).plus(line.qtyBase));
  }
  const states = lines.map((line) =>
    priceParts(line, context, productQty.get(line.productId) ?? ZERO),
  );
  const partsOf = (indexes: readonly number[]) => indexes.flatMap((index) => states[index] ?? []);

  const reachedInCategories = stageOrder(context.programs, 'CATEGORY').map((program) => {
    const members = lines.flatMap((line, index) =>
      program.categoryIds?.has(context.products.get(line.productId)?.categoryId ?? -1)
        ? [index]
        : [],
    );
    const measured =
      program.measure === 'QTY'
        ? countedQty(program.countUomId, members, lines, context)
        : amountOf(partsOf(members));
    return { program, parts: partsOf(members), step: reachedStep(program.steps, measured) };
  });
  for (const { program, parts, step } of reachedInCategories) {
    if (step) applyToAmounts(program, step, parts);
  }

  const everyPart = states.flatMap((parts) => parts ?? []);
  const orderAmount = amountOf(everyPart);
  for (const program of stageOrder(context.programs, 'ORDER')) {
    const step = reachedStep(program.steps, orderAmount);
    if (step) applyToAmounts(program, step, everyPart);
  }

  let subtotal = ZERO;
  let total = ZERO;
  const results = states.map((parts): QuoteLineResult => {
    if (!parts) return { priced: false, problem: 'PRICE_MISSING' };
    const priced = parts.map((state): PricedPart => ({
      ...state.part,
      listPrice: state.listPrice,
      unitPrice: state.unitPrice,
      subtotal: state.subtotal,
      discountAmount: state.subtotal.minus(state.amount),
      total: state.amount,
      applied: state.applied,
    }));
    const lineSubtotal = priced.reduce((sum, part) => sum.plus(part.subtotal), ZERO);
    const lineTotal = priced.reduce((sum, part) => sum.plus(part.total), ZERO);
    subtotal = subtotal.plus(lineSubtotal);
    total = total.plus(lineTotal);
    return {
      priced: true,
      parts: priced,
      subtotal: lineSubtotal,
      discountAmount: lineSubtotal.minus(lineTotal),
      total: lineTotal,
    };
  });
  return { lines: results, subtotal, discountTotal: subtotal.minus(total), total };
}

/** Steps 1–2 for one line: its parts, their list prices and the product's own programs. */
function priceParts(
  line: QuoteLineInput,
  context: QuoteContext,
  productQty: Decimal,
): PartState[] | null {
  const product = context.products.get(line.productId);
  const unit = product?.units.find((candidate) => candidate.unitId === line.unitId);
  const base = product?.units.find((candidate) => candidate.isBase);
  if (!product?.terms || !unit || !base) return null;
  const { terms } = product;
  const prices = perBasePrices(terms.warehousePrice, terms.profile);
  const bulkFrom = terms.profile.retailBulkMinQty;
  const parts =
    context.list === 'WHOLESALE'
      ? splitWholesale(
          { unit, qty: line.qty, qtyBase: line.qtyBase },
          wholeUnitOf(product.units, terms.wholeUomId),
          base,
        )
      : [
          {
            unitId: unit.unitId,
            qty: line.qty,
            qtyBase: line.qtyBase,
            basis:
              prices.retailBulk !== null && bulkFrom !== null && productQty.gte(bulkFrom)
                ? ('RETAIL_BULK' as const)
                : ('RETAIL' as const),
          },
        ];
  const programs = stageOrder(context.programs, 'PRODUCT').filter(
    (program) => program.productId === line.productId,
  );
  return parts.map((part) => {
    const partUnit = product.units.find((candidate) => candidate.unitId === part.unitId) ?? base;
    const listPrice = unitPriceOf(basisPrice(prices, part.basis), partUnit.factor);
    let price = listPrice;
    const applied: AppliedDiscount[] = [];
    for (const program of programs) {
      if (program.productUnitId !== null && program.productUnitId !== part.unitId) continue;
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
    const subtotal = roundHalfUp(unitPrice.times(part.qty), 0);
    return {
      part,
      productId: line.productId,
      listPrice,
      unitPrice,
      subtotal,
      amount: subtotal,
      applied,
    };
  });
}

/** Steps 3–4: one category or order program on the amounts of its parts. */
function applyToAmounts(
  program: QuoteProgram,
  step: DiscountStep,
  members: readonly PartState[],
): void {
  const priced = members.filter((state) => state.amount.gt(0));
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

function amountOf(members: readonly PartState[]): Decimal {
  return members.reduce((sum, state) => sum.plus(state.amount), ZERO);
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
