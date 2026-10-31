import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { CardSort, OrderChannel, PrintKind } from '@tugeel/shared/sales';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';
import { type PrintFormat, printFormatParam } from '@/lib/print-format';

type Schemas = components['schemas'];
export type SalesBoard = Schemas['SalesBoard'];
export type PipelineSummary = Schemas['SalesPipelineSummary'];
export type SalesPipeline = Schemas['SalesPipeline'];
export type SalesStage = Schemas['SalesStage'];
export type PipelineRequest = Schemas['SalesPipelineRequest'];
export type StageInput = Schemas['SalesStageInput'];
export type StageCards = Schemas['SalesStageCards'];
export type OrderCard = Schemas['SalesOrderCard'];
export type PickLineInfo = Schemas['SalesOrderPickLineInfo'];
export type MoveResult = Schemas['SalesOrderMoveResult'];
export type ChannelDefault = Schemas['SalesChannelDefault'];
export type Numbering = Schemas['SalesNumbering'];
export type PickPart = Schemas['SalesOrderPickPart'];
export type PickWork = Schemas['SalesPickWork'];

/** The cards and list filters as the API takes them (`orderFilterQuery`). */
export interface FilterQuery {
  q?: string;
  customerId?: number;
  mine?: boolean;
  channel?: OrderChannel;
  fulfilment?: 'PICKUP' | 'DELIVERY';
  paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'CREDIT';
  deliveryFrom?: string;
  deliveryTo?: string;
}

export interface ListQuery extends FilterQuery {
  pipeline?: string;
  stageId?: number;
  status?: Schemas['SalesOrderDetail']['status'];
  archived?: 'exclude' | 'include' | 'only';
}

export const SALES_KEYS = {
  all: ['sales'] as const,
  boards: ['sales', 'boards'] as const,
  pipelines: ['sales', 'pipelines'] as const,
  pipeline: (id: number) => ['sales', 'pipelines', id] as const,
  cards: (id: number, filters: FilterQuery) =>
    ['sales', 'pipelines', id, 'cards', filters] as const,
  channels: ['sales', 'settings', 'channels'] as const,
  numbering: ['sales', 'settings', 'numbering'] as const,
  orders: ['sales', 'orders'] as const,
  pickInfo: (orderId: number) => ['sales', 'orders', orderId, 'pick-info'] as const,
  pickWork: ['sales', 'picks'] as const,
  pickers: (warehouseId: number) => ['sales', 'picks', 'pickers', warehouseId] as const,
};

/** The boards with the pipelines the caller sees (managers: also empty and, asked, archived). */
export function useBoardTree(archived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...SALES_KEYS.boards, archived],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-boards', {
          params: { query: archived ? { archived: true } : {} },
          signal,
        }),
      ),
  });
}

export function usePipeline(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.pipeline(id ?? 0),
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-pipelines/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

/** A pipeline's cards; read again every 30 s and on focus (others move cards too). */
export function useStageCards(id: number | null, filters: FilterQuery) {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.cards(id ?? 0, filters),
    enabled: id !== null,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-pipelines/{id}/cards', {
          params: { path: { id: id ?? 0 }, query: filters },
          signal,
        }),
      ),
  });
}

/** The order list of the work page (keyset, 50 a page, the total on the first). */
export function useOrderList(query: ListQuery, enabled = true) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...SALES_KEYS.orders, 'list', query],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-orders', {
          params: { query: { ...query, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** Up to 100 orders, whole, for one printed page. */
export function useOrderBatch(ids: readonly number[]) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...SALES_KEYS.orders, 'batch', ids],
    enabled: ids.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-orders/batch', {
          params: { query: { ids: ids.join(',') } },
          signal,
        }),
      ),
  });
}

export function useChannels() {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.channels,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/sales-settings/channels', { signal })),
  });
}

export function useNumbering() {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.numbering,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/sales-settings/numbering', { signal })),
  });
}

export function usePickInfo(orderId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.pickInfo(orderId ?? 0),
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

/** The picking page (ADR-0126 #2): the parts of the caller's warehouses (a lead: all). */
export function usePickWork() {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.pickWork,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/sales-picks', { signal })),
    refetchInterval: 30_000,
  });
}

/** Who may pick in a warehouse, for the lead's «Хуваарилах». */
export function usePickers(warehouseId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: SALES_KEYS.pickers(warehouseId ?? 0),
    enabled: warehouseId !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/sales-picks/pickers', {
          params: { query: { warehouseId: warehouseId ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useSalesMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => queryClient.invalidateQueries({ queryKey: SALES_KEYS.all });
  const done = { onSuccess: () => changed() };
  return {
    createBoard: useMutation({
      mutationFn: async (body: { name: string; branchId: number | null }) =>
        unwrap(await api.POST('/api/v1/sales-boards', { body })),
      ...done,
    }),
    updateBoard: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; name: string; branchId: number | null }) =>
        unwrap(await api.PUT('/api/v1/sales-boards/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
    archiveBoard: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/sales-boards/{id}', { params: { path: { id } } })),
      ...done,
    }),
    unarchiveBoard: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/sales-boards/{id}/unarchive', { params: { path: { id } } })),
      ...done,
    }),
    createPipeline: useMutation({
      mutationFn: async (body: PipelineRequest) =>
        unwrap(await api.POST('/api/v1/sales-pipelines', { body })),
      ...done,
    }),
    savePipeline: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: PipelineRequest }) =>
        unwrap(await api.PUT('/api/v1/sales-pipelines/{id}', { params: { path: { id } }, body })),
      ...done,
    }),
    copyPipeline: useMutation({
      mutationFn: async ({ id, ...body }: { id: number; name: string; boardId: number }) =>
        unwrap(
          await api.POST('/api/v1/sales-pipelines/{id}/copy', { params: { path: { id } }, body }),
        ),
      ...done,
    }),
    archivePipeline: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/sales-pipelines/{id}/archive', { params: { path: { id } } }),
        ),
      ...done,
    }),
    unarchivePipeline: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/sales-pipelines/{id}/unarchive', { params: { path: { id } } }),
        ),
      ...done,
    }),
    archiveStage: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/sales-stages/{id}', { params: { path: { id } } })),
      ...done,
    }),
    sortStage: useMutation({
      mutationFn: async ({ id, sort }: { id: number; sort: CardSort }) =>
        unwrap(
          await api.PUT('/api/v1/sales-stages/{id}/sort', {
            params: { path: { id } },
            body: { sort },
          }),
        ),
      ...done,
    }),
    archiveCards: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/sales-stages/{id}/archive-cards', { params: { path: { id } } }),
        ),
      ...done,
    }),
    setChannel: useMutation({
      mutationFn: async (body: {
        channel: ChannelDefault['channel'];
        pipelineId: number | null;
        stageId: number | null;
      }) => unwrap(await api.PUT('/api/v1/sales-settings/channels', { body })),
      // The home page warns while the customer app's orders have no stage (ADR-0079 #5).
      onSuccess: () =>
        Promise.all([changed(), queryClient.invalidateQueries({ queryKey: ATTENTION_KEY })]),
    }),
    setNumbering: useMutation({
      mutationFn: async (body: { pattern: string; digits: number }) =>
        unwrap(await api.PUT('/api/v1/sales-settings/numbering', { body })),
      ...done,
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
      ...done,
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
      ...done,
    }),
    takePart: useMutation({
      mutationFn: async ({ orderId, warehouseId }: { orderId: number; warehouseId: number }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/picks/{warehouseId}/take', {
            params: { path: { id: orderId, warehouseId } },
          }),
        ),
      ...done,
    }),
    pickPart: useMutation({
      mutationFn: async ({
        orderId,
        warehouseId,
        key,
        lines,
      }: {
        orderId: number;
        warehouseId: number;
        key: string;
        lines: { lineId: number; qty: string; binId: number }[];
      }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/picks/{warehouseId}/pick', {
            params: { path: { id: orderId, warehouseId }, header: idempotencyKey(key) },
            body: { lines },
          }),
        ),
      ...done,
    }),
    assignPart: useMutation({
      mutationFn: async ({
        orderId,
        warehouseId,
        userId,
      }: {
        orderId: number;
        warehouseId: number;
        userId: number;
      }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/picks/{warehouseId}/assign', {
            params: { path: { id: orderId, warehouseId } },
            body: { userId },
          }),
        ),
      ...done,
    }),
    reopenPart: useMutation({
      mutationFn: async ({ orderId, warehouseId }: { orderId: number; warehouseId: number }) =>
        unwrap(
          await api.POST('/api/v1/sales-orders/{id}/picks/{warehouseId}/reopen', {
            params: { path: { id: orderId, warehouseId } },
          }),
        ),
      ...done,
    }),
    archiveOrder: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/sales-orders/{id}/archive', { params: { path: { id } } })),
      ...done,
    }),
    unarchiveOrder: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/sales-orders/{id}/unarchive', { params: { path: { id } } })),
      ...done,
    }),
  };
}

/** Opens a printable page in a new tab (ADR-0056 #7); it prints itself. */
export function openPrint(path: string): void {
  window.open(path, '_blank', 'noopener');
}

/** The printable page of one order (ADR-0056 #7) on this computer's paper (ADR-0058). */
export function orderPrintPath(orderId: number, kind: PrintKind, format: PrintFormat): string {
  return `/sales/orders/${orderId}/print/${kind}?format=${printFormatParam(format)}`;
}

/** The printable page of several orders, one per sheet (ADR-0057 #7, ADR-0058). */
export function batchPrintPath(
  kind: PrintKind,
  ids: readonly number[],
  format: PrintFormat,
): string {
  return `/sales/print/${kind}?ids=${ids.join(',')}&format=${printFormatParam(format)}`;
}

/** Where an order sits: «board / pipeline», or the pipeline alone when its board reads the same. */
export function placeName(boardName: string | null | undefined, pipelineName: string): string {
  return boardName && boardName !== pipelineName ? `${boardName} / ${pipelineName}` : pipelineName;
}
