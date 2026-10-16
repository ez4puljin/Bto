import { REP_PRODUCT_SORTS, type RepProductSort } from '@tugeel/shared/sales';

/** At most this many ids in one filter (the API's limit per list). */
export const MAX_FILTER_IDS = 200;

/** The shop's filters and order as the rep set them (ADR-0066); kept on the phone. */
export interface ShopFilters {
  sort: RepProductSort;
  /** Chosen categories, each with its subcategories; none: every category. */
  categoryIds: number[];
  /** The products' home warehouse; null: every warehouse. */
  warehouseId: number | null;
  /** Main suppliers; none: every supplier. */
  supplierIds: number[];
  inStock: boolean;
}

/** What the shop asks the server: the filters and the search. */
export interface ShopQuery extends ShopFilters {
  q: string;
}

export const EMPTY_FILTERS: ShopFilters = {
  sort: 'NEW',
  categoryIds: [],
  warehouseId: null,
  supplierIds: [],
  inStock: false,
};

/**
 * The location a rep starts with: the one wholesale warehouse they write for, else every one. An
 * unscoped rep (null) writes for all and starts with all.
 */
export function defaultWarehouseId(
  warehouses: readonly { id: number }[],
  writable: readonly number[] | null,
): number | null {
  if (writable === null) return null;
  const own = warehouses.filter((warehouse) => writable.includes(warehouse.id));
  return own.length === 1 ? (own[0]?.id ?? null) : null;
}

/** The filters a rep starts with before choosing any. */
export function initialFilters(
  warehouses: readonly { id: number }[],
  writable: readonly number[] | null,
): ShopFilters {
  return { ...EMPTY_FILTERS, warehouseId: defaultWarehouseId(warehouses, writable) };
}

/** How many filters are on: the number on the filter button (the order is not a filter). */
export function activeCount(filters: ShopFilters): number {
  return (
    (filters.categoryIds.length > 0 ? 1 : 0) +
    (filters.warehouseId !== null ? 1 : 0) +
    (filters.supplierIds.length > 0 ? 1 : 0) +
    (filters.inStock ? 1 : 0)
  );
}

/** Adds an id to a filter's list, or takes it out; never more than MAX_FILTER_IDS. */
export function toggleId(ids: readonly number[], id: number): number[] {
  if (ids.includes(id)) return ids.filter((entry) => entry !== id);
  return ids.length >= MAX_FILTER_IDS ? [...ids] : [...ids, id];
}

const positiveIds = (value: unknown): number[] =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.filter(
            (id): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
          ),
        ),
      ].slice(0, MAX_FILTER_IDS)
    : [];

/** Stored filters read back; anything that is not filters is none (the rep starts afresh). */
export function filtersFrom(value: unknown): ShopFilters | null {
  if (typeof value !== 'object' || value === null) return null;
  const stored = value as Record<string, unknown>;
  const sort = REP_PRODUCT_SORTS.find((entry) => entry === stored.sort);
  if (!sort) return null;
  const warehouseId = stored.warehouseId;
  return {
    sort,
    categoryIds: positiveIds(stored.categoryIds),
    warehouseId:
      typeof warehouseId === 'number' && Number.isSafeInteger(warehouseId) && warehouseId > 0
        ? warehouseId
        : null,
    supplierIds: positiveIds(stored.supplierIds),
    inStock: stored.inStock === true,
  };
}

/** Filters whose warehouse is gone (closed, or another server's) fall back to every warehouse. */
export function withKnownWarehouse(
  filters: ShopFilters,
  warehouses: readonly { id: number }[],
): ShopFilters {
  if (filters.warehouseId === null) return filters;
  return warehouses.some((warehouse) => warehouse.id === filters.warehouseId)
    ? filters
    : { ...filters, warehouseId: null };
}

/** A category as the categories list gives it. */
export interface CategoryNode {
  id: number;
  parentId: number | null;
  name: string;
  /** Products directly in it. */
  productCount: number;
}

/** The filter's categories: the top ones with products somewhere under them, in the list's order. */
export function topCategories(categories: readonly CategoryNode[]): { id: number; name: string }[] {
  const children = new Map<number, CategoryNode[]>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    children.set(category.parentId, [...(children.get(category.parentId) ?? []), category]);
  }
  const total = (category: CategoryNode, seen: Set<number>): number => {
    if (seen.has(category.id)) return 0;
    seen.add(category.id);
    return (children.get(category.id) ?? []).reduce(
      (sum, child) => sum + total(child, seen),
      category.productCount,
    );
  };
  return categories
    .filter((category) => category.parentId === null && total(category, new Set()) > 0)
    .map((category) => ({ id: category.id, name: category.name }));
}

const LEGAL_FORMS = new Set(['ХХК', 'ХК', 'ТӨХК', 'ТББ', 'ББСБ', 'ХЗХ']);

/** A supplier's avatar letter: the first of its last word, past the legal form («Хүнс ХХК» → «Х»). */
export function supplierInitial(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0 && !LEGAL_FORMS.has(word.toUpperCase()));
  const word = words[words.length - 1] ?? name.trim();
  return ([...word][0] ?? '').toUpperCase();
}
