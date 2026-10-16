import type { components } from '@tugeel/api-client';
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { canonical } from '../cart/send';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

export type RepContext = components['schemas']['SalesRepContext'];
export type RepProduct = components['schemas']['SalesRepProduct'];
export type RepCustomer = components['schemas']['SalesRepCustomer'];
export type RepCustomerDetail = components['schemas']['SalesRepCustomerDetail'];
export type RepOrder = components['schemas']['SalesRepOrder'];
export type RepOrderSummary = components['schemas']['SalesRepOrderSummary'];
export type Category = components['schemas']['Category'];
export type Quote = components['schemas']['Quote'];

const PAGE = 30;

/** Today, the stages the rep may place on and the default one (ADR-0061 #5). */
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

export function useProducts(q: string, categoryId: number | null) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['rep', 'products', q, categoryId],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/products', {
          params: {
            query: {
              ...(q ? { q } : {}),
              ...(categoryId ? { categoryId } : {}),
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

/** Products by id, as the shop would list them (a scanned barcode, a product page). */
export function useProductsOf(ids: readonly number[]) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['rep', 'products', 'of', [...ids].sort((a, b) => a - b).join(',')],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/products/batch', {
          params: { query: { productIds: ids.join(',') } },
        }),
      ),
    enabled: ids.length > 0,
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

export function useOrders(month: string) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['rep', 'orders', month],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/sales-rep/orders', {
          params: { query: { month, ...(pageParam ? { cursor: pageParam } : {}), limit: PAGE } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: /^\d{4}-\d{2}$/.test(month),
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
