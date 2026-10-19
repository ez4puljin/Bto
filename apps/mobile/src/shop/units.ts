import { Decimal } from '@tugeel/shared/money';

/** The units of measure every installation has; the app knows their word forms (mn.json). */
export const KNOWN_UNITS = ['PCS', 'BOX', 'BLOCK', 'KG'] as const;
export type KnownUnit = (typeof KNOWN_UNITS)[number];

export function knownUnit(code: string | null | undefined): KnownUnit | null {
  return KNOWN_UNITS.find((known) => known === code) ?? null;
}

/** A product unit as the shop and the cart know it. */
export interface UnitLike {
  id: number;
  uomName: string;
  uomCode?: string | null;
  factorToBase: string;
  isBase: boolean;
  isDefaultSales?: boolean;
}

const bigger = (a: UnitLike, b: UnitLike) =>
  new Decimal(b.factorToBase).comparedTo(new Decimal(a.factorToBase));

/** The base unit (pieces); a product always has one. */
export function baseUnitOf<T extends UnitLike>(units: readonly T[]): T | undefined {
  return units.find((unit) => unit.isBase) ?? units[0];
}

/** The pack the shop tells a product by («хайрцагт 6»): the default sales pack, else the largest. */
export function packOf<T extends UnitLike>(units: readonly T[]): T | undefined {
  const packs = units.filter((unit) => !unit.isBase);
  return packs.find((unit) => unit.isDefaultSales) ?? [...packs].sort(bigger)[0];
}

/**
 * The unit «+» adds and a product page opens with: the default sales unit, else the largest pack
 * (wholesale goes by the box), else the base unit.
 */
export function defaultUnitOf<T extends UnitLike>(units: readonly T[]): T | undefined {
  return units.find((unit) => unit.isDefaultSales) ?? packOf(units) ?? baseUnitOf(units);
}

/** Base units in `qty` of a unit (a whole count of pieces or boxes). */
export function baseQty(qty: number, unit: Pick<UnitLike, 'factorToBase'>): Decimal {
  return new Decimal(unit.factorToBase).times(qty);
}

/** What a quantity in base units leaves short of the free stock; zero when it fits. */
export function shortBy(qtyBase: Decimal, available: string): Decimal {
  const short = qtyBase.minus(new Decimal(available));
  return short.gt(0) ? short : new Decimal(0);
}
