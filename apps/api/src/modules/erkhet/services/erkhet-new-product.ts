import {
  holesOf,
  lowestFree,
  nextAfter,
  ownRange,
  type RangedCategory,
  rangeOwner,
  SKU_MAX,
  SKU_PATTERN,
  type SkuRange,
} from '@tugeel/shared/catalog';
import { Decimal } from '@tugeel/shared/money';
import { nameKey } from '@tugeel/shared/text';

// How an Erkhet item missing in Bto becomes a Bto product (ADR-0222): the cells Erkhet gives read
// into Bto's units, and the code it takes. Pure, so the rules are tested without a database.

/** A box of more than this many base units is not a box: a typo in Erkhet, left out. */
const PACK_MAX = new Decimal(100_000);
/** How far from a whole number Erkhet's float may stand and still be one (1/0.0833333333333). */
const WHOLE_TOLERANCE = new Decimal('0.001');
/** Kilograms per base unit: NUMERIC(12,4) and more than nothing. */
const WEIGHT_LIMIT = new Decimal('100000000');

/**
 * The box's count of base units from «Задрах харьцаа». Erkhet keeps one base unit in the pack unit
 * (1/12 for a box of 12) and some items the other way round (12); either reads as 12. Null when
 * there is no box: an empty cell, one, or a count that is not whole.
 */
export function packQtyOf(ratio: string | null): Decimal | null {
  if (ratio === null) return null;
  const value = new Decimal(ratio);
  if (!value.isFinite() || value.lte(0)) return null;
  const count = value.gt(1) ? value : new Decimal(1).div(value);
  const whole = count.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  if (count.minus(whole).abs().gt(WHOLE_TOLERANCE)) return null;
  return whole.gte(2) && whole.lte(PACK_MAX) ? whole : null;
}

/** «Жин» as Bto keeps a weight: kilograms per base unit to four places; null when none. */
export function weightOf(weight: string | null): Decimal | null {
  if (weight === null) return null;
  const value = new Decimal(weight).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  return value.isFinite() && value.gt(0) && value.lt(WEIGHT_LIMIT) ? value : null;
}

export interface UomChoice {
  id: number;
  code: string | null;
  nameKey: string;
}

/**
 * Bto's unit of measure for Erkhet's «Хэмжих нэгж»: by its name («Хайрцаг» is Bto's «хайрцаг»),
 * else by its code as a name («ш», «кг») or as a system code; null when Bto has no such unit.
 */
export function uomOf<T extends UomChoice>(
  uoms: readonly T[],
  unitCode: string | null,
  unitName: string | null,
): T | null {
  for (const text of [unitName, unitCode]) {
    if (!text) continue;
    const key = nameKey(text);
    const code = text.trim().toUpperCase();
    const found = uoms.find((uom) => uom.nameKey === key) ?? uoms.find((uom) => uom.code === code);
    if (found) return found;
  }
  return null;
}

/** Erkhet's code, when Bto can take it as it is: digits only and no product of that number. */
export function erkhetCodeFree(code: string, taken: ReadonlySet<bigint>): boolean {
  return SKU_PATTERN.test(code) && !taken.has(BigInt(code));
}

const inside = (range: SkuRange, code: bigint) => code >= range.from && code <= range.to;

/**
 * The next free code of the category, as «Шинэ бараа» suggests it (ADR-0044 #1): past the largest
 * code of its range (its own or its nearest ancestor's) outside its subcategories' blocks, else the
 * lowest free one; without a range, past the largest code outside every range. `taken` holds every
 * product code as a number. Null when the range is full.
 */
export function nextCodeOf(
  categories: readonly RangedCategory[],
  categoryId: number,
  taken: ReadonlySet<bigint>,
): string | null {
  const owner = rangeOwner(categories, categoryId);
  const range = (owner && ownRange(owner)) ?? { from: 1n, to: SKU_MAX };
  const holes = owner
    ? holesOf(categories, range)
    : categories.flatMap((category) => {
        const own = ownRange(category);
        return own ? [own] : [];
      });
  let max: bigint | null = null;
  for (const code of taken) {
    if (!inside(range, code) || holes.some((hole) => inside(hole, code))) continue;
    if (max === null || code > max) max = code;
  }
  const code = nextAfter(range, holes, max) ?? lowestFree(range, holes, taken);
  return code === null ? null : code.toString();
}
