import { Decimal } from '../money';
import { addDays } from '../time';
import type { DiscountEffect, DiscountMeasure, DiscountScope, DiscountStep } from './discounts';

/**
 * What a product card says about the discount program behind it (ADR-0092 #3, ADR-0093): the
 * badge is built from the program's first step, a promotion is a program with an end date. The
 * badge only describes the program; the quote applies it. The label holds digits, ₮ and the
 * units' own names only — the app's sentences come from mn.json.
 */

/** PROMOTION: a program with an end date («Урамшуулал»); DISCOUNT: one without («Хямдралтай»). */
export const DEAL_KINDS = ['PROMOTION', 'DISCOUNT'] as const;
export type DealKind = (typeof DEAL_KINDS)[number];

/** A program's facts the badge needs, with its units already named. */
export interface DealProgram {
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  /** Exclusive end; null for a program without one. */
  validTo: string | null;
  /** Ascending thresholds. */
  steps: readonly DiscountStep[];
  /** PRODUCT: the product's base unit (thresholds are counted in base units). */
  baseUnitName?: string | null;
  /** PRODUCT: the unit its thresholds are shown in, when the admin chose one. */
  thresholdUnit?: { name: string; factor: Decimal } | null;
  /** CATEGORY QTY: the unit of measure counted. */
  countUnitName?: string | null;
  /** PRICE and AMOUNT on a product unit: that unit. */
  programUnit?: { name: string; factor: Decimal; isBase: boolean } | null;
}

/** A first step's condition, as the badge names it. */
export type DealThreshold = { qty: Decimal; unitName: string } | { amount: Decimal };

export interface DealFacts {
  kind: DealKind;
  effect: DiscountEffect;
  /** The first step's value: a percentage, tugriks off, or a new unit price. */
  value: Decimal;
  /** The first step's condition; null when it always applies (ADR-0092 #7: unconditional). */
  threshold: DealThreshold | null;
  /** PRICE and AMOUNT on a unit other than the base unit: that unit's name («/хайрцаг»). */
  perUnitName: string | null;
  /** A promotion's last day (the day before its exclusive end); null for a discount. */
  lastDay: string | null;
}

const ONE = new Decimal(1);
const HUNDRED = new Decimal(100);

/**
 * The first step as the badge reads it; null for a program without steps. A PRODUCT threshold of
 * at most one base unit always applies; it is shown in the chosen threshold unit when it is a
 * whole number of them, else in base units. A CATEGORY threshold of 0 always applies.
 */
export function dealOf(program: DealProgram): DealFacts | null {
  const first = program.steps[0];
  if (!first) return null;
  return {
    kind: program.validTo === null ? 'DISCOUNT' : 'PROMOTION',
    effect: program.effect,
    value: first.value,
    threshold: thresholdOf(program, first.threshold),
    perUnitName:
      program.effect !== 'PERCENT' && program.programUnit && !program.programUnit.isBase
        ? program.programUnit.name
        : null,
    lastDay: program.validTo === null ? null : addDays(program.validTo, -1),
  };
}

function thresholdOf(program: DealProgram, threshold: Decimal): DealThreshold | null {
  if (program.measure === 'AMOUNT') return threshold.isZero() ? null : { amount: threshold };
  if (program.scope === 'PRODUCT') {
    if (threshold.lte(ONE)) return null;
    const shown = program.thresholdUnit;
    if (shown) {
      const inUnit = threshold.div(shown.factor);
      if (inUnit.isInteger()) return { qty: inUnit, unitName: shown.name };
    }
    return { qty: threshold, unitName: program.baseUnitName ?? '' };
  }
  return threshold.isZero() ? null : { qty: threshold, unitName: program.countUnitName ?? '' };
}

/**
 * The badge: «10+ ш −5%», «20+ хайрцаг −3%», «−200₮», «−200₮/хайрцаг», «900₮», «50,000₮+ −3%»,
 * a promotion with its last day «−10% · 10/31».
 */
export function dealLabel(deal: DealFacts): string {
  const words: string[] = [];
  if (deal.threshold) {
    words.push(
      'qty' in deal.threshold
        ? `${plain(deal.threshold.qty)}+ ${deal.threshold.unitName}`.trimEnd()
        : `${grouped(deal.threshold.amount)}₮+`,
    );
  }
  let effect: string;
  switch (deal.effect) {
    case 'PERCENT':
      effect = `${MINUS}${plain(deal.value)}%`;
      break;
    case 'AMOUNT':
      effect = `${MINUS}${grouped(deal.value)}₮`;
      break;
    case 'PRICE':
      effect = `${grouped(deal.value)}₮`;
      break;
  }
  words.push(deal.perUnitName ? `${effect}/${deal.perUnitName}` : effect);
  const label = words.join(' ');
  return deal.lastDay
    ? `${label} · ${deal.lastDay.slice(5, 7)}/${deal.lastDay.slice(8, 10)}`
    : label;
}

/**
 * How much the first step takes off, in percent, for the «Хямдрал ихээр» order: a percentage as it
 * is; a new price or tugriks off against the program unit's price at `basePrice` per base unit
 * (the warehouse price); null when it cannot be told per product (a category's or the order's
 * tugriks off the total, or no price), which sorts last.
 */
export function dealPercent(program: DealProgram, basePrice: Decimal | null): Decimal | null {
  const first = program.steps[0];
  if (!first) return null;
  if (program.effect === 'PERCENT') return first.value;
  if (program.scope !== 'PRODUCT' || basePrice === null) return null;
  const unitPrice = basePrice.times(program.programUnit?.factor ?? ONE);
  if (!unitPrice.gt(0)) return null;
  const off = program.effect === 'PRICE' ? unitPrice.minus(first.value) : first.value;
  return Decimal.min(HUNDRED, Decimal.max(0, off.div(unitPrice).times(HUNDRED)));
}

/** The minus sign of the boards (U+2212), not a hyphen. */
const MINUS = String.fromCharCode(0x2212);

/** A quantity or percentage without trailing zeros: 10, 2.5. */
function plain(value: Decimal): string {
  return value.toString();
}

/** Whole tugriks with thousands separated by commas, as the app prints money: 500,000. */
function grouped(value: Decimal): string {
  const [whole = '0', fraction] = value.toFixed().split('.');
  const digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${digits}.${fraction}` : digits;
}
