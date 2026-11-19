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
export type ErkhetApplyRequest = Schemas['ErkhetApplyRequest'];

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
    /**
     * The ticked rows, or every open row of one issue as many as one request takes; with the
     * category and the price profile chosen for new and unpriced products (ADR-0222).
     */
    apply: useMutation({
      mutationFn: async (body: ErkhetApplyRequest) =>
        unwrap(await api.POST('/api/v1/erkhet/sync/apply', { body })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS.items }),
    }),
  };
}

// ------------------------------------------------------------------------------------------------
// «Авлага, өглөгийн гүйлгээ» (ADR-0219)

export type ErkhetLedgerOverview = Schemas['ErkhetLedgerOverview'];
export type ErkhetLedgerRun = Schemas['ErkhetLedgerRun'];
export type ErkhetLedgerStart = Schemas['ErkhetLedgerStartRequest'];
export type ErkhetLedgerParty = Schemas['ErkhetLedgerParty'];
export type ErkhetLedgerOwnDocument = Schemas['ErkhetLedgerOwnDocument'];
export type ErkhetLedgerLink = Schemas['ErkhetLedgerLink'];

const LEDGER_KEYS = {
  overview: ['erkhet', 'ledger', 'overview'] as const,
  parties: ['erkhet', 'ledger', 'parties'] as const,
  own: ['erkhet', 'ledger', 'own'] as const,
  links: ['erkhet', 'ledger', 'links'] as const,
};

/** The copy's state; asked again every few seconds while a run is under way. */
export function useErkhetLedger(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: LEDGER_KEYS.overview,
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/erkhet/ledger', { signal })),
    refetchInterval: (query) => (query.state.data?.active ? RUNNING_POLL_MS : false),
  });
}

/** Starts a check, a post or a revert; a refusal comes back as an answer, not an error. */
export function useErkhetLedgerStart() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ErkhetLedgerStart) =>
      unwrap(await api.POST('/api/v1/erkhet/ledger/runs', { body })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['erkhet', 'ledger'] }),
  });
}

export interface ErkhetLedgerPartyFilter {
  /** The run the totals belong to: a new run is a new list. */
  runId: number | null;
  unmatched: boolean;
  q: string;
}

export function useErkhetLedgerParties(filter: ErkhetLedgerPartyFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...LEDGER_KEYS.parties, filter],
    enabled: filter.runId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/erkhet/ledger/parties', {
          params: {
            query: {
              unmatched: filter.unmatched || undefined,
              q: filter.q || undefined,
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

/** Bto's own documents on the copied accounts: with the copies they count twice. */
export function useErkhetOwnDocuments(enabled: boolean, runId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...LEDGER_KEYS.own, runId],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/erkhet/ledger/own-documents', { signal })),
  });
}

/**
 * Where the copied transactions of a ledger page open in Erkhet, by their key. Asked only when the
 * page holds such rows; a failure leaves the rows without a link.
 */
export function useErkhetLinks(keys: readonly string[]): ReadonlyMap<string, ErkhetLedgerLink> {
  const api = useApiClient();
  const sorted = [...new Set(keys)].sort().slice(0, 200);
  const links = useQuery({
    queryKey: [...LEDGER_KEYS.links, sorted],
    enabled: sorted.length > 0,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/erkhet/ledger/links', {
          params: { query: { keys: sorted.join(',') } },
          signal,
        }),
      ),
  });
  return new Map((links.data ?? []).map((link) => [link.key, link]));
}

/** The keys of the copied transactions among a ledger page's rows, for `useErkhetLinks`. */
export function erkhetKeysOf(
  rows: readonly { erkhet?: Schemas['LedgerErkhetEntry'] | null }[],
): string[] {
  return rows.flatMap((row) => (row.erkhet?.key ? [row.erkhet.key] : []));
}
