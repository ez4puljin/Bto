import type { components } from '@tugeel/api-client';
import type { HomeSectionSort } from '@tugeel/shared/sales';
import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { canonical } from '../cart/send';
import { ubDate } from '../dates/dates';
import { estimateQuote, type MaybeEstimated } from '../offline/estimate';
import {
  keptCategoryPage,
  keptCategoryTiles,
  keptCustomer,
  type KeptCustomerDetail,
  keptCustomerPage,
  keptProductPage,
  keptProducts,
  keptProductsOf,
} from '../offline/query';
import type { KeptStore } from '../offline/store';
import type { KeptData } from '../offline/walk';
import type { OrderFilterParams } from '../orders/order-filters';
import type { ShopQuery } from '../shop/filters';
import { useKept } from '../state/kept';
import { useSignedIn } from '../state/session';
import { ApiProblem, NETWORK, unwrap } from './problem';

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
 * Without the server (ADR-0225 #2): a rep's session that has no connection reads the kept copy
 * instead of the server, under its own query key (`…, 'kept'`), so nothing kept is ever shown
 * under an online key and the screens ask the server again as soon as it is back. A call that
 * finds no connection sets the session offline (session.ts), which switches these keys. Online
 * every hook below is exactly what it was.
 */
function useKeptMode(): { kept: boolean; store: KeptStore | null } {
  const { offline } = useSignedIn();
  const { store } = useKept();
  return { kept: offline && store !== null, store };
}

const keyFor = (key: readonly unknown[], kept: boolean) => (kept ? [...key, 'kept'] : [...key]);

/** Reads the kept copy; no copy is no connection (the screens say what to do). */
async function fromKept<T>(store: KeptStore | null, read: (data: KeptData) => T): Promise<T> {
  const data = store ? await store.data() : null;
  if (!data) throw new ApiProblem(NETWORK);
  return read(data);
}

/** «Today» without the server: the phone's clock in Ulaanbaatar. */
export const phoneToday = () => ubDate(new Date().toISOString());

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
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: keyFor(['rep', 'context'], kept),
    queryFn: kept
      ? () => fromKept(store, (data) => ({ ...data.context, today: phoneToday() }))
      : async () => unwrap(await session.client.GET('/api/v1/sales-rep/context')),
    staleTime: 60_000,
  });
}

export function useCategories() {
  const { session } = useSignedIn();
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: keyFor(['rep', 'categories'], kept),
    queryFn: kept
      ? () => fromKept(store, (data) => data.categories)
      : async () => unwrap(await session.client.GET('/api/v1/categories')).data,
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
    ...(query.bonus ? { bonus: true } : {}),
    sort: query.sort,
  };
}

/**
 * The shop, page by page, as the filters and the search ask; the first page holds the total.
 * `enabled` waits for the stored filters, so the first page is not asked twice.
 */
export function useProducts(query: ShopQuery, enabled = true) {
  const { session } = useSignedIn();
  const { kept, store } = useKeptMode();
  return useInfiniteQuery({
    queryKey: keyFor(['rep', 'products', productParams(query)], kept),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      kept
        ? fromKept(store, (data) => keptProductPage(data, query, pageParam ?? null, PAGE))
        : unwrap(
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
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: keyFor(['rep', 'products', 'count', productParams(query)], kept),
    queryFn: async () =>
      kept
        ? fromKept(store, (data) => keptProducts(data, query).length)
        : unwrap(
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
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: keyFor(
      ['rep', 'products', 'of', [...ids].sort((a, b) => a - b).join(','), priceBefore],
      kept,
    ),
    queryFn: async () =>
      kept
        ? fromKept(store, (data) => keptProductsOf(data, ids))
        : unwrap(
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
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: keyFor(['rep', 'products', 'category', id], kept),
    queryFn: async () =>
      kept
        ? fromKept(store, (data) => {
            const page = keptCategoryPage(data, id ?? 0);
            if (!page) throw new ApiProblem({ code: 'NOT_FOUND', status: 404 });
            return page;
          })
        : unwrap(
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
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: keyFor(['rep', 'suppliers'], kept),
    queryFn: kept
      ? () => fromKept(store, (data) => data.suppliers)
      : async () => unwrap(await session.client.GET('/api/v1/sales-rep/suppliers')),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useCustomers(q: string) {
  const { session } = useSignedIn();
  const { kept, store } = useKeptMode();
  return useInfiniteQuery({
    queryKey: keyFor(['rep', 'customers', q], kept),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      kept
        ? fromKept(store, (data) => keptCustomerPage(data, q, pageParam ?? null, PAGE))
        : unwrap(
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

/** A kept customer by id; 404 when it is not kept. */
function keptCustomerOrGone(data: KeptData, id: number): KeptCustomerDetail {
  const found = keptCustomer(data, id);
  if (!found) throw new ApiProblem({ code: 'NOT_FOUND', status: 404 });
  return found;
}

/**
 * A customer with its addresses and contacts. Without the server the kept one, which also carries
 * `creditHold` (the checkout's warning); online it has none.
 */
export function useCustomer(id: number | null) {
  const { session } = useSignedIn();
  const { kept, store } = useKeptMode();
  return useQuery<RepCustomerDetail | KeptCustomerDetail>({
    queryKey: keyFor(['rep', 'customer', id], kept),
    queryFn: kept
      ? () => fromKept(store, (data) => keptCustomerOrGone(data, id ?? 0))
      : async () =>
          unwrap(
            await session.client.GET('/api/v1/sales-rep/customers/{id}', {
              params: { path: { id: id ?? 0 } },
            }),
          ),
    enabled: id !== null,
  });
}

/** The store picker's pick: the customer with its addresses, from the server or the kept copy. */
export function useFetchCustomer() {
  const { session } = useSignedIn();
  const { kept, store } = useKeptMode();
  const queryClient = useQueryClient();
  return useCallback(
    (id: number): Promise<RepCustomerDetail> =>
      queryClient.fetchQuery<RepCustomerDetail>({
        queryKey: keyFor(['rep', 'customer', id], kept),
        queryFn: kept
          ? () => fromKept(store, (data) => keptCustomerOrGone(data, id))
          : async () =>
              unwrap(
                await session.client.GET('/api/v1/sales-rep/customers/{id}', {
                  params: { path: { id } },
                }),
              ),
      }),
    [queryClient, session, kept, store],
  );
}

/** «Бүх ангилал» without the server: the kept top categories (null while online). */
export function useKeptCategoryTiles() {
  const { kept, store } = useKeptMode();
  return useQuery({
    queryKey: ['rep', 'kept-categories'],
    queryFn: () => fromKept(store, keptCategoryTiles),
    enabled: kept,
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
/**
 * The whole cart priced by the server (discounts stack over the cart, ADR-0041). Without the
 * server an estimate from the kept prices (`estimated: true`, ADR-0225 #4): shown only with «≈».
 */
export function useQuote(lines: readonly { productUnitId: number; qty: string }[]) {
  const { session } = useSignedIn();
  const { kept, store } = useKeptMode();
  return useQuery<MaybeEstimated>({
    queryKey: keyFor(['rep', 'quote', canonical(lines)], kept),
    queryFn: kept
      ? () => fromKept(store, (data) => estimateQuote(data.products, lines, phoneToday()))
      : async () =>
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
