import { Decimal, roundHalfUp } from '../money';

/**
 * Price profiles (ADR-0048): one warehouse price per product, per base unit, and a named profile
 * that derives the other prices from it — the loose price of pieces that do not fill a whole pack,
 * the supermarket price and, from a quantity on, the supermarket's bulk price — each rounded as the
 * profile says. The api, the web's previews and the `ai` views compute them the same way.
 */

/** WHOLE: HALF_UP to whole tugriks; UP_n: up to the next multiple of n tugriks. */
export const PRICE_ROUNDINGS = ['WHOLE', 'UP_10', 'UP_50', 'UP_100'] as const;
export type PriceRounding = (typeof PRICE_ROUNDINGS)[number];

const ROUNDING_STEPS: Record<Exclude<PriceRounding, 'WHOLE'>, number> = {
  UP_10: 10,
  UP_50: 50,
  UP_100: 100,
};

/** A profile version's values, in force on a day. */
export interface PriceProfileValues {
  /** Added to the warehouse price for pieces that do not fill a whole pack (WHOLESALE). */
  looseMarkupPct: Decimal;
  /** Added to the warehouse price at the supermarket (RETAIL). */
  retailMarkupPct: Decimal;
  /** Base units of a product in a supermarket cart from which the bulk markup applies; null: none. */
  retailBulkMinQty: Decimal | null;
  /** Below the retail markup; null exactly when `retailBulkMinQty` is. */
  retailBulkMarkupPct: Decimal | null;
  rounding: PriceRounding;
}

/** NUMERIC(5,2) percentages and NUMERIC(14,3) quantities. */
export const MAX_MARKUP_PCT = new Decimal('999.99');
const MAX_QTY = new Decimal('99999999999.999');
const HUNDRED = new Decimal(100);

export type PriceProfileIssue =
  'PERCENT_RANGE' | 'BULK_PAIR' | 'BULK_QTY_RANGE' | 'BULK_NOT_BELOW_RETAIL';

const percentOk = (value: Decimal) =>
  !value.isNeg() && value.lte(MAX_MARKUP_PCT) && value.decimalPlaces() <= 2;

/**
 * Why a profile's values are not allowed, with the field at fault, or null. The database checks
 * the same rules (the CHECKs of `price_profile_versions`); the api and the web form explain them.
 */
export function priceProfileIssue(
  values: PriceProfileValues,
): { issue: PriceProfileIssue; field: keyof PriceProfileValues } | null {
  if (!percentOk(values.looseMarkupPct)) {
    return { issue: 'PERCENT_RANGE', field: 'looseMarkupPct' };
  }
  if (!percentOk(values.retailMarkupPct)) {
    return { issue: 'PERCENT_RANGE', field: 'retailMarkupPct' };
  }
  const { retailBulkMinQty: qty, retailBulkMarkupPct: pct } = values;
  if ((qty === null) !== (pct === null)) {
    return { issue: 'BULK_PAIR', field: qty === null ? 'retailBulkMinQty' : 'retailBulkMarkupPct' };
  }
  if (qty !== null && (!qty.gt(0) || qty.gt(MAX_QTY) || qty.decimalPlaces() > 3)) {
    return { issue: 'BULK_QTY_RANGE', field: 'retailBulkMinQty' };
  }
  if (pct !== null) {
    if (!percentOk(pct)) return { issue: 'PERCENT_RANGE', field: 'retailBulkMarkupPct' };
    if (!pct.lt(values.retailMarkupPct)) {
      return { issue: 'BULK_NOT_BELOW_RETAIL', field: 'retailBulkMarkupPct' };
    }
  }
  return null;
}

/** A derived price rounded as the profile says (ADR-0048 #3). */
export function roundPrice(value: Decimal, rounding: PriceRounding): Decimal {
  if (rounding === 'WHOLE') return roundHalfUp(value, 0);
  const step = ROUNDING_STEPS[rounding];
  return value.dividedBy(step).ceil().times(step);
}

/** The warehouse price with a markup, rounded: W × (100 + pct) / 100. */
export function markedUp(warehousePrice: Decimal, pct: Decimal, rounding: PriceRounding): Decimal {
  return roundPrice(warehousePrice.times(HUNDRED.plus(pct)).dividedBy(HUNDRED), rounding);
}

/** What one base unit costs on each basis, whole MNT. */
export interface PerBasePrices {
  /** WHOLESALE in whole packs, or a product without packs. */
  warehouse: Decimal;
  /** WHOLESALE, the pieces that do not fill a whole pack. */
  loose: Decimal;
  /** RETAIL. */
  retail: Decimal;
  /** RETAIL from the profile's quantity on; null without one. */
  retailBulk: Decimal | null;
}

export function perBasePrices(warehousePrice: Decimal, profile: PriceProfileValues): PerBasePrices {
  return {
    warehouse: warehousePrice,
    loose: markedUp(warehousePrice, profile.looseMarkupPct, profile.rounding),
    retail: markedUp(warehousePrice, profile.retailMarkupPct, profile.rounding),
    retailBulk:
      profile.retailBulkMarkupPct === null
        ? null
        : markedUp(warehousePrice, profile.retailBulkMarkupPct, profile.rounding),
  };
}

/** A unit's price from a base unit's: × factor, HALF_UP to whole MNT. */
export function unitPriceOf(perBase: Decimal, factor: Decimal): Decimal {
  return roundHalfUp(perBase.times(factor), 0);
}

/** A product's current unit, as far as choosing its whole pack goes. */
export interface PackUnit {
  uomId: number;
  /** The system unit of measure's code (BOX, BLOCK …); null for a custom one. */
  uomCode: string | null;
  isBase: boolean;
}

/**
 * Why a product's whole unit does not work (ADR-0048 #2): NOT_CHOSEN, the product has pack units
 * but none was chosen; GONE, the chosen unit of measure is not one of its current pack units
 * (retired, or never one of them). Null when it works, also for a product without packs.
 */
export type WholeUnitProblem = 'NOT_CHOSEN' | 'GONE';

export function wholeUnitProblem(
  units: readonly PackUnit[],
  wholeUomId: number | null,
): WholeUnitProblem | null {
  const packs = units.filter((unit) => !unit.isBase);
  if (wholeUomId === null) return packs.length > 0 ? 'NOT_CHOSEN' : null;
  return packs.some((unit) => unit.uomId === wholeUomId) ? null : 'GONE';
}

/** The whole unit the price dialog proposes: the box, else the only pack unit, else none. */
export function defaultWholeUomId(units: readonly PackUnit[]): number | null {
  const packs = units.filter((unit) => !unit.isBase);
  const box = packs.find((unit) => unit.uomCode === 'BOX');
  if (box) return box.uomId;
  return packs.length === 1 ? (packs[0]?.uomId ?? null) : null;
}
