import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import type { ErkhetSyncIssue, ErkhetSyncKind } from '@tugeel/shared/erkhet';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ErkhetSettings = Schemas['ErkhetSettings'];
export type ErkhetSettingsUpdate = Schemas['ErkhetSettingsUpdateRequest'];
export type ErkhetSettingsTest = Schemas['ErkhetSettingsTestRequest'];
export type ErkhetCheck = Schemas['ErkhetSettingsTestResult'];
export type ErkhetOverview = Schemas['ErkhetOverview'];
export type ErkhetRun = Schemas['ErkhetRun'];
export type ErkhetListSummary = Schemas['ErkhetListSummary'];
export type ErkhetItem = Schemas['ErkhetItem'];
export type ErkhetApplyResult = Schemas['ErkhetApplyResult'];

const KEYS = {
  settings: ['erkhet', 'settings'] as const,
  overview: ['erkhet', 'overview'] as const,
  items: ['erkhet', 'items'] as const,
};

/** How often the page asks while a check is under way. */
const RUNNING_POLL_MS = 3_000;

export function useErkhetSettings(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/erkhet/settings', { signal })),
  });
}

export function useErkhetSettingsMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (body: ErkhetSettingsUpdate) =>
        unwrap(await api.PATCH('/api/v1/erkhet/settings', { body })),
      onSuccess: (view) => {
        queryClient.setQueryData(KEYS.settings, view);
        return queryClient.invalidateQueries({ queryKey: KEYS.overview });
      },
    }),
    /** Signs in to Erkhet with what is typed, or with what is saved; saves nothing. */
    test: useMutation({
      mutationFn: async (body: ErkhetSettingsTest) =>
        unwrap(await api.POST('/api/v1/erkhet/settings/test', { body })),
    }),
  };
}

/** The checks' state; asked again every few seconds while one is under way. */
export function useErkhetOverview() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.overview,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/erkhet/sync', { signal })),
    refetchInterval: (query) => (query.state.data?.active ? RUNNING_POLL_MS : false),
  });
}

export interface ErkhetItemFilter {
  /** The check the rows belong to: a new check is a new list. */
  runId: number | null;
  kind: ErkhetSyncKind;
  issue: ErkhetSyncIssue;
  q: string;
  open: boolean;
}

export function useErkhetItems(filter: ErkhetItemFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.items, filter],
    enabled: filter.runId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/erkhet/sync/items', {
          params: {
            query: {
              kind: filter.kind,
              issue: filter.issue,
              q: filter.q || undefined,
              open: filter.open || undefined,
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

export function useErkhetActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    start: useMutation({
      mutationFn: async () => unwrap(await api.POST('/api/v1/erkhet/sync/runs')),
      onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS.overview }),
    }),
    /** Every open row of one issue, as many as one request takes. */
    apply: useMutation({
      mutationFn: async (body: { kind: ErkhetSyncKind; issue: ErkhetSyncIssue }) =>
        unwrap(await api.POST('/api/v1/erkhet/sync/apply', { body })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS.items }),
    }),
  };
}
