/**
 * Product codes (SKU) and the code ranges of categories (ADR-0044 #1), shared by the api and the
 * web. A code is 1–20 digits. A category may own a range of codes; a category without one uses
 * its nearest ancestor's. Ranges are laminar: two ranges that meet are nested, and the outer one
 * belongs to an ancestor of the inner one's category. A code belongs to the innermost range
 * around it, so a parent's range leaves its children's ranges to them.
 */

/** Digits only, 1–20 (the products_sku_format check). */
export const SKU_PATTERN = /^[0-9]{1,20}$/;
/** The largest code that fits 20 digits. */
export const SKU_MAX = 10n ** 20n - 1n;

export interface SkuRange {
  from: bigint;
  to: bigint;
}

/** What the rules need of a category; `skuFrom` / `skuTo` are digit strings or both null. */
export interface RangedCategory {
  id: number;
  parentId: number | null;
  name: string;
  skuFrom: string | null;
  skuTo: string | null;
}

export type SkuCheck =
  | { ok: true }
  /** The category uses a range and the code is outside it. */
  | { ok: false; problem: 'OUT_OF_RANGE'; owner: RangedCategory; range: SkuRange }
  /** The code lies in the range of another category (or of a subcategory). */
  | { ok: false; problem: 'RESERVED'; owner: RangedCategory; range: SkuRange };

export function ownRange(category: RangedCategory): SkuRange | null {
  if (category.skuFrom === null || category.skuTo === null) return null;
  return { from: BigInt(category.skuFrom), to: BigInt(category.skuTo) };
}

const contains = (range: SkuRange, code: bigint) => code >= range.from && code <= range.to;
const width = (range: SkuRange) => range.to - range.from;

function index(categories: readonly RangedCategory[]): Map<number, RangedCategory> {
  return new Map(categories.map((category) => [category.id, category]));
}

/** The category itself and its ancestors, nearest first (stops on a cycle). */
function lineage(byId: ReadonlyMap<number, RangedCategory>, id: number): RangedCategory[] {
  const chain: RangedCategory[] = [];
  const seen = new Set<number>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    chain.push(current);
    seen.add(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return chain;
}

/** The category whose range `categoryId` uses: its own, else its nearest ancestor's; null: none. */
export function rangeOwner(
  categories: readonly RangedCategory[],
  categoryId: number,
): RangedCategory | null {
  return lineage(index(categories), categoryId).find((category) => ownRange(category)) ?? null;
}

/** The category owning the innermost range around a code; null when no range holds it. */
export function innermostOwner(
  categories: readonly RangedCategory[],
  code: bigint,
): RangedCategory | null {
  let best: { category: RangedCategory; range: SkuRange } | null = null;
  for (const category of categories) {
    const range = ownRange(category);
    if (!range || !contains(range, code)) continue;
    if (!best || width(range) < width(best.range)) best = { category, range };
  }
  return best?.category ?? null;
}

/** May a product of `categoryId` take this code? (Imports do not ask, ADR-0044 #1.) */
export function checkSku(
  categories: readonly RangedCategory[],
  categoryId: number,
  sku: string,
): SkuCheck {
  const code = BigInt(sku);
  const owner = rangeOwner(categories, categoryId);
  const range = owner ? ownRange(owner) : null;
  if (owner && range && !contains(range, code)) {
    return { ok: false, problem: 'OUT_OF_RANGE', owner, range };
  }
  // Inside the category's range (or with no range at all): the code must not sit in a block of
  // another category — a subcategory's, or any range for a category without one.
  const inner = innermostOwner(categories, code);
  const innerRange = inner ? ownRange(inner) : null;
  if (inner && innerRange && inner.id !== owner?.id) {
    return { ok: false, problem: 'RESERVED', owner: inner, range: innerRange };
  }
  return { ok: true };
}

/**
 * The first pair of ranges that break the rules (`category` is the one being checked, `other` the
 * one it collides with), or null. Two ranges that meet must nest, the outer one belonging to an
 * ancestor of the inner one's category.
 */
export function rangeConflict(
  categories: readonly RangedCategory[],
): { category: RangedCategory; other: RangedCategory; range: SkuRange } | null {
  const byId = index(categories);
  const ranged = categories.flatMap((category) => {
    const range = ownRange(category);
    return range ? [{ category, range }] : [];
  });
  for (let i = 0; i < ranged.length; i += 1) {
    for (let j = i + 1; j < ranged.length; j += 1) {
      const a = ranged[i];
      const b = ranged[j];
      if (!a || !b) continue;
      if (a.range.to < b.range.from || b.range.to < a.range.from) continue;
      const aInB = a.range.from >= b.range.from && a.range.to <= b.range.to;
      const bInA = b.range.from >= a.range.from && b.range.to <= a.range.to;
      const ancestors = (id: number) =>
        lineage(byId, id)
          .slice(1)
          .map((c) => c.id);
      if (aInB && !(aInB && bInA) && ancestors(a.category.id).includes(b.category.id)) continue;
      if (bInA && !(aInB && bInA) && ancestors(b.category.id).includes(a.category.id)) continue;
      return { category: b.category, other: a.category, range: a.range };
    }
  }
  return null;
}

/** The ranges nested inside `range` (its subcategories' blocks), which its own codes skip. */
export function holesOf(categories: readonly RangedCategory[], range: SkuRange): SkuRange[] {
  return categories.flatMap((category) => {
    const own = ownRange(category);
    const inside =
      own !== null &&
      own.from >= range.from &&
      own.to <= range.to &&
      !(own.from === range.from && own.to === range.to);
    return inside ? [own] : [];
  });
}

/** Moves a code past every hole it falls into. */
function skipHoles(code: bigint, holes: readonly SkuRange[]): bigint {
  const sorted = [...holes].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  let next = code;
  for (const hole of sorted) if (contains(hole, next)) next = hole.to + 1n;
  return next;
}

/**
 * The quick suggestion: one more than the largest code taken in the range outside its holes
 * (codes of every category count), or the range's first code; null when that passes the end.
 */
export function nextAfter(
  range: SkuRange,
  holes: readonly SkuRange[],
  max: bigint | null,
): bigint | null {
  const code = skipHoles(max === null ? range.from : max + 1n, holes);
  return code <= range.to && code <= SKU_MAX ? code : null;
}

/** The lowest free code of the range outside its holes, once the end is reached; null: full. */
export function lowestFree(
  range: SkuRange,
  holes: readonly SkuRange[],
  taken: ReadonlySet<bigint>,
): bigint | null {
  for (
    let code = skipHoles(range.from, holes);
    code <= range.to && code <= SKU_MAX;
    code = skipHoles(code + 1n, holes)
  ) {
    if (!taken.has(code)) return code;
  }
  return null;
}
