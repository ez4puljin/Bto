import { Decimal as DecimalJs } from 'decimal.js';

/**
 * The one configured decimal.js constructor for money, quantities, costs and factors (ADR-0010, ADR-0025).
 * Import Decimal from '@tugeel/shared/money', never from 'decimal.js', so every runtime uses this clone.
 * precision 40: products of NUMERIC(14,3) quantities and NUMERIC(14,2) prices need up to 28 significant
 * digits, so intermediate results are never rounded by the library; rounding is always explicit.
 */
export const Decimal = DecimalJs.clone({
  precision: 40,
  rounding: DecimalJs.ROUND_HALF_UP,
  toExpNeg: -40,
  toExpPos: 40,
});
export type Decimal = DecimalJs;

export type DecimalInput = Decimal | string | number;

/** Rounds HALF_UP to `places` decimal places (0 = whole tugrik for unit prices, ADR-0010). */
export function roundHalfUp(value: DecimalInput, places: number): Decimal {
  return new Decimal(value).toDecimalPlaces(places, Decimal.ROUND_HALF_UP);
}

/** Money in MNT with two decimals, NUMERIC(14,2). */
export function toMoney(value: DecimalInput): Decimal {
  return roundHalfUp(value, 2);
}

/** Whole tugrik, used for frozen unit prices and line totals (ADR-0010). */
export function toWholeMnt(value: DecimalInput): Decimal {
  return roundHalfUp(value, 0);
}

export function isDecimal(value: unknown): value is Decimal {
  return Decimal.isDecimal(value);
}
