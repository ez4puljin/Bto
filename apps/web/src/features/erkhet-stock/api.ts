import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ErkhetStockOverview = Schemas['ErxesStockOverview'];
export type ErkhetStockRun = Schemas['ErxesStockRun'];
export type ErkhetStockLocation = Schemas['ErxesStockLocation'];
export type ErkhetStockComparison = Schemas['ErxesStockComparison'];
export type ErkhetStockRow = Schemas['ErxesStockRow'];
export type ErkhetStockGroup = 'MATCHED' | 'NOT_IN_BTO' | 'NOT_IN_ERKHET';

const KEYS = {
  overview: ['erkhet-stock', 'overview'] as const,
  locations: ['erkhet-stock', 'locations'] as const,
  compare: ['erkhet-stock', 'compare'] as const,
};

/** While a run works the page asks every few seconds for its progress. */
const RUNNING_POLL_MS = 3_000;

const isRunning = (overview: ErkhetStockOverview | undefined) => Boolean(overview?.active);

/** The last run, the one under way and the one that failed (ADR-0221). */
export function useErkhetStockOverview() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useQuery<ErkhetStockOverview>({
    queryKey: KEYS.overview,
    refetchInterval: (query) => (isRunning(query.state.data) ? RUNNING_POLL_MS : false),
    queryFn: async ({ signal }): Promise<ErkhetStockOverview> => {
      const before = queryClient.getQueryData<ErkhetStockOverview>(KEYS.overview);
      const next = unwrap(await api.GET('/api/v1/erxes/stock', { signal }));
      // A run that just ended brings new rows to compare.
      if (before?.active && !next.active) {
        void queryClient.invalidateQueries({ queryKey: KEYS.compare });
        void queryClient.invalidateQueries({ queryKey: KEYS.locations });
      }
      return next;
    },
  });
}

export function useErkhetStockLocations() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.locations,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/erxes/stock/locations', { signal })),
  });
}

export interface ErkhetStockFilter {
  warehouseId: number | null;
  group: ErkhetStockGroup;
  onlyDifferent: boolean;
  q: string;
}

export function useErkhetStockCompare(filter: ErkhetStockFilter) {
  const api = useApiClient();
  const { warehouseId, group, onlyDifferent, q } = filter;
  return useInfiniteQuery({
    queryKey: [...KEYS.compare, warehouseId, group, onlyDifferent, q],
    enabled: warehouseId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/erxes/stock/compare', {
          params: {
            query: {
              warehouseId: warehouseId ?? 0,
              group,
              onlyDifferent,
              ...(q ? { q } : {}),
              cursor: pageParam,
              limit: 100,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useErkhetStockMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    /** «Үлдэгдэл татах»: the worker reads Erkhet's balances in the background. */
    start: useMutation({
      mutationFn: async () => unwrap(await api.POST('/api/v1/erxes/stock/runs')),
      onSuccess: (overview) => queryClient.setQueryData(KEYS.overview, overview),
    }),
    link: useMutation({
      mutationFn: async ({ code, warehouseId }: { code: string; warehouseId: number | null }) =>
        unwrap(
          await api.PATCH('/api/v1/erxes/stock/locations/{code}', {
            params: { path: { code } },
            body: { warehouseId },
          }),
        ),
      onSuccess: (locations) => {
        queryClient.setQueryData(KEYS.locations, locations);
        return queryClient.invalidateQueries({ queryKey: KEYS.compare });
      },
    }),
  };
}
