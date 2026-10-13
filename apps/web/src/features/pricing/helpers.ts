import { Decimal } from '@tugeel/shared/money';
import {
  type DiscountEffect,
  type DiscountMeasure,
  type DiscountScope,
  discountShapeIssue,
  type DiscountShapeIssue,
  discountStepsIssue,
  type DiscountStepsIssue,
} from '@tugeel/shared/pricing';
import { addDays } from '@tugeel/shared/time';

/** Whole tugriks typed in a price field. */
export const WHOLE_MNT = /^[1-9]\d{0,11}$/;
/** A threshold as typed: up to three decimals. */
export const THRESHOLD = /^\d{1,11}(\.\d{1,3})?$/;
/** A step value as typed: up to two decimals. */
export const STEP_VALUE = /^\d{1,12}(\.\d{1,2})?$/;

/** Product quantity thresholds are stored in base units, typed in a unit of the product. */
export function toBaseQty(typed: string, factor: string): string {
  return new Decimal(typed).times(factor).toString();
}

export function fromBaseQty(stored: string, factor: string): string {
  return new Decimal(stored).div(factor).toDecimalPlaces(3).toString();
}

/** The API's `validTo` is exclusive; people read and type the last day. */
export function lastDayOf(validTo: string): string {
  return addDays(validTo, -1);
}

export function validToOf(lastDay: string): string {
  return addDays(lastDay, 1);
}

/** The program form as typed. */
export interface ProgramDraft {
  name: string;
  list: 'WHOLESALE' | 'RETAIL';
  scope: DiscountScope;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productId: number | null;
  productUnitId: number | null;
  thresholdUnitId: number | null;
  /** The factor and name of the unit thresholds are typed in (product programs). */
  thresholdFactor: string;
  thresholdUnitName: string;
  categoryId: number | null;
  countUomId: number | null;
  validFrom: string;
  /** The last day, inclusive; empty for no end. */
  lastDay: string;
  steps: { threshold: string; value: string }[];
}

export type DraftIssue = DiscountShapeIssue | DiscountStepsIssue | 'NAME_REQUIRED' | 'DATES';

/**
 * The first problem of a draft, with the step's number when a step is wrong, or null. The same
 * shape and step rules as the API (@tugeel/shared/pricing).
 */
export function draftIssue(draft: ProgramDraft): { issue: DraftIssue; step?: number } | null {
  if (draft.name.trim() === '') return { issue: 'NAME_REQUIRED' };
  const shape = discountShapeIssue(draft);
  if (shape) return { issue: shape };
  for (const [index, step] of draft.steps.entries()) {
    if (!THRESHOLD.test(step.threshold)) return { issue: 'THRESHOLD_RANGE', step: index + 1 };
    if (!STEP_VALUE.test(step.value)) return { issue: 'VALUE_RANGE', step: index + 1 };
  }
  const steps = canonicalSteps(draft).map((step) => ({
    threshold: new Decimal(step.threshold),
    value: new Decimal(step.value),
  }));
  const stepsIssue = discountStepsIssue(draft.effect, steps);
  if (stepsIssue) {
    return stepsIssue.index === null
      ? { issue: stepsIssue.issue }
      : { issue: stepsIssue.issue, step: stepsIssue.index + 1 };
  }
  if (draft.lastDay !== '' && draft.lastDay < draft.validFrom) return { issue: 'DATES' };
  return null;
}

/** The steps as the API stores them: product quantities in base units. */
export function canonicalSteps(draft: ProgramDraft): { threshold: string; value: string }[] {
  const inBase = draft.scope === 'PRODUCT' && draft.measure === 'QTY';
  return draft.steps.map((step) => ({
    threshold: inBase ? toBaseQty(step.threshold, draft.thresholdFactor) : step.threshold,
    value: step.value,
  }));
}

/** The request body of a valid draft. */
export function programBody(draft: ProgramDraft) {
  const product = draft.scope === 'PRODUCT';
  return {
    name: draft.name.trim(),
    list: draft.list,
    scope: draft.scope,
    measure: draft.measure,
    effect: draft.effect,
    productId: product ? draft.productId : null,
    productUnitId: product ? draft.productUnitId : null,
    thresholdUnitId: product ? draft.thresholdUnitId : null,
    categoryId: draft.scope === 'CATEGORY' ? draft.categoryId : null,
    countUomId: draft.scope === 'CATEGORY' && draft.measure === 'QTY' ? draft.countUomId : null,
    validFrom: draft.validFrom,
    validTo: draft.lastDay === '' ? null : validToOf(draft.lastDay),
    steps: canonicalSteps(draft),
  };
}

/** The measure a scope allows; a category lets the person choose. */
export function measureFor(scope: DiscountScope, chosen: DiscountMeasure): DiscountMeasure {
  if (scope === 'PRODUCT') return 'QTY';
  if (scope === 'ORDER') return 'AMOUNT';
  return chosen;
}

/** The effects a scope allows: a new price is for a product's unit only. */
export function effectsFor(scope: DiscountScope): DiscountEffect[] {
  return scope === 'PRODUCT' ? ['PRICE', 'PERCENT', 'AMOUNT'] : ['PERCENT', 'AMOUNT'];
}
