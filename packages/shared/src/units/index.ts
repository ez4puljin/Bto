import { Decimal, type DecimalInput } from '../money';

/**
 * Unit conversion (ADR-0008 #3): pure functions used identically by the API, the web and mobile.
 * Base quantities are NUMERIC(14,3) and factors NUMERIC(18,6). A conversion never rounds: when the
 * product of an entered quantity and a factor needs more than three decimals, it is refused, so the
 * ledger always agrees with what was entered.
 */
export const QTY_SCALE = 3;
export const FACTOR_SCALE = 6;

/**
 * Whether a factor keeps conversions exact: an integer for piece-based products, at most three
 * decimals for products whose base unit is fractional (kg, l).
 */
export function isExactFactor(factor: DecimalInput, baseFractional: boolean): boolean {
  const value = new Decimal(factor);
  if (!value.isFinite() || value.lte(0) || value.decimalPlaces() > FACTOR_SCALE) return false;
  return baseFractional ? value.decimalPlaces() <= QTY_SCALE : value.isInteger();
}

export class InexactConversionError extends RangeError {
  constructor(enteredQty: Decimal, factor: Decimal) {
    super(`${enteredQty.toString()} × ${factor.toString()} needs more than ${QTY_SCALE} decimals`);
    this.name = 'InexactConversionError';
  }
}

/** Entered quantity × factor, exact to three decimals, or InexactConversionError. */
export function toBase(enteredQty: DecimalInput, factor: DecimalInput): Decimal {
  const qty = new Decimal(enteredQty);
  const multiplier = new Decimal(factor);
  const qtyBase = qty.times(multiplier);
  if (qtyBase.decimalPlaces() > QTY_SCALE) throw new InexactConversionError(qty, multiplier);
  return qtyBase;
}

/** A base quantity expressed in another unit, rounded HALF_UP for display and suggestions only. */
export function fromBase(qtyBase: DecimalInput, factor: DecimalInput, places = QTY_SCALE): Decimal {
  return new Decimal(qtyBase).dividedBy(new Decimal(factor)).toDecimalPlaces(places);
}

/**
 * Whether a quantity entered in a unit is acceptable: positive, exact in base units, and a whole
 * number of base units unless the base unit is fractional.
 */
export function isValidEnteredQty(
  enteredQty: DecimalInput,
  factor: DecimalInput,
  baseFractional: boolean,
): boolean {
  const qty = new Decimal(enteredQty);
  if (!qty.isFinite() || qty.lte(0)) return false;
  try {
    const qtyBase = toBase(qty, factor);
    return baseFractional || qtyBase.isInteger();
  } catch (error) {
    if (error instanceof InexactConversionError) return false;
    throw error;
  }
}
