import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type SalesBoard = Schemas['SalesBoard'];
export type SalesStage = Schemas['SalesStage'];
export type SalesStageRequest = Schemas['SalesStageRequest'];
export type SalesChannelDefault = Schemas['SalesChannelDefault'];
export type StageCards = Schemas['SalesStageCards'];
export type OrderCard = Schemas['SalesOrderCard'];
export type PickLineInfo = Schemas['SalesOrderPickLineInfo'];
export type MoveResult = Schemas['SalesOrderMoveResult'];

export const BOARD_KEYS = {
  boards: ['sales', 'boards'] as const,
  cards: (boardId: number) => ['sales', 'boards', boardId, 'cards'] as const,
  defaults: ['sales', 'boards', 'defaults'] as const,
  pickInfo: (orderId: number) => ['sales', 'orders', orderId, 'pick-info'] as const,
};
const ORDER_KEYS = ['sales', 'orders'] as const;

export function useSalesBoards(archived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...BOARD_KEYS.boards, 'list', archived],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-boards', {
          params: { query: archived ? { archived: 'true' } : {} },
          signal,
        }),
      ),
  });
}

export function useSalesBoard(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...BOARD_KEYS.boards, id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-boards/{id}', { params: { path: { id: id ?? 0 } }, signal }),
      ),
  });
}

/** The board's cards; read again every 30 s and when the window regains focus (others move cards). */
export function useBoardCards(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: BOARD_KEYS.cards(id ?? 0),
    enabled: id !== null,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-boards/{id}/cards', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useChannelDefaults() {
  const api = useApiClient();
  return useQuery({
    queryKey: BOARD_KEYS.defaults,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/sales-boards/defaults', { signal })),
  });
}

export function usePickInfo(orderId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: BOARD_KEYS.pickInfo(orderId ?? 0),
    enabled: orderId !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-orders/{id}/pick-info', {
          params: { path: { id: orderId ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useBoardMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () =>
    Promise.all(
      [BOARD_KEYS.boards, ORDER_KEYS].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  return {
    createBoard: useMutation({
      mutationFn: async (body: { name: string; branchId: number | null }) =>
        unwrap(await api.POST('/api/v1/sales-boards', { body })),
      onSuccess: () => changed(),
    }),
    updateBoard: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; name: string; branchId: number | null }) =>
        unwrap(await api.PUT('/api/v1/sales-boards/{id}', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    archiveBoard: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/sales-boards/{id}', { params: { path: { id } } })),
      onSuccess: () => changed(),
    }),
    setBoardRoles: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; VIEW: number[]; MANAGE: number[] }) =>
        unwrap(
          await api.PUT('/api/v1/sales-boards/{id}/roles', { params: { path: { id } }, body }),
        ),
      onSuccess: () => changed(),
    }),
    addStage: useMutation({
      mutationFn: async ({ boardId, body }: { boardId: number; body: SalesStageRequest }) =>
        unwrap(
          await api.POST('/api/v1/sales-boards/{id}/stages', {
            params: { path: { id: boardId } },
            body,
          }),
        ),
      onSuccess: () => changed(),
    }),
    updateStage: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: SalesStageRequest }) =>
        unwrap(await api.PUT('/api/v1/sales-stages/{id}', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    archiveStage: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/sales-stages/{id}', { params: { path: { id } } })),
      onSuccess: () => changed(),
    }),
    reorderStages: useMutation({
      mutationFn: async ({ boardId, stageIds }: { boardId: number; stageIds: number[] }) =>
        unwrap(
          await api.PUT('/api/v1/sales-boards/{id}/stage-order', {
            params: { path: { id: boardId } },
            body: { stageIds },
          }),
        ),
      onSuccess: () => changed(),
    }),
    setDefault: useMutation({
      mutationFn: async (body: {
        channel: SalesChannelDefault['channel'];
        boardId: number | null;
        stageId: number | null;
      }) => unwrap(await api.PUT('/api/v1/sales-boards/defaults', { body })),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: BOARD_KEYS.defaults }),
    }),
    move: useMutation({
      mutationFn: async ({
        orderId,
        key,
        stageId,
        reason,
      }: {
        orderId: number;
        key: string;
        stageId: number;
        reason?: string;
      }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/move', {
            params: { path: { id: orderId }, header: idempotencyKey(key) },
            body: { stageId, ...(reason ? { reason } : {}) },
          }),
        ),
      onSuccess: () => changed(),
    }),
    pick: useMutation({
      mutationFn: async ({
        orderId,
        key,
        lines,
      }: {
        orderId: number;
        key: string;
        lines: { lineId: number; qty: string; binId: number }[];
      }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/pick', {
            params: { path: { id: orderId }, header: idempotencyKey(key) },
            body: { lines },
          }),
        ),
      onSuccess: () => changed(),
    }),
  };
}

/** The printable page of an order (ADR-0056 #7), opened in a new tab. */
export function orderPrintPath(orderId: number, kind: 'PICK_LIST' | 'DELIVERY_NOTE'): string {
  return `/sales/orders/${orderId}/print/${kind}`;
}
