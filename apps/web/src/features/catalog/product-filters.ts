import { Decimal } from '@tugeel/shared/money';
import {
  MAX_CONDITION_IDS,
  MAX_LAST_DAYS,
  type SegmentCondition,
  type SegmentDefinition,
  type SegmentGroup,
} from '@tugeel/shared/segments';
import { isIsoDate } from '@tugeel/shared/time';

/*
 * The product list's filters beyond search, category and status (ADR-0049 #4): one per field, kept
 * in the URL in short form so «back» and a shared link keep them. `segment=7`, `supplier=1,2` or
 * `supplier=main:1`, `home=3,4`, `profile=5`, `price=1000~5000` (either side may be empty),
 * `stock=out` or `stock=low:3` (a warehouse), `created=30d` or `created=2026-10-01~2026-10-14`,
 * `updated=…`, `missing=photo,weight`. Values that do not read are ignored. The list sends them to
 * `POST /products/query` as one definition: the fields ANDed, the missing data ORed.
 */

export const PRODUCT_FILTER_FIELDS = [
  'segment',
  'supplier',
  'home',
  'profile',
  'price',
  'stock',
  'created',
  'updated',
  'missing',
] as const;
export type ProductFilterField = (typeof PRODUCT_FILTER_FIELDS)[number];

/** «Дутуу мэдээлэл»: catalog's gaps, then the products without a supplier, a home or prices. */
export const MISSING_CHOICES = [
  'base-barcode',
  'barcode',
  'photo',
  'weight',
  'ebarimt',
  'supplier',
  'home',
  'price',
] as const;
export type MissingChoice = (typeof MISSING_CHOICES)[number];

export const STOCK_KINDS = ['in', 'out', 'low'] as const;
export type StockKind = (typeof STOCK_KINDS)[number];

/** The date filters' quick choices, in days up to today. */
export const DATE_PRESETS = [1, 7, 30] as const;

export type DateFilter = { days: number } | { from?: string; to?: string };

export interface ProductFilters {
  segment?: number;
  supplier?: { main: boolean; ids: number[] };
  home?: number[];
  profile?: number[];
  price?: { min?: string; max?: string };
  stock?: { kind: StockKind; warehouseId?: number };
  created?: DateFilter;
  updated?: DateFilter;
  missing?: MissingChoice[];
}

const MISSING_CONDITIONS: Record<MissingChoice, SegmentCondition> = {
  'base-barcode': { field: 'missing', op: 'IS', values: ['BASE_BARCODE'] },
  barcode: { field: 'missing', op: 'IS', values: ['ANY_BARCODE'] },
  photo: { field: 'missing', op: 'IS', values: ['PHOTO'] },
  weight: { field: 'missing', op: 'IS', values: ['WEIGHT'] },
  ebarimt: { field: 'missing', op: 'IS', values: ['EBARIMT'] },
  supplier: { field: 'supplier', op: 'NONE' },
  home: { field: 'homeWarehouse', op: 'NONE' },
  price: { field: 'priceProfile', op: 'NONE' },
};

const STOCK_OPS = { in: 'IN_STOCK', out: 'OUT_OF_STOCK', low: 'AT_OR_BELOW_MIN' } as const;

const ID = /^[1-9]\d{0,14}$/;
const WHOLE_MNT = /^(0|[1-9]\d{0,11})$/;
const LAST_DAYS = /^([1-9]\d{0,3})d$/;

export const isWholeMnt = (value: string) => WHOLE_MNT.test(value);
const isStockKind = (value: string): value is StockKind =>
  STOCK_KINDS.some((kind) => kind === value);

/** Ids from `1,2,3`, without repeats; undefined when missing or when any part is not an id. */
function readIds(text: string | null): number[] | undefined {
  if (!text) return undefined;
  const parts = text.split(',');
  if (parts.length > MAX_CONDITION_IDS || !parts.every((part) => ID.test(part))) return undefined;
  return [...new Set(parts.map((part) => Number.parseInt(part, 10)))];
}

function readDate(text: string | null): DateFilter | undefined {
  if (!text) return undefined;
  const days = LAST_DAYS.exec(text);
  if (days) {
    const count = Number.parseInt(days[1] ?? '', 10);
    return count <= MAX_LAST_DAYS ? { days: count } : undefined;
  }
  const parts = text.split('~');
  const [from = '', to = ''] = parts;
  if (parts.length !== 2 || (!from && !to)) return undefined;
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) {
    return undefined;
  }
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
}

/** A price range of whole tugriks, at least one side, the lower side first. */
export function priceIssue(min: string, max: string): 'MONEY_INVALID' | 'MONEY_ORDER' | null {
  if ((!min && !max) || (min && !isWholeMnt(min)) || (max && !isWholeMnt(max))) {
    return 'MONEY_INVALID';
  }
  if (min && max && new Decimal(min).gt(max)) return 'MONEY_ORDER';
  return null;
}

export function readFilters(params: URLSearchParams): ProductFilters {
  const filters: ProductFilters = {};
  const segment = params.get('segment');
  if (segment && ID.test(segment)) filters.segment = Number.parseInt(segment, 10);
  const supplier = params.get('supplier');
  if (supplier) {
    const main = supplier.startsWith('main:');
    const ids = readIds(main ? supplier.slice('main:'.length) : supplier);
    if (ids) filters.supplier = { main, ids };
  }
  const home = readIds(params.get('home'));
  if (home) filters.home = home;
  const profile = readIds(params.get('profile'));
  if (profile) filters.profile = profile;
  const price = params.get('price')?.split('~');
  if (price?.length === 2) {
    const [min = '', max = ''] = price;
    if (priceIssue(min, max) === null) {
      filters.price = { ...(min ? { min } : {}), ...(max ? { max } : {}) };
    }
  }
  const stock = params.get('stock')?.split(':');
  if (stock && stock.length <= 2) {
    const [kind = '', warehouse] = stock;
    if (isStockKind(kind) && (warehouse === undefined || ID.test(warehouse))) {
      filters.stock = {
        kind,
        ...(warehouse ? { warehouseId: Number.parseInt(warehouse, 10) } : {}),
      };
    }
  }
  const created = readDate(params.get('created'));
  if (created) filters.created = created;
  const updated = readDate(params.get('updated'));
  if (updated) filters.updated = updated;
  const missing = params.get('missing')?.split(',') ?? [];
  const chosen = MISSING_CHOICES.filter((choice) => missing.includes(choice));
  if (chosen.length > 0) filters.missing = chosen;
  return filters;
}

function dateParam(filter: DateFilter | undefined): string | null {
  if (!filter) return null;
  if ('days' in filter) return `${filter.days}d`;
  return filter.from || filter.to ? `${filter.from ?? ''}~${filter.to ?? ''}` : null;
}

/** One filter's URL value, or null when it filters nothing. */
export function filterParam(field: ProductFilterField, filters: ProductFilters): string | null {
  switch (field) {
    case 'segment':
      return filters.segment ? String(filters.segment) : null;
    case 'supplier':
      return filters.supplier?.ids.length
        ? `${filters.supplier.main ? 'main:' : ''}${filters.supplier.ids.join(',')}`
        : null;
    case 'home':
      return filters.home?.length ? filters.home.join(',') : null;
    case 'profile':
      return filters.profile?.length ? filters.profile.join(',') : null;
    case 'price':
      return filters.price && (filters.price.min || filters.price.max)
        ? `${filters.price.min ?? ''}~${filters.price.max ?? ''}`
        : null;
    case 'stock':
      return filters.stock
        ? `${filters.stock.kind}${filters.stock.warehouseId ? `:${filters.stock.warehouseId}` : ''}`
        : null;
    case 'created':
      return dateParam(filters.created);
    case 'updated':
      return dateParam(filters.updated);
    case 'missing':
      return filters.missing?.length ? filters.missing.join(',') : null;
  }
}

export const activeFilterFields = (filters: ProductFilters) =>
  PRODUCT_FILTER_FIELDS.filter((field) => filterParam(field, filters) !== null);

function dateCondition(field: 'createdAt' | 'updatedAt', filter: DateFilter): SegmentCondition {
  return 'days' in filter
    ? { field, op: 'LAST_DAYS', days: filter.days }
    : { field, op: 'BETWEEN', ...filter };
}

/** What the filters send as `where`: the fields ANDed, the missing data ORed; undefined if none. */
export function whereOf(filters: ProductFilters): SegmentDefinition | undefined {
  const conditions: SegmentCondition[] = [];
  if (filters.supplier) {
    conditions.push({
      field: 'supplier',
      op: filters.supplier.main ? 'MAIN_IN' : 'IN',
      ids: filters.supplier.ids,
    });
  }
  if (filters.home) conditions.push({ field: 'homeWarehouse', op: 'IN', ids: filters.home });
  if (filters.profile) conditions.push({ field: 'priceProfile', op: 'IN', ids: filters.profile });
  if (filters.price) conditions.push({ field: 'warehousePrice', op: 'BETWEEN', ...filters.price });
  if (filters.stock) {
    conditions.push({
      field: 'stock',
      op: STOCK_OPS[filters.stock.kind],
      ...(filters.stock.warehouseId ? { warehouseId: filters.stock.warehouseId } : {}),
    });
  }
  if (filters.created) conditions.push(dateCondition('createdAt', filters.created));
  if (filters.updated) conditions.push(dateCondition('updatedAt', filters.updated));
  const groups: SegmentGroup[] = [];
  if (conditions.length > 0) groups.push({ match: 'ALL', conditions });
  if (filters.missing?.length) {
    groups.push({
      match: 'ANY',
      conditions: filters.missing.map((choice) => MISSING_CONDITIONS[choice]),
    });
  }
  return groups.length > 0 ? { match: 'ALL', groups } : undefined;
}

/** The filters with one field set, or removed when `value` is undefined. */
export function withFilter<F extends ProductFilterField>(
  filters: ProductFilters,
  field: F,
  value: ProductFilters[F] | undefined,
): ProductFilters {
  const { [field]: _dropped, ...rest } = filters;
  return value === undefined ? rest : { ...rest, [field]: value };
}

/** The label of a «Дутуу мэдээлэл» choice: catalog's gaps, then the other owners' «none». */
export function missingLabelKey(choice: MissingChoice) {
  switch (choice) {
    case 'base-barcode':
      return 'segments.missing.BASE_BARCODE' as const;
    case 'barcode':
      return 'segments.missing.ANY_BARCODE' as const;
    case 'photo':
      return 'segments.missing.PHOTO' as const;
    case 'weight':
      return 'segments.missing.WEIGHT' as const;
    case 'ebarimt':
      return 'segments.missing.EBARIMT' as const;
    default:
      return `catalog.products.filters.missingNone.${choice}` as const;
  }
}
