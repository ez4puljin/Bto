import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useSignedIn } from '../state/session';
import type {
  TransferCountEntry,
  TransferRequestChange,
  TransferRequestCreateRequest,
} from '../transfers/types';
import type { TransferStatus } from '../transfers/statuses';
import { ApiProblem, unwrap } from './problem';

// The store seller's transfer requests (ADR-0116): what the context allows, the rows to request
// from, the requests and one request, and the writes; every write refreshes `['transfers']`.

const PAGE = 30;

/** The STORE warehouses the user may request for (none for a keeper) and the server's today. */
export function useTransferContext() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['transfers', 'context'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/transfer-requests/context')),
    staleTime: 60_000,
  });
}

export interface RowsQuery {
  warehouseId: number;
  q: string;
  /** Show this request's lines beside the products (editing a DRAFT). */
  requestId?: number;
  /** REQUESTED: only the request's products. */
  filter?: 'ALL' | 'REQUESTED';
}

function rowParams(query: RowsQuery) {
  return {
    warehouseId: query.warehouseId,
    ...(query.q ? { q: query.q } : {}),
    ...(query.requestId !== undefined ? { requestId: query.requestId } : {}),
    ...(query.filter !== undefined ? { filter: query.filter } : {}),
  };
}

/**
 * The products a store may request, page by page, with the store's and the home's stock and
 * last month's sales (ADR-0116 #3); `q` is the search, already debounced by the screen.
 */
export function useTransferRows(query: RowsQuery | null) {
  const { session } = useSignedIn();
  const params = query ? rowParams(query) : null;
  return useInfiniteQuery({
    queryKey: ['transfers', 'rows', params],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/transfer-requests/rows', {
          params: {
            query: {
              ...(params ?? { warehouseId: 0 }),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: params !== null,
  });
}

/** A store's requests, newest first; one status when the chip asks for one. */
export function useTransferRequests(warehouseId: number | null, status: TransferStatus | null) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: ['transfers', 'list', warehouseId, status],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/transfer-requests', {
          params: {
            query: {
              ...(warehouseId !== null ? { warehouseId } : {}),
              ...(status !== null ? { status } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
              limit: PAGE,
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled: warehouseId !== null,
  });
}

export function useTransferRequest(id: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['transfers', 'request', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/transfer-requests/{id}', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

/** After any write: every transfer query is stale. */
function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['transfers'] });
}

/** `POST /transfer-requests` as the idempotent send posts it (the key comes from the send). */
export function usePostTransferRequest() {
  const { session } = useSignedIn();
  return (body: TransferRequestCreateRequest, key: string) =>
    session.client.POST('/api/v1/transfer-requests', {
      body,
      params: { header: { 'Idempotency-Key': key } },
    });
}

/** Sends a DRAFT request: every group gets its TR- number. */
export function useRequestTransfer() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap(
        await session.client.POST('/api/v1/transfer-requests/{id}/request', {
          params: { path: { id } },
        }),
      ),
    onSettled: refresh,
  });
}

/** Takes a sent request back to DRAFT (refused once a group is shipped). */
export function useReopenTransferRequest() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap(
        await session.client.POST('/api/v1/transfer-requests/{id}/reopen', {
          params: { path: { id } },
        }),
      ),
    onSettled: refresh,
  });
}

export function useCancelTransferRequest() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: number; reason?: string }) =>
      unwrap(
        await session.client.POST('/api/v1/transfer-requests/{id}/cancel', {
          params: { path: { id } },
          body: reason ? { reason } : {},
        }),
      ),
    onSettled: refresh,
  });
}

export function useUpdateTransferRequestNote() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ id, note }: { id: number; note: string | null }) =>
      unwrap(
        await session.client.PATCH('/api/v1/transfer-requests/{id}', {
          params: { path: { id } },
          body: { note },
        }),
      ),
    onSettled: refresh,
  });
}

/** The cell saves of an edited DRAFT: each change with the value the screen opened with. */
export function useSaveTransferRequestLines() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ id, changes }: { id: number; changes: TransferRequestChange[] }) =>
      unwrap(
        await session.client.PUT('/api/v1/transfer-requests/{id}/lines', {
          params: { path: { id } },
          body: { changes },
        }),
      ),
    onSettled: refresh,
  });
}

/** One count of a shipped group's line (`PUT /transfers/:id/counts`, last write wins). */
export function useSaveCount() {
  const { session } = useSignedIn();
  return (groupId: number, entry: TransferCountEntry) =>
    session.client.PUT('/api/v1/transfers/{id}/counts', {
      params: { path: { id: groupId } },
      body: { entries: [entry] },
    });
}

/** A product found at the store that was not asked for, counted at once (ADR-0116 #5). */
export function useAddCountLine() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({
      groupId,
      key,
      productId,
      productUnitId,
      qty,
    }: {
      groupId: number;
      key: string;
      productId: number;
      productUnitId: number;
      qty: string;
    }) =>
      unwrap(
        await session.client.POST('/api/v1/transfers/{id}/count-lines', {
          params: { path: { id: groupId }, header: { 'Idempotency-Key': key } },
          body: { productId, productUnitId, qty },
        }),
      ),
    onSettled: refresh,
  });
}

/** Removes an unrequested line while the group is SHIPPED. */
export function useRemoveTransferLine() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (lineId: number) =>
      unwrap(
        await session.client.DELETE('/api/v1/transfer-lines/{id}', {
          params: { path: { id: lineId } },
        }),
      ),
    onSettled: refresh,
  });
}

/** SHIPPED → COUNTED: every line counted, else 409 TRANSFER_LINES_UNCOUNTED. */
export function useFinishCount() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async (groupId: number) =>
      unwrap(
        await session.client.POST('/api/v1/transfers/{id}/finish-count', {
          params: { path: { id: groupId } },
        }),
      ),
    onSettled: refresh,
  });
}

/** A barcode to its product and unit; null when the server does not know it (404). */
export function useBarcodeLookup() {
  const { session } = useSignedIn();
  return async (code: string) => {
    try {
      return unwrap(
        await session.client.GET('/api/v1/barcodes/{code}', { params: { path: { code } } }),
      );
    } catch (error) {
      if (error instanceof ApiProblem && error.problem.status === 404) return null;
      throw error;
    }
  };
}
