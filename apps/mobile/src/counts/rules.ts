import { Decimal } from '@tugeel/shared/money';

// The arithmetic of the count screen (ADR-0176 #4), apart from the screen so it is tested without
// a phone. Quantities stay decimal strings; the server does the conversion that counts.

/** What the typed number is in the base unit («2» boxes of 24 = «48»); null until it is a number. */
export function baseQtyOf(text: string, factor: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  return new Decimal(text).times(factor).toDecimalPlaces(3).toString();
}

/** The count's number for the product once the typed one is added to it. */
export function totalAfter(counted: string, typedBase: string | null): string {
  return new Decimal(counted).plus(typedBase ?? '0').toString();
}

/** Two quantities as numbers: «12» and «12.000» are the same. */
export function sameQty(a: string, b: string): boolean {
  return new Decimal(a).eq(b);
}

/** A unit other than the base one says what it holds: «Хайрцаг ×24». */
export function isPack(unit: { isBase: boolean; factorToBase: string }): boolean {
  return !unit.isBase && !sameQty(unit.factorToBase, '1');
}
