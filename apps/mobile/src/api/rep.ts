import type { components } from '@tugeel/api-client';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { canonical } from '../cart/send';
import type { ShopQuery } from '../shop/filters';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

export type RepContext = components['schemas']['SalesRepContext'];
export type RepWarehouse = components['schemas']['SalesRepWarehouse'];
export type RepProduct = components['schemas']['SalesRepProduct'];
export type RepUnit = components['schemas']['SalesRepProductUnit'];
export type RepSupplier = components['schemas']['SalesRepSupplier'];
export type RepCustomer = components['schemas']['SalesRepCustomer'];
export type RepCustomerDetail = components['schemas']['SalesRepCustomerDetail'];
export type RepOrder = components['schemas']['SalesRepOrder'];
export type RepOrderSummary = components['schemas']['SalesRepOrderSummary'];
export type Category = components['schemas']['Category'];
export type Quote = components['schemas']['Quote'];

const PAGE = 30;

/** Days and a search of the rep's orders (ADR-0066). */
export interface OrderRange {
  from: string;
  to: string;
  q: string;
}

/** Today, the stages the rep may place on, the warehouses and branches (ADR-0061 #5, ADR-0066). */
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
 * `priceBefore`, each base price on that day too (a price-drop notice's old price).
 */
export function useProductsOf(ids: readonly number[], priceBefore?: string) {
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

/** The rep's own orders made on the days of a range, newest first, with the range's summary. */
export function useOrders(range: OrderRange | null) {
  const { session } = useSignedIn();
  const q = range?.q.trim() ?? '';
  return useInfiniteQuery({
    queryKey: ['rep', 'orders', range?.from, range?.to, q],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/orders', {
          params: {
            query: {
              from: range?.from ?? '',
              to: range?.to ?? '',
              ...(q ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: range !== null,
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
