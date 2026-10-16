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
/** Kilograms per base unit as typed: up to 8 digits and 4 decimals (NUMERIC(12,4)). */
export const WEIGHT_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;

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

/**
 * Where a product stands (ADR-0044): in use and complete, in use but waiting for its prices (not
 * on orders yet), or not in use. The status column, the product page, the filters and the
 * segments (ADR-0049) use it.
 */
export const PRODUCT_STAGES = ['ACTIVE', 'PENDING', 'INACTIVE'] as const;
export type ProductStage = (typeof PRODUCT_STAGES)[number];

export function productStage(product: {
  status: 'ACTIVE' | 'INACTIVE';
  saleReadyAt: string | Date | null;
}): ProductStage {
  if (product.status === 'INACTIVE') return 'INACTIVE';
  return product.saleReadyAt === null ? 'PENDING' : 'ACTIVE';
}

/**
 * The product list's columns in the order of the owner's product sheet (ADR-0037); the price
 * columns are the warehouse price and the price profile (ADR-0048). The list and its export
 * (ADR-0049 #6) share these keys.
 */
export const PRODUCT_LIST_COLUMNS = [
  'image',
  'sku',
  'name',
  'category',
  'baseUnit',
  'units',
  'warehousePrice',
  'priceProfile',
  'baseBarcodes',
  'unitBarcodes',
  'weight',
  'homeWarehouse',
  'fixedBins',
  'supplier',
  'status',
] as const;
export type ProductListColumn = (typeof PRODUCT_LIST_COLUMNS)[number];

/** Columns an export carries: every list column but the photo. */
export const EXPORTABLE_PRODUCT_COLUMNS = [
  'sku',
  'name',
  'category',
  'baseUnit',
  'units',
  'warehousePrice',
  'priceProfile',
  'baseBarcodes',
  'unitBarcodes',
  'weight',
  'homeWarehouse',
  'fixedBins',
  'supplier',
  'status',
] as const satisfies readonly ProductListColumn[];
export type ExportableProductColumn = (typeof EXPORTABLE_PRODUCT_COLUMNS)[number];

/** Products one bulk change may take (ADR-0051). */
export const MAX_BULK_PRODUCTS = 500;
/** Rows one product export may hold (ADR-0049 #6). */
export const MAX_EXPORT_ROWS = 20_000;
/**
 * Products the list may hold ticked and a hand-picked segment may hold (ADR-0052); never above the
 * export's limit, so the ticks can always go to Excel.
 */
export const MAX_SELECTED_PRODUCTS = 20_000;

/** A product is «Шинэ» in the rep app this many days after it became sale-ready (ADR-0066). */
export const NEW_PRODUCT_DAYS = 14;

/** A category as the tree helpers need it. */
export interface CategoryLike {
  id: number;
  parentId: number | null;
  name: string;
}

export interface CategoryNode<T extends CategoryLike> {
  category: T;
  depth: number;
  /** Names from the root, e.g. "Хүнс / Гурил". */
  path: string;
}

export const CATEGORY_PATH_SEPARATOR = ' / ';

/** Categories depth-first, siblings by name, each with its depth and full path. */
export function categoryTree<T extends CategoryLike>(categories: readonly T[]): CategoryNode<T>[] {
  const children = new Map<number | null, T[]>();
  for (const category of categories) {
    const siblings = children.get(category.parentId) ?? [];
    siblings.push(category);
    children.set(category.parentId, siblings);
  }
  for (const siblings of children.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name, 'mn'));
  }
  const nodes: CategoryNode<T>[] = [];
  const visit = (parentId: number | null, depth: number, prefix: string) => {
    for (const category of children.get(parentId) ?? []) {
      const path = prefix ? `${prefix}${CATEGORY_PATH_SEPARATOR}${category.name}` : category.name;
      nodes.push({ category, depth, path });
      visit(category.id, depth + 1, path);
    }
  };
  visit(null, 0, '');
  return nodes;
}

/** Category id → full path, for list cells and the export. */
export function categoryPaths(categories: readonly CategoryLike[]): Map<number, string> {
  return new Map(categoryTree(categories).map((node) => [node.category.id, node.path]));
}
