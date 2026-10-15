import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type SalesOrder = Schemas['SalesOrderDetail'];
export type SalesOrderLine = Schemas['SalesOrderLine'];
export type SalesOrderSummary = Schemas['SalesOrderSummary'];
export type SalesOrderRequest = Schemas['SalesOrderRequest'];
export type ProductOrderInfo = Schemas['SalesOrderProductInfo'];
export type OrderStatus = SalesOrder['status'];

export interface SalesOrderFilter {
  status?: OrderStatus;
  q?: string;
}

const KEYS = {
  orders: ['sales', 'orders'] as const,
  productInfo: ['sales', 'product-info'] as const,
};

export function useSalesOrders(filter: SalesOrderFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.orders, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-orders', {
          params: {
            query: {
              status: filter.status,
              q: filter.q || undefined,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSalesOrder(id: number, options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.orders, id],
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/sales-orders/{id}', { params: { path: { id } }, signal })),
  });
}

/** Home warehouse, whether it may be sold and the stock available there, per product. */
export function useProductOrderInfo(productIds: readonly number[]) {
  const api = useApiClient();
  const ids = [...new Set(productIds)].sort((a, b) => a - b);
  return useQuery({
    queryKey: [...KEYS.productInfo, ids],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-orders/product-info', {
          params: { query: { productIds: ids.join(',') } },
          signal,
        }),
      ),
  });
}

export function useSalesOrderMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () =>
    Promise.all(
      [KEYS.orders, KEYS.productInfo].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  return {
    create: useMutation({
      mutationFn: async ({ key, body }: { key: string; body: SalesOrderRequest }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: () => changed(),
    }),
    update: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: SalesOrderRequest }) =>
        unwrap(await api.PUT('/api/v1/sales-orders/{id}', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    submit: useMutation({
      mutationFn: async ({ id, key }: { id: number; key: string }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/submit', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: () => changed(),
    }),
    cancel: useMutation({
      mutationFn: async ({ id, key, reason }: { id: number; key: string; reason: string }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/cancel', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { reason },
          }),
        ),
      onSuccess: () => changed(),
    }),
  };
}
