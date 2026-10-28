import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { formatTugrik, plainDecimal } from '@/lib/money';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type VoucherBatch = Schemas['PosVoucherBatch'];
export type VoucherBatchDetail = Schemas['PosVoucherBatchDetail'];
export type VoucherBatchRequest = Schemas['PosVoucherBatchRequest'];
export type VoucherCode = Schemas['PosVoucherCode'];
export type VoucherUse = Schemas['PosVoucherUse'];
export type VoucherBatchKind = VoucherBatch['kind'];
export type VoucherBatchStatus = VoucherBatch['status'];

/** A batch's value as printed: «10%» or «5,000₮». */
export function voucherValueText(batch: Pick<VoucherBatch, 'effect' | 'value'>): string {
  return batch.effect === 'PERCENT' ? `${plainDecimal(batch.value)}%` : formatTugrik(batch.value);
}

/** The till's coupons and partner vouchers (ADR-0110). */
export const VOUCHER_KEYS = {
  batches: ['pos', 'vouchers'] as const,
};

export interface VoucherBatchFilter {
  kind?: VoucherBatchKind;
  status?: VoucherBatchStatus;
  q?: string;
}

export function useVoucherBatches(filter: VoucherBatchFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...VOUCHER_KEYS.batches, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/voucher-batches', {
          params: { query: { ...filter, q: filter.q || undefined, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useVoucherBatch(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...VOUCHER_KEYS.batches, 'detail', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/voucher-batches/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

/** Creating, stopping and «Шалгасан»; each refreshes the batches (and the home counts). */
export function useVoucherMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = (...keys: readonly (readonly string[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: VoucherBatchRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/pos/voucher-batches', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(VOUCHER_KEYS.batches),
    }),
    stop: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/pos/voucher-batches/{id}/stop', { params: { path: { id } } }),
        ),
      onSuccess: () => refresh(VOUCHER_KEYS.batches),
    }),
    review: useMutation({
      mutationFn: async ({ id, note }: { id: number; note: string | null }) =>
        unwrap(
          await api.POST('/api/v1/pos/sale-vouchers/{id}/review', {
            params: { path: { id } },
            body: { note },
          }),
        ),
      onSuccess: () => refresh(VOUCHER_KEYS.batches, ATTENTION_KEY),
    }),
  };
}
