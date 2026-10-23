import type { components } from '@tugeel/api-client';
import type { HomeSectionSort } from '@tugeel/shared/sales';
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import { canonical } from '../cart/send';
import type { OrderFilterParams } from '../orders/order-filters';
import type { ShopQuery } from '../shop/filters';
import { useSignedIn } from '../state/session';
import { ApiProblem, unwrap } from './problem';

export type RepContext = components['schemas']['SalesRepContext'];
export type RepWarehouse = components['schemas']['SalesRepWarehouse'];
export type RepProduct = components['schemas']['SalesRepProduct'];
type RepProductPage = components['schemas']['SalesRepProductPage'];
export type RepUnit = components['schemas']['SalesRepProductUnit'];
export type RepSupplier = components['schemas']['SalesRepSupplier'];
export type RepCustomer = components['schemas']['SalesRepCustomer'];
export type RepCustomerDetail = components['schemas']['SalesRepCustomerDetail'];
export type RepOrder = components['schemas']['SalesRepOrder'];
export type RepOrderSummary = components['schemas']['SalesRepOrderSummary'];
export type RepStoreOrder = components['schemas']['SalesRepStoreOrder'];
export type Category = components['schemas']['Category'];
export type Quote = components['schemas']['Quote'];
export type RepHome = components['schemas']['SalesRepHome'];
export type RepHomeSection = components['schemas']['SalesRepHomeSection'];
export type RepCategoryPage = components['schemas']['SalesRepCategoryPage'];

const PAGE = 30;

/**
 * Days of the rep's orders (ADR-0068) and their filters (the owner, 2026-10-18: customer,
 * product, payment, delivery, state); `q` searches a number or a customer.
 */
export interface OrderRange extends OrderFilterParams {
  from: string;
  to: string;
  q?: string;
}

/** Today, the stages the rep may place on, the warehouses and branches (ADR-0061 #5, ADR-0068). */
export function useRepContext() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'context'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-rep/context')),
    staleTime: 60_000,
  });
}

export function useCategories() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'categories'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/categories')).data,
    staleTime: 10 * 60_000,
  });
}

function productParams(query: ShopQuery) {
  return {
    ...(query.q ? { q: query.q } : {}),
    ...(query.categoryIds.length > 0 ? { categoryIds: [...query.categoryIds] } : {}),
    ...(query.warehouseId !== null ? { warehouseId: query.warehouseId } : {}),
    ...(query.supplierIds.length > 0 ? { supplierIds: [...query.supplierIds] } : {}),
    ...(query.inStock ? { inStock: true } : {}),
    sort: query.sort,
  };
}

/**
 * The shop, page by page, as the filters and the search ask; the first page holds the total.
 * `enabled` waits for the stored filters, so the first page is not asked twice.
 */
export function useProducts(query: ShopQuery, enabled = true) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['rep', 'products', productParams(query)],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/products', {
          params: {
            query: {
              ...productParams(query),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** How many products a filter would show (the filter sheet's «N бараа харуулах»). */
export function useProductCount(query: ShopQuery, enabled: boolean) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'products', 'count', productParams(query)],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/products', {
          params: { query: { ...productParams(query), limit: 1 } },
        }),
      ).total,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/**
 * Products by id, as the shop would list them (a product page, the cart, a notice); with
 * `priceBefore`, each base price on that day too (a price-drop notice's old price). `seed` shows
 * what the shop's lists already hold until the server answers.
 */
export function useProductsOf(
  ids: readonly number[],
  priceBefore?: string,
  seed?: readonly RepProduct[],
) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'products', 'of', [...ids].sort((a, b) => a - b).join(','), priceBefore],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/products/batch', {
          params: {
            query: { productIds: ids.join(','), ...(priceBefore ? { priceBefore } : {}) },
          },
        }),
      ),
    enabled: ids.length > 0,
    ...(seed && seed.length > 0 ? { placeholderData: [...seed] } : {}),
  });
}

function isProductPages(data: unknown): data is InfiniteData<RepProductPage> {
  return (
    typeof data === 'object' && data !== null && Array.isArray((data as { pages?: unknown }).pages)
  );
}

/** «Нүүр» and a category page hold their products in their sections. */
function hasSections(data: unknown): data is { sections: RepHomeSection[] } {
  return (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { sections?: unknown }).sections)
  );
}

/**
 * A product the shop's lists already hold (a grid page, a batch, a home or category section), so
 * its page opens at once.
 */
export function cachedProduct(client: QueryClient, id: number): RepProduct | undefined {
  for (const [, data] of client.getQueriesData<unknown>({ queryKey: ['rep', 'products'] })) {
    const rows = Array.isArray(data)
      ? (data as RepProduct[])
      : isProductPages(data)
        ? data.pages.flatMap((page) => page.data)
        : hasSections(data)
          ? data.sections.flatMap((section) => section.products)
          : [];
    const found = rows.find((product) => product.id === id);
    if (found) return found;
  }
  return undefined;
}

/**
 * «Нүүр»'s shop window (ADR-0100 #9): the banners, the category tiles and the sections
 * (promotions, the shown segments, discounts, new) with the rep's products. A server older than
 * the shop window answers 404: the data is then null and «Нүүр» simply has no shop window.
 */
export function useRepHome() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'products', 'home'],
    queryFn: async (): Promise<RepHome | null> => {
      try {
        return unwrap(await session.client.GET('/api/v1/sales-rep/home'));
      } catch (error) {
        if (error instanceof ApiProblem && error.problem.status === 404) return null;
        throw error;
      }
    },
  });
}

/** What a section's full list asks for (as «Bto300»'s, ADR-0093 #6). */
export interface RepSectionQuery {
  sort: HomeSectionSort;
  categoryIds: readonly number[];
  inStock: boolean;
}

function sectionParams(query: RepSectionQuery) {
  return {
    ...(query.sort !== 'DEFAULT' ? { sort: query.sort } : {}),
    ...(query.categoryIds.length > 0 ? { categoryIds: [...query.categoryIds] } : {}),
    ...(query.inStock ? { inStock: true } : {}),
  };
}

/** A section's full list page by page; the first page holds the total. */
export function useRepSection(key: string, query: RepSectionQuery) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['rep', 'products', 'section', key, sectionParams(query)],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/sections/{key}/products', {
          params: {
            path: { key },
            query: {
              ...sectionParams(query),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** How many products a section's draft filters would show (the sheet's «N бараа харуулах»). */
export function useRepSectionCount(key: string, query: RepSectionQuery, enabled: boolean) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'products', 'section-count', key, sectionParams(query)],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/sections/{key}/products', {
          params: { path: { key }, query: { ...sectionParams(query), limit: 1 } },
        }),
      ).total,
    enabled,
    placeholderData: keepPreviousData,
  });
}

/** A category's page (as «Bto300»'s, ADR-0092 #6): its banners, subcategories, new and deals. */
export function useRepCategoryPage(id: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'products', 'category', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/categories/{id}/page', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

/** The main suppliers of the shop's products, the most products first. */
export function useSuppliers(enabled = true) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'suppliers'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-rep/suppliers')),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCustomers(q: string) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['rep', 'customers', q],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/customers', {
          params: {
            query: {
              ...(q ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'customer', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/customers/{id}', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

/** The orders query of a range: the days, then only the search and filters that are on. */
function orderParams(range: OrderRange) {
  const q = range.q?.trim() ?? '';
  return {
    from: range.from,
    to: range.to,
    ...(q ? { q } : {}),
    ...(range.customerId !== undefined ? { customerId: range.customerId } : {}),
    ...(range.productId !== undefined ? { productId: range.productId } : {}),
    ...(range.paymentMethod !== undefined ? { paymentMethod: range.paymentMethod } : {}),
    ...(range.fulfilment !== undefined ? { fulfilment: range.fulfilment } : {}),
    ...(range.state !== undefined ? { state: range.state } : {}),
  };
}

/** The rep's own orders made on the days of a range, newest first, with the range's summary. */
export function useOrders(range: OrderRange | null) {
  const { session } = useSignedIn();
  const params = range ? orderParams(range) : null;
  return useInfiniteQuery({
    queryKey: ['rep', 'orders', params],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/orders', {
          params: {
            query: {
              ...(params ?? { from: '', to: '' }),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: params !== null,
    placeholderData: keepPreviousData,
  });
}

/** How many orders a filter would show (the order filter's «N захиалга харуулах»). */
export function useOrderCount(range: OrderRange, enabled: boolean) {
  const { session } = useSignedIn();
  const params = orderParams(range);
  return useQuery({
    queryKey: ['rep', 'orders', 'count', params],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/orders', {
          params: { query: { ...params, limit: 1 } },
        }),
      ).summary?.count ?? null,
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useOrder(id: number) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'order', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/orders/{id}', { params: { path: { id } } }),
      ),
  });
}

/**
 * Every order of a store, anyone's, newest first (the store card's history, the owner 2026-10-18):
 * who took it and when; only the rep's own (`mine`) open. The card shows the first rows of the
 * page its full list loads, so the list opens at once.
 */
export function useStoreOrders(customerId: number | null) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['rep', 'store-orders', customerId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/customers/{id}/orders', {
          params: {
            path: { id: customerId ?? 0 },
            query: { ...(pageParam ? { cursor: pageParam } : {}), limit: PAGE },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: customerId !== null,
  });
}

/** The whole cart priced by the server (discounts stack over the cart, ADR-0041). */
export function useQuote(lines: readonly { productUnitId: number; qty: string }[]) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'quote', canonical(lines)],
    queryFn: async () =>
      unwrap(
        await session.client.POST('/api/v1/pricing/quote', {
          body: { list: 'WHOLESALE', lines: [...lines] },
        }),
      ),
    enabled: lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

/**
 * The active customers with a GPS point and the rep's own last order at each (the store map, the
 * owner 2026-10-18): `stale` when none within the server's `freshDays`, today included.
 */
export function useRepMap() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'map'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-rep/map')),
    staleTime: 60_000,
  });
}
