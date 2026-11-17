import { Decimal, roundHalfUp } from '../money';

/**
 * Price profiles (ADR-0048): one warehouse price per product, per base unit, and a named profile
 * that derives the other prices from it — the loose price of pieces that do not fill a whole pack,
 * the supermarket price and, from a quantity on, the supermarket's bulk price — each rounded as the
 * profile says. The api, the web's previews and the `ai` views compute them the same way.
 */

/**
 * WHOLE: HALF_UP to whole tugriks; UP_n: up to the next multiple of n tugriks; DOWN_n (ADR-0207): up
 * to a whole tugrik, then down to a multiple of n — Erxes' «floor», which counts its percentages in
 * whole tugriks — and the whole tugrik itself when that leaves nothing.
 */
export const PRICE_ROUNDINGS = [
  'WHOLE',
  'UP_10',
  'UP_50',
  'UP_100',
  'DOWN_10',
  'DOWN_50',
  'DOWN_100',
] as const;
export type PriceRounding = (typeof PRICE_ROUNDINGS)[number];

const ROUNDING_STEPS: Record<Exclude<PriceRounding, 'WHOLE'>, number> = {
  UP_10: 10,
  UP_50: 50,
  UP_100: 100,
  DOWN_10: 10,
  DOWN_50: 50,
  DOWN_100: 100,
};

/**
 * A profile version's values, in force on a day. The fields ADR-0207 added are optional: left out,
 * they are what every profile was before it (no amount, one rounding, a bulk markup).
 */
export interface PriceProfileValues {
  /** Added to the warehouse price for pieces that do not fill a whole pack (WHOLESALE). */
  looseMarkupPct: Decimal;
  /** Added to the warehouse price at the supermarket (RETAIL). */
  retailMarkupPct: Decimal;
  /** Whole tugriks added at the supermarket after the percentage (ADR-0207); 0 by default. */
  retailMarkupAmount?: Decimal;
  /** Base units of a product in a supermarket cart from which the bulk price applies; null: none. */
  retailBulkMinQty: Decimal | null;
  /** The bulk price as a markup on the warehouse price, below the retail markup. */
  retailBulkMarkupPct: Decimal | null;
  /**
   * The bulk price as a percentage off the supermarket price (ADR-0207), in place of the markup.
   * With a threshold exactly one of the two is set; without one, neither.
   */
  retailBulkDiscountPct?: Decimal | null;
  /** The loose price's rounding, and the others' unless they have their own. */
  rounding: PriceRounding;
  /** The supermarket price's rounding (ADR-0207); null: `rounding`. */
  retailRounding?: PriceRounding | null;
  /** The bulk price's rounding (ADR-0207); null: the supermarket price's. Only with a threshold. */
  retailBulkRounding?: PriceRounding | null;
}

/** A profile's name: 1 to 80 characters (the CHECK of `price_profiles`). */
export const MAX_PRICE_PROFILE_NAME = 80;

/** NUMERIC(5,2) percentages and NUMERIC(14,3) quantities. */
export const MAX_MARKUP_PCT = new Decimal('999.99');
const MAX_QTY = new Decimal('99999999999.999');
const HUNDRED = new Decimal(100);
const ZERO = new Decimal(0);

/** NUMERIC(14,2) money, whole tugriks. */
const MAX_AMOUNT = new Decimal('999999999999');

export type PriceProfileIssue =
  | 'PERCENT_RANGE'
  | 'AMOUNT_RANGE'
  | 'BULK_PAIR'
  | 'BULK_QTY_RANGE'
  | 'BULK_NOT_BELOW_RETAIL'
  | 'BULK_DISCOUNT_RANGE'
  | 'BULK_ROUNDING_WITHOUT_BULK';

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
  const amount = values.retailMarkupAmount ?? ZERO;
  if (amount.isNeg() || amount.gt(MAX_AMOUNT) || !amount.isInteger()) {
    return { issue: 'AMOUNT_RANGE', field: 'retailMarkupAmount' };
  }
  const { retailBulkMinQty: qty, retailBulkMarkupPct: pct } = values;
  const off = values.retailBulkDiscountPct ?? null;
  if (pct !== null && off !== null) {
    return { issue: 'BULK_PAIR', field: 'retailBulkDiscountPct' };
  }
  if ((qty === null) !== (pct === null && off === null)) {
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
  if (off !== null && (!off.gt(0) || !off.lt(HUNDRED) || off.decimalPlaces() > 2)) {
    return { issue: 'BULK_DISCOUNT_RANGE', field: 'retailBulkDiscountPct' };
  }
  if (qty === null && (values.retailBulkRounding ?? null) !== null) {
    return { issue: 'BULK_ROUNDING_WITHOUT_BULK', field: 'retailBulkRounding' };
  }
  return null;
}

/** A derived price rounded as the profile says (ADR-0048 #3, ADR-0207 #1). */
export function roundPrice(value: Decimal, rounding: PriceRounding): Decimal {
  if (rounding === 'WHOLE') return roundHalfUp(value, 0);
  const step = ROUNDING_STEPS[rounding];
  if (rounding.startsWith('UP_')) return value.dividedBy(step).ceil().times(step);
  const whole = value.ceil();
  const down = whole.dividedBy(step).floor().times(step);
  return down.gt(0) ? down : whole;
}

/** The warehouse price with a markup (and an amount), rounded: W × (100 + pct) / 100 + amount. */
export function markedUp(
  warehousePrice: Decimal,
  pct: Decimal,
  rounding: PriceRounding,
  amount: Decimal = ZERO,
): Decimal {
  return roundPrice(
    warehousePrice.times(HUNDRED.plus(pct)).dividedBy(HUNDRED).plus(amount),
    rounding,
  );
}

/** The supermarket price's rounding: its own, else the profile's (ADR-0207 #2). */
export function retailRoundingOf(profile: PriceProfileValues): PriceRounding {
  return profile.retailRounding ?? profile.rounding;
}

/** The bulk price's rounding: its own, else the supermarket price's (ADR-0207 #2). */
export function retailBulkRoundingOf(profile: PriceProfileValues): PriceRounding {
  return profile.retailBulkRounding ?? retailRoundingOf(profile);
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

/**
 * The supermarket price is W × (100 + its %) / 100 plus its amount, in its rounding. The bulk price
 * is either W × (100 + the bulk markup) / 100 plus the same amount, or the supermarket price less
 * the bulk discount (ADR-0207 #3), in the bulk rounding.
 */
export function perBasePrices(warehousePrice: Decimal, profile: PriceProfileValues): PerBasePrices {
  const amount = profile.retailMarkupAmount ?? ZERO;
  const retail = markedUp(
    warehousePrice,
    profile.retailMarkupPct,
    retailRoundingOf(profile),
    amount,
  );
  const bulkRounding = retailBulkRoundingOf(profile);
  const off = profile.retailBulkDiscountPct ?? null;
  let retailBulk: Decimal | null = null;
  if (profile.retailBulkMinQty !== null && off !== null) {
    retailBulk = roundPrice(retail.times(HUNDRED.minus(off)).dividedBy(HUNDRED), bulkRounding);
  } else if (profile.retailBulkMinQty !== null && profile.retailBulkMarkupPct !== null) {
    retailBulk = markedUp(warehousePrice, profile.retailBulkMarkupPct, bulkRounding, amount);
  }
  return {
    warehouse: warehousePrice,
    loose: markedUp(warehousePrice, profile.looseMarkupPct, profile.rounding),
    retail,
    retailBulk,
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
