import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { idempotencyKey } from '@tugeel/api-client';
import type {
  ExpiryExceptionView,
  ExpiryChannel,
  ExpiryCommerceView,
  ExpiryReceiptSource,
} from '@tugeel/shared/expiry';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

export interface ExpiryPriceContext {
  warehouseId: number;
  channel: ExpiryChannel;
  contextId: number;
  name: string;
  unitPrice: string | null;
  netUnitPrice: string | null;
}
export interface MarkdownInput {
  expectedVersion: number;
  expectedSourceVersion: number;
  expectedCostingVersion: number;
  expectedLiabilityFingerprint: string;
  receiptLineId: number;
  qtyBase: string;
  warehouseId: number;
  channel: ExpiryChannel;
  contextId: number;
  unitPrice: string;
  payrollMonth?: string;
}

export function useExpiryPrices(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['expiry', 'prices', id],
    queryFn: async ({ signal }) =>
      unwrap<{ productUnitId: number | null; qty: string; data: ExpiryPriceContext[] }>(
        await api.GET('/api/v1/expiry/items/{id}/prices', { params: { path: { id } }, signal }),
      ),
  });
}
export function useExpiryCommerce(id: number, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['expiry', 'commerce', id],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap<ExpiryCommerceView>(
        await api.GET('/api/v1/expiry/items/{id}/commerce', { params: { path: { id } }, signal }),
      ),
  });
}
export function useExpiryReceiptSources(id: number, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['expiry', 'receipt-sources', id],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap<{ data: ExpiryReceiptSource[] }>(
        await api.GET('/api/v1/expiry/items/{id}/receipt-sources', {
          params: { path: { id } },
          signal,
        }),
      ),
  });
}
export function useExpiryCommerceMutations(itemId: number) {
  const api = useApiClient();
  const cache = useQueryClient();
  const changed = (data: ExpiryCommerceView) => {
    cache.setQueryData(['expiry', 'commerce', itemId], data);
    void cache.invalidateQueries({ queryKey: ['expiry', 'item', itemId] });
    void cache.invalidateQueries({ queryKey: ['payroll'] });
  };
  return {
    source: useMutation({
      mutationFn: async (body: {
        expectedVersion: number;
        receiptLineId: number;
        qtyBase: string;
      }) =>
        unwrap<ExpiryCommerceView>(
          await api.PUT('/api/v1/expiry/items/{id}/source', {
            params: { path: { id: itemId } },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    publish: useMutation({
      mutationFn: async ({ key, body }: { key: string; body: MarkdownInput }) =>
        unwrap<ExpiryCommerceView>(
          await api.POST('/api/v1/expiry/items/{id}/markdowns', {
            params: { path: { id: itemId }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    stop: useMutation({
      mutationFn: async ({ id, key }: { id: number; key: string }) =>
        unwrap<ExpiryCommerceView>(
          await api.POST('/api/v1/expiry/markdowns/{id}/stop', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: changed,
    }),
    resolve: useMutation({
      mutationFn: async ({ id, key, note }: { id: number; key: string; note: string }) =>
        unwrap<ExpiryCommerceView>(
          await api.POST('/api/v1/expiry/sale-exceptions/{id}/resolve', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { note },
          }),
        ),
      onSuccess: changed,
    }),
  };
}

export function useExpiryExceptions(enabled: boolean) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: ['expiry', 'commerce-exceptions'],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap<{ data: ExpiryExceptionView[]; nextCursor: string | null }>(
        await api.GET('/api/v1/expiry/commerce-exceptions', {
          params: { query: { cursor: pageParam } },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
export function useAcknowledgeExpiryException() {
  const api = useApiClient();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      origin,
      note,
      key,
    }: {
      id: number;
      origin: ExpiryExceptionView['origin'];
      note: string;
      key: string;
    }) =>
      unwrap(
        await api.POST('/api/v1/expiry/commerce-exceptions/{id}/acknowledge', {
          params: { path: { id }, header: idempotencyKey(key) },
          body: { origin, note },
        }),
      ),
    onSuccess: () => cache.invalidateQueries({ queryKey: ['expiry'] }),
  });
}
