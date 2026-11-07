import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { ExpiryStatus, ExpiryView } from '@tugeel/shared/expiry';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';
import type { ExpiryFilter } from './helpers';

type Schemas = components['schemas'];

export type ExpiryItem = Schemas['ExpiryItemDto'];
export type ExpirySummary = Schemas['ExpirySummaryDto'];
export type ExpiryChange = Schemas['ExpiryChangeDto'];
export type ExpiryRole = Schemas['ExpiryRoleDto'];
export type ExpiryPerson = Schemas['ExpiryPersonDto'];
export type ExpiryLiability = Schemas['ExpiryLiabilityDto'];
export type ExpiryCreateBody = Schemas['ExpiryCreateRequestDto'];
type PatchBody = Schemas['ExpiryPatchRequestDto'];
type LiabilityBody = Schemas['ExpiryLiabilityRequestDto'];

const KEYS = {
  all: ['expiry'] as const,
  summary: ['expiry', 'summary'] as const,
  filters: ['expiry', 'filters'] as const,
  lists: ['expiry', 'list'] as const,
  item: (id: number | null) => ['expiry', 'item', id] as const,
  history: (id: number | null) => ['expiry', 'history', id] as const,
};

const PAGE_SIZE = 50;
/** The most the route answers at once: the print page walks every page with it. */
const PRINT_PAGE_SIZE = 200;
/** A chosen product's open records in the create dialog: more than a shelf ever repeats. */
const PRODUCT_OPEN_LIMIT = 20;

const listQuery = (filter: ExpiryFilter) => ({
  view: filter.view,
  q: filter.q || undefined,
  supplierId: filter.supplierId,
  warehouseId: filter.warehouseId,
  createdByName: filter.createdByName,
  liability: filter.liability,
});

/** The four counts and the server's business date (never the browser's clock). */
export function useExpirySummary() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.summary,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/expiry/summary', { signal })),
  });
}

/** The filter panel's choices, taken from the records in that view. */
export function useExpiryFilters(view: ExpiryView) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.filters, view],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/expiry/filters', { params: { query: { view } }, signal })),
    placeholderData: keepPreviousData,
  });
}

/**
 * A supplier's or a warehouse's name out of any view's choices read so far: the view on screen need
 * not hold the filter that is on, and the filter in the address is only an id.
 */
export function useExpiryFilterName() {
  const queryClient = useQueryClient();
  return (kind: 'suppliers' | 'warehouses', id: number): string | undefined => {
    const views = queryClient.getQueriesData<Schemas['ExpiryFiltersDto']>({
      queryKey: KEYS.filters,
    });
    for (const [, options] of views) {
      const found = options?.[kind].find((option) => option.id === id);
      if (found) return found.name;
    }
    return undefined;
  };
}

export function useExpiryItems(filter: ExpiryFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.lists, 'keyset', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/expiry/items', {
          params: { query: { ...listQuery(filter), cursor: pageParam, limit: PAGE_SIZE } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Every record the filters keep, page after page (the A4 print shows them all). */
export function useAllExpiryItems(filter: ExpiryFilter) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.lists, 'all', filter],
    queryFn: async ({ signal }) => {
      const rows: ExpiryItem[] = [];
      let cursor: string | undefined;
      do {
        const page = unwrap(
          await api.GET('/api/v1/expiry/items', {
            params: { query: { ...listQuery(filter), cursor, limit: PRINT_PAGE_SIZE } },
            signal,
          }),
        );
        rows.push(...page.data);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return rows;
    },
  });
}

/** A product's open records, listed before a new one is added (ADR-0172 #5). */
export function useProductOpenExpiry(productId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.lists, 'product', productId],
    enabled: productId !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/expiry/items', {
          params: {
            query: { view: 'ACTIVE', productId: productId ?? 0, limit: PRODUCT_OPEN_LIMIT },
          },
          signal,
        }),
      ),
  });
}

export function useExpiryItem(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.item(id),
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/expiry/items/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useExpiryHistory(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.history(id),
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/expiry/items/{id}/history', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

/** Every role and all active staff; only holders of `expiry.liability.manage` may read them. */
export function useExpiryLiabilityOptions(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.all, 'liability-options'],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/expiry/liability-options', { signal })),
  });
}

/** The two home tiles (ADR-0172 #10): small capped counts, live like the others. */
export function useExpiryAttention(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ATTENTION_KEY, 'expiry'],
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/expiry/attention', { signal })),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useExpiryMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  /**
   * The answer is the record as it now stands. The record's own query takes it directly: a reload
   * would race the screen's edit, whose version is what keeps a save from overwriting anyone.
   */
  const changed = (item: ExpiryItem) => {
    queryClient.setQueryData(KEYS.item(item.id), item);
    for (const queryKey of [
      KEYS.lists,
      KEYS.summary,
      KEYS.filters,
      KEYS.history(item.id),
      ATTENTION_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  return {
    create: useMutation({
      mutationFn: async (input: { key: string; body: ExpiryCreateBody }) =>
        unwrap(
          await api.POST('/api/v1/expiry/items', {
            params: { header: idempotencyKey(input.key) },
            body: input.body,
          }),
        ),
      onSuccess: changed,
    }),
    patch: useMutation({
      mutationFn: async (input: { id: number; body: PatchBody }) =>
        unwrap(
          await api.PATCH('/api/v1/expiry/items/{id}', {
            params: { path: { id: input.id } },
            body: input.body,
          }),
        ),
      onSuccess: changed,
    }),
    setStatus: useMutation({
      mutationFn: async (input: { id: number; status: ExpiryStatus }) =>
        unwrap(
          await api.PUT('/api/v1/expiry/items/{id}/status', {
            params: { path: { id: input.id } },
            body: { status: input.status },
          }),
        ),
      onSuccess: changed,
    }),
    setLiability: useMutation({
      mutationFn: async (input: { id: number; body: LiabilityBody }) =>
        unwrap(
          await api.PUT('/api/v1/expiry/items/{id}/liability', {
            params: { path: { id: input.id } },
            body: input.body,
          }),
        ),
      onSuccess: changed,
    }),
  };
}
