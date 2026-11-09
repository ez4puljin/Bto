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
import { unwrap } from '@/lib/problem';
import { KEYS } from './api';

// Product counts (ADR-0176): the count window, its approval and the variance report.

type Schemas = components['schemas'];
export type StockCountSummary = Schemas['StockCountSummary'];
export type StockCountDetail = Schemas['StockCountDetail'];
export type StockCountSession = Schemas['StockCountSession'];
export type StockCountLine = Schemas['StockCountLine'];
export type StockCountEntry = Schemas['StockCountEntry'];
export type StockCountMovedDocument = Schemas['StockCountMovedDocument'];
export type StockCountVarianceRow = Schemas['StockCountVarianceRow'];
export type StockCountSettlement = Schemas['StockCountSettlement'];
export type StockCountSettlementInput = Schemas['StockCountSettlementInput'];
export type StockCountParty = Schemas['StockCountParty'];
export type StockCountPartyKind = StockCountParty['kind'];
export type StockCountCreate = Schemas['StockCountCreateRequest'];
export type StockCountScope = StockCountCreate['scopeMode'];
export type StockCountStatus = StockCountSummary['status'];
export type StockCountUncounted = Schemas['StockCountApproveRequest']['uncounted'];
export type StockCountAccountChoice = Schemas['StockCountAccountChoice'];

export const COUNT_LINE_FILTERS = ['ALL', 'COUNTED', 'UNCOUNTED', 'DIFFERENT', 'MOVED'] as const;
export type StockCountLineFilter = (typeof COUNT_LINE_FILTERS)[number];

const COUNTS = ['inventory', 'counts'] as const;

export interface StockCountFilter {
  warehouseId?: number;
  status?: StockCountStatus;
}

export function useStockCounts(filter: StockCountFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...COUNTS, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-counts', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The count window; refreshed while people are counting, so sent numbers show up by themselves. */
export function useStockCount(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...COUNTS, id, 'detail'],
    enabled: Number.isInteger(id),
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/stock-counts/{id}', { params: { path: { id } }, signal })),
    refetchInterval: (query) => (query.state.data?.status === 'COUNTING' ? 15_000 : false),
  });
}

export function useStockCountLines(
  id: number,
  filter: StockCountLineFilter,
  q: string,
  live: boolean,
) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...COUNTS, id, 'lines', filter, q],
    enabled: Number.isInteger(id),
    initialPageParam: undefined as string | undefined,
    refetchInterval: live ? 15_000 : false,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-counts/{id}/lines', {
          params: {
            path: { id },
            query: { filter, q: q || undefined, cursor: pageParam, limit: 100 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useStockCountLineEntries(id: number, lineId: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...COUNTS, id, 'entries', lineId],
    enabled: lineId !== undefined,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-counts/{id}/lines/{lineId}/entries', {
          params: { path: { id, lineId: lineId ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useStockCountLineMoved(id: number, lineId: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...COUNTS, id, 'moved', lineId],
    enabled: lineId !== undefined,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-counts/{id}/lines/{lineId}/moved', {
          params: { path: { id, lineId: lineId ?? 0 } },
          signal,
        }),
      ),
  });
}

/** The accounts a count's difference may go to (kept in the finance settings). */
export function useStockCountAccountChoices(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...COUNTS, 'accounts'],
    enabled,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/stock-counts/accounts', { signal })),
  });
}

export interface StockCountVarianceFilter {
  from: string;
  to: string;
  warehouseId?: number;
  q?: string;
}

export function useStockCountVariance(filter: StockCountVarianceFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...COUNTS, 'variance', filter],
    enabled: filter.from !== '' && filter.to !== '',
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-counts/variance', {
          params: {
            query: { ...filter, q: filter.q || undefined, cursor: pageParam, limit: 100 },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useStockCountMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(
      [...keys, ATTENTION_KEY].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  const changed = () => invalidate(COUNTS);

  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: StockCountCreate & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/stock-counts', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    close: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/stock-counts/{id}/close', { params: { path: { id } } })),
      onSuccess: changed,
    }),
    reopen: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/stock-counts/{id}/reopen', { params: { path: { id } } })),
      onSuccess: changed,
    }),
    cancel: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/stock-counts/{id}/cancel', { params: { path: { id } } })),
      onSuccess: changed,
    }),
    approve: useMutation({
      mutationFn: async ({ id, uncounted }: { id: number; uncounted: StockCountUncounted }) =>
        unwrap(
          await api.POST('/api/v1/stock-counts/{id}/approve', {
            params: { path: { id } },
            body: { uncounted },
          }),
        ),
      // The warehouse's stock becomes the counted quantity.
      onSuccess: () => invalidate(COUNTS, KEYS.stock),
    }),
    defaults: useMutation({
      mutationFn: async ({
        id,
        ...body
      }: {
        id: number;
        surplus?: StockCountSettlementInput | null;
        shortage?: StockCountSettlementInput | null;
      }) =>
        unwrap(
          await api.PUT('/api/v1/stock-counts/{id}/defaults', { params: { path: { id } }, body }),
        ),
      onSuccess: changed,
    }),
    lineSettlement: useMutation({
      mutationFn: async ({
        id,
        lineId,
        settlement,
      }: {
        id: number;
        lineId: number;
        settlement: StockCountSettlementInput | null;
      }) =>
        unwrap(
          await api.PUT('/api/v1/stock-counts/{id}/lines/{lineId}/settlement', {
            params: { path: { id, lineId } },
            body: { settlement },
          }),
        ),
      onSuccess: changed,
    }),
    sendFor: useMutation({
      mutationFn: async ({ id, sessionId }: { id: number; sessionId: number }) =>
        unwrap(
          await api.POST('/api/v1/stock-counts/{id}/sessions/{sessionId}/send', {
            params: { path: { id, sessionId } },
          }),
        ),
      onSuccess: changed,
    }),
  };
}
