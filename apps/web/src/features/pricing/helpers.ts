import { Decimal } from '@tugeel/shared/money';
import {
  type DiscountEffect,
  type DiscountMeasure,
  type DiscountScope,
  discountShapeIssue,
  type DiscountShapeIssue,
  discountStepsIssue,
  type DiscountStepsIssue,
  type PriceAdjust,
  priceAdjustIssue,
  type ProgramApplyType,
  type ProgramList,
  type ProgramState,
  type StepRule,
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

export interface StepDraft {
  rule: StepRule;
  threshold: string;
  value: string;
}

export const emptyStep = (): StepDraft => ({ rule: 'MINIMUM', threshold: '', value: '' });

/** The program form as typed (ADR-0159). */
export interface ProgramDraft {
  name: string;
  state: ProgramState;
  priority: boolean;
  /** What it applies to; its ids, except the whole order. */
  apply: ProgramApplyType;
  targetIds: number[];
  excludeTargetIds: number[];
  excludeProductIds: number[];
  /** The products counted and discounted together, not each on its own. */
  together: boolean;
  measure: DiscountMeasure;
  effect: DiscountEffect;
  productUnitId: number | null;
  thresholdUnitId: number | null;
  /** The factor and name of the unit thresholds are typed in (one product). */
  thresholdFactor: string;
  thresholdUnitName: string;
  countUomId: number | null;
  adjustKind: PriceAdjust;
  adjustFactor: string;
  /** Where it serves: the wholesale channel on these pipelines, the tills (empty: all). */
  wholesale: boolean;
  retail: boolean;
  pipelineIds: number[];
  tillIds: number[];
  validFrom: string;
  /** The last day, inclusive; empty for no end. */
  lastDay: string;
  /** With condition rows, or one value that always applies. */
  conditioned: boolean;
  value: string;
  bonusBuy: string;
  bonusFree: string;
  steps: StepDraft[];
}

export function scopeOf(draft: Pick<ProgramDraft, 'apply' | 'together'>): DiscountScope {
  if (draft.apply === 'ORDER') return 'ORDER';
  return draft.together ? 'CATEGORY' : 'PRODUCT';
}

/** One product counted on its own: its units can be chosen. */
export function isOneProduct(draft: ProgramDraft): boolean {
  return draft.apply === 'PRODUCT' && !draft.together && draft.targetIds.length === 1;
}

/** A rounding has a unit price to work on: each product on its own, and not N+M. */
export function canRound(draft: Pick<ProgramDraft, 'apply' | 'together' | 'effect'>): boolean {
  return scopeOf(draft) === 'PRODUCT' && draft.effect !== 'BONUS';
}

function listOf(draft: ProgramDraft): ProgramList {
  if (draft.wholesale && draft.retail) return 'ALL';
  return draft.retail ? 'RETAIL' : 'WHOLESALE';
}

const measureOf = (draft: ProgramDraft): DiscountMeasure => {
  if (draft.effect === 'BONUS') return 'QTY';
  const scope = scopeOf(draft);
  if (scope === 'ORDER') return 'AMOUNT';
  if (!draft.conditioned) return scope === 'PRODUCT' ? 'QTY' : 'AMOUNT';
  return draft.measure;
};

/** The steps as the API stores them: product quantities in base units. */
export function canonicalSteps(
  draft: ProgramDraft,
): { threshold: string; value: string; rule?: StepRule }[] {
  const factor = isOneProduct(draft) ? draft.thresholdFactor : '1';
  if (draft.effect === 'BONUS') {
    return [
      {
        threshold: toBaseQty(draft.bonusBuy, factor),
        value: toBaseQty(draft.bonusFree, factor),
      },
    ];
  }
  if (!draft.conditioned) return [{ threshold: '0', value: draft.value }];
  const inBase = scopeOf(draft) === 'PRODUCT' && measureOf(draft) === 'QTY';
  return draft.steps.map((step) => ({
    threshold: inBase ? toBaseQty(step.threshold, factor) : step.threshold,
    value: step.value,
    ...(step.rule === 'MINIMUM' ? {} : { rule: step.rule }),
  }));
}

/** The request body of a valid draft. */
export function programBody(draft: ProgramDraft) {
  const scope = scopeOf(draft);
  const measure = measureOf(draft);
  // One product keeps its unit; without one, a new price or tugriks are per base unit, as in a set.
  const single =
    isOneProduct(draft) &&
    (draft.effect === 'PERCENT' || draft.effect === 'BONUS' || draft.productUnitId !== null);
  const excludes = draft.excludeTargetIds.length + draft.excludeProductIds.length;
  const category =
    draft.apply === 'CATEGORY' && scope === 'CATEGORY' && draft.targetIds.length === 1 && !excludes;
  const targeted = draft.apply !== 'ORDER' && !single && !category;
  const rounded = canRound(draft) && draft.adjustKind !== 'NONE';
  return {
    name: draft.name.trim(),
    list: listOf(draft),
    state: draft.state,
    priority: scope === 'PRODUCT' && draft.priority,
    scope,
    measure,
    effect: draft.effect,
    productId: single ? (draft.targetIds[0] ?? null) : null,
    productUnitId: single && draft.effect !== 'BONUS' ? draft.productUnitId : null,
    thresholdUnitId: single ? draft.thresholdUnitId : null,
    categoryId: category ? (draft.targetIds[0] ?? null) : null,
    countUomId: scope === 'CATEGORY' && measure === 'QTY' ? draft.countUomId : null,
    targetKind: targeted && draft.apply !== 'ORDER' ? draft.apply : null,
    targetIds: targeted ? draft.targetIds : [],
    excludeTargetIds: targeted && draft.apply !== 'PRODUCT' ? draft.excludeTargetIds : [],
    excludeProductIds: targeted && draft.apply !== 'PRODUCT' ? draft.excludeProductIds : [],
    adjustKind: rounded ? draft.adjustKind : 'NONE',
    adjustFactor: rounded ? Number.parseInt(draft.adjustFactor, 10) : 1,
    pipelineIds: draft.wholesale ? draft.pipelineIds : [],
    tillIds: draft.retail ? draft.tillIds : [],
    validFrom: draft.validFrom,
    validTo: draft.lastDay === '' ? null : validToOf(draft.lastDay),
    steps: canonicalSteps(draft),
  };
}

export type DraftIssue =
  | DiscountShapeIssue
  | DiscountStepsIssue
  | 'NAME_REQUIRED'
  | 'DATES'
  | 'SUPPLIER_REQUIRED'
  | 'SEGMENT_REQUIRED'
  | 'PLACE_REQUIRED'
  | 'VALUE_REQUIRED'
  | 'BONUS_REQUIRED'
  | 'ADJUST_FACTOR';

const TARGET_ISSUES: Record<Exclude<ProgramApplyType, 'ORDER'>, DraftIssue> = {
  PRODUCT: 'PRODUCT_REQUIRED',
  CATEGORY: 'CATEGORY_REQUIRED',
  SUPPLIER: 'SUPPLIER_REQUIRED',
  SEGMENT: 'SEGMENT_REQUIRED',
};

/**
 * The first problem of a draft, with the step's number when a step is wrong, or null. The same
 * shape and step rules as the API (@tugeel/shared/pricing).
 */
export function draftIssue(draft: ProgramDraft): { issue: DraftIssue; step?: number } | null {
  if (draft.name.trim() === '') return { issue: 'NAME_REQUIRED' };
  if (draft.apply !== 'ORDER' && draft.targetIds.length === 0) {
    return { issue: TARGET_ISSUES[draft.apply] };
  }
  if (draft.effect === 'BONUS') {
    if (
      !THRESHOLD.test(draft.bonusBuy) ||
      !STEP_VALUE.test(draft.bonusFree) ||
      new Decimal(draft.bonusBuy).isZero() ||
      new Decimal(draft.bonusFree).isZero()
    ) {
      return { issue: 'BONUS_REQUIRED' };
    }
  } else if (!draft.conditioned) {
    if (!STEP_VALUE.test(draft.value)) return { issue: 'VALUE_REQUIRED' };
  } else {
    for (const [index, step] of draft.steps.entries()) {
      if (!THRESHOLD.test(step.threshold)) return { issue: 'THRESHOLD_RANGE', step: index + 1 };
      if (!STEP_VALUE.test(step.value)) return { issue: 'VALUE_RANGE', step: index + 1 };
    }
  }
  const body = programBody(draft);
  const shape = discountShapeIssue(body);
  if (shape) return { issue: shape };
  const steps = body.steps.map((step) => ({
    threshold: new Decimal(step.threshold),
    value: new Decimal(step.value),
    ...(step.rule ? { rule: step.rule } : {}),
  }));
  const stepsIssue = discountStepsIssue(draft.effect, steps);
  if (stepsIssue) {
    // One value that always applies has no steps to number.
    if (!draft.conditioned && draft.effect !== 'BONUS') return { issue: 'VALUE_REQUIRED' };
    return stepsIssue.index === null
      ? { issue: stepsIssue.issue }
      : { issue: stepsIssue.issue, step: stepsIssue.index + 1 };
  }
  if (priceAdjustIssue(body.adjustKind, new Decimal(body.adjustFactor))) {
    return { issue: 'ADJUST_FACTOR' };
  }
  if (draft.lastDay !== '' && draft.lastDay < draft.validFrom) return { issue: 'DATES' };
  if (!draft.wholesale && !draft.retail) return { issue: 'PLACE_REQUIRED' };
  return null;
}

/** How «ends in 9» reads at each factor. */
export function nineFactorKey(factor: string) {
  if (factor === '1000') return 'pricing.programs.nineFactors.1000' as const;
  return factor === '100'
    ? ('pricing.programs.nineFactors.100' as const)
    : ('pricing.programs.nineFactors.10' as const);
}

/** The effects a scope allows: a new price and N+M need each product on its own. */
export function effectsFor(scope: DiscountScope): DiscountEffect[] {
  return scope === 'PRODUCT' ? ['PERCENT', 'AMOUNT', 'PRICE', 'BONUS'] : ['PERCENT', 'AMOUNT'];
}
