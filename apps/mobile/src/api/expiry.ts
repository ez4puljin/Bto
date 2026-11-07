import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// «Хугацаа илрүүлэлт» (ADR-0172 #9): the register's reads and the writes a phone may make. Every
// write refreshes `['expiry']`, so the list and its chips follow, and does not wait for that: on bad
// Wi-Fi the reads would hold a save's own answer back for half a minute with the buttons disabled.
// Liability is assigned on the web.

export type ExpiryItem = components['schemas']['ExpiryItemDto'];
export type ExpiryChange = components['schemas']['ExpiryChangeDto'];
export type ExpiryStatus = components['schemas']['ExpiryStatus'];
export type ExpiryView = components['schemas']['ExpiryView'];
export type ExpiryCreate = components['schemas']['ExpiryCreateRequestDto'];
export type ExpiryPatchBody = components['schemas']['ExpiryPatchRequestDto'];
export type ExpiryRole = components['schemas']['ExpiryRoleDto'];

const PAGE = 30;
/** More open records of one product than anyone reads on a phone. */
const OPEN_LIMIT = 20;
const SEARCH_LIMIT = 20;

/** The counts and the server's business date: the phone never reads its own clock for this. */
export function useExpirySummary() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['expiry', 'summary'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/expiry/summary')),
    refetchOnMount: true,
  });
}

/** A view's records, soonest date first (archived: latest first), page by page. */
export function useExpiryItems(view: ExpiryView, q: string) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['expiry', 'list', view, q],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/expiry/items', {
          params: {
            query: {
              view,
              ...(q ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    refetchOnMount: true,
  });
}

/** A chosen product's open records, shown before a new one is written (ADR-0172 #5). */
export function useOpenExpiryItems(productId: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['expiry', 'open', productId],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/expiry/items', {
          params: {
            query: { view: 'ACTIVE', productId: productId ?? 0, limit: OPEN_LIMIT },
          },
        }),
      ),
    enabled: productId !== null,
  });
}

export function useExpiryItem(id: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['expiry', 'item', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/expiry/items/{id}', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
    refetchOnMount: true,
  });
}

/** The quantity history, oldest first. */
export function useExpiryHistory(id: number) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['expiry', 'history', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/expiry/items/{id}/history', {
          params: { path: { id } },
        }),
      ),
    refetchOnMount: true,
  });
}

/**
 * Names, codes and barcodes of every product, an inactive one too: its goods are still on the shelf
 * (ADR-0172 #2), which is why this reads the product list and not `/products/lookup`, whose answer
 * is active products only. The first page is enough for a picker. Empty text asks nothing.
 */
export function useProductSearch(q: string) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['expiry', 'products', q],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/products', {
          params: { query: { q, limit: SEARCH_LIMIT } },
        }),
      ).data,
    enabled: q !== '',
    placeholderData: keepPreviousData,
  });
}

/**
 * Whether the product's base unit takes decimals; null until known. Neither the barcode's answer
 * nor the search's carries it, so the product itself is read once.
 */
export function useBaseUnitFractional(productId: number | null): boolean | null {
  const { session } = useSignedIn();
  const product = useQuery({
    queryKey: ['expiry', 'product', productId],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/products/{id}', {
          params: { path: { id: productId ?? 0 } },
        }),
      ),
    enabled: productId !== null,
    staleTime: 5 * 60_000,
  });
  return product.data?.units.find((unit) => unit.isBase)?.fractional ?? null;
}

/** One new record; the key is kept by the form, so a retried save is answered once. */
export function useCreateExpiryItem() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: ExpiryCreate }) =>
      unwrap(
        await session.client.POST('/api/v1/expiry/items', {
          body,
          params: { header: { 'Idempotency-Key': key } },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['expiry'] });
    },
  });
}

/** A correction: refused with EXPIRY_ITEM_CHANGED when someone edited the record since. */
export function usePatchExpiryItem() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: ExpiryPatchBody }) =>
      unwrap(
        await session.client.PATCH('/api/v1/expiry/items/{id}', {
          params: { path: { id } },
          body,
        }),
      ),
    onSuccess: (item) => queryClient.setQueryData(['expiry', 'item', item.id], item),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['expiry'] });
    },
  });
}

/** A status, archiving or restoring (`expiry.items.manage`). */
export function useSetExpiryStatus() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: ExpiryStatus }) =>
      unwrap(
        await session.client.PUT('/api/v1/expiry/items/{id}/status', {
          params: { path: { id } },
          body: { status },
        }),
      ),
    onSuccess: (item) => queryClient.setQueryData(['expiry', 'item', item.id], item),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['expiry'] });
    },
  });
}
