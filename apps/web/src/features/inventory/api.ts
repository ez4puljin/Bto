import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type Bin = Schemas['Bin'];
export type BinType = Bin['type'];
export type BinCreate = Schemas['BinCreateRequest'];
export type BinRangeRequest = Schemas['BinRangeRequest'];
export type BinRangeResult = Schemas['BinRangeResult'];
export type ProductLocation = Schemas['ProductLocation'];
export type LocationRequest = Schemas['ProductLocationRequest'];
export type ReceiptSummary = Schemas['ReceiptSummary'];
export type ReceiptDetail = Schemas['ReceiptDetail'];
export type ReceiptLine = Schemas['ReceiptLine'];
export type ReceiptCreate = Schemas['ReceiptCreateRequest'];
export type ReceiptUpdate = Schemas['ReceiptUpdateRequest'];
export type ReceiptLineRequest = Schemas['ReceiptLineRequest'];
export type ReceiptCosting = Schemas['ReceiptCosting'];
export type ReceiptCostRequest = Schemas['ReceiptCostRequest'];
export type ReceiptStatus = ReceiptDetail['status'];
export type BinMoveSummary = Schemas['BinMoveSummary'];
export type BinMoveDetail = Schemas['BinMoveDetail'];
export type BinMoveCreate = Schemas['BinMoveCreateRequest'];
export type AdjustmentSummary = Schemas['AdjustmentSummary'];
export type AdjustmentDetail = Schemas['AdjustmentDetail'];
export type AdjustmentCreate = Schemas['AdjustmentCreateRequest'];
export type AdjustmentLineRequest = Schemas['AdjustmentLineRequest'];
export type AdjustmentReason = AdjustmentDetail['reason'];
/** The reasons people may choose (OPENING_REVERSAL comes only from an import revert). */
export type RequestableReason = AdjustmentCreate['reason'];
export type AdjustmentStatus = AdjustmentDetail['status'];
export type ProductStock = Schemas['ProductStock'];
export type ProductStockDetail = Schemas['ProductStockDetail'];
export type ReconciliationRun = Schemas['ReconciliationRun'];

export const KEYS = {
  stock: ['inventory', 'stock'] as const,
  bins: ['inventory', 'bins'] as const,
  locations: ['inventory', 'locations'] as const,
  receipts: ['inventory', 'receipts'] as const,
  moves: ['inventory', 'moves'] as const,
  adjustments: ['inventory', 'adjustments'] as const,
  reconciliation: ['inventory', 'reconciliation'] as const,
  transfers: ['inventory', 'transfers'] as const,
};

/** Idempotent routes take the key from the caller: one key per user intent (ADR-0004). */
type Keyed<T> = T & { key: string };

export interface StockFilter {
  q?: string;
  warehouseId?: number;
  inStock?: boolean;
}

export function useStock(filter: StockFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.stock, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock', {
          params: {
            query: {
              q: filter.q || undefined,
              warehouseId: filter.warehouseId,
              inStock: filter.inStock,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useProductStock(productId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stock, 'product', productId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stock/products/{id}', {
          params: { path: { id: productId } },
          signal,
        }),
      ),
  });
}

/** The last reconciliation run, for the admins' banner. */
export function useReconciliation(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.reconciliation,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/stock/reconciliation/latest', { signal })).lastRun,
  });
}

export interface BinFilter {
  warehouseId?: number;
  q?: string;
  archived?: boolean;
}

export function useBins(filter: BinFilter) {
  const api = useApiClient();
  const { warehouseId } = filter;
  return useInfiniteQuery({
    queryKey: [...KEYS.bins, 'list', filter],
    enabled: warehouseId !== undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/bins', {
          params: {
            query: {
              warehouseId: warehouseId ?? 0,
              q: filter.q || undefined,
              archived: filter.archived,
              cursor: pageParam,
              limit: 100,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** A scanned shelf label in a warehouse; a mutation because every scan is a new question. */
export function useBinLookup() {
  const api = useApiClient();
  return useMutation({
    mutationFn: async ({ warehouseId, code }: { warehouseId: number; code: string }) =>
      unwrap(await api.GET('/api/v1/bins/lookup', { params: { query: { warehouseId, code } } })),
  });
}

export function useProductLocations(productId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.locations, productId],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/product-locations', {
          params: { query: { productId, limit: 200 } },
          signal,
        }),
      ).data,
  });
}

export interface ReceiptFilter {
  warehouseId?: number;
  status?: ReceiptStatus;
  costingPending?: boolean;
  q?: string;
}

export function useReceipts(filter: ReceiptFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.receipts, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/receipts', {
          params: {
            query: {
              warehouseId: filter.warehouseId,
              status: filter.status,
              costingPending: filter.costingPending,
              q: filter.q || undefined,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useReceipt(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.receipts, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipts/{id}', { params: { path: { id } }, signal })),
  });
}

/** The costs of a receipt: only for holders of inventory.costs.manage. */
export function useReceiptCosting(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.receipts, id, 'costing'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipts/{id}/costing', { params: { path: { id } }, signal })),
  });
}

export function useBinMoves(filter: { warehouseId?: number }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.moves, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/bin-moves', {
          params: { query: { warehouseId: filter.warehouseId, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useAdjustments(filter: { warehouseId?: number; status?: AdjustmentStatus }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.adjustments, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/adjustments', {
          params: {
            query: {
              warehouseId: filter.warehouseId,
              status: filter.status,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useAdjustment(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.adjustments, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/adjustments/{id}', { params: { path: { id } }, signal })),
  });
}

/** Mutations; each refreshes what it can change. */
export function useInventoryMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const binsChanged = () => invalidate(KEYS.bins, KEYS.locations);
  const receiptsChanged = () => invalidate(KEYS.receipts, KEYS.stock);
  const adjustmentsChanged = () => invalidate(KEYS.adjustments, KEYS.stock);

  return {
    createBin: useMutation({
      mutationFn: async (body: BinCreate) => unwrap(await api.POST('/api/v1/bins', { body })),
      onSuccess: binsChanged,
    }),
    createBinRange: useMutation({
      mutationFn: async (body: BinRangeRequest) =>
        unwrap(await api.POST('/api/v1/bins/bulk', { body })),
      onSuccess: binsChanged,
    }),
    archiveBin: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/bins/{id}/archive', { params: { path: { id } } })),
      onSuccess: binsChanged,
    }),
    restoreBin: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/bins/{id}/restore', { params: { path: { id } } })),
      onSuccess: binsChanged,
    }),
    deleteBin: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/bins/{id}', { params: { path: { id } } })),
      onSuccess: binsChanged,
    }),
    setLocation: useMutation({
      mutationFn: async (body: LocationRequest) =>
        unwrap(await api.PUT('/api/v1/product-locations', { body })),
      onSuccess: () => invalidate(KEYS.locations),
    }),
    setHome: useMutation({
      mutationFn: async (body: { productId: number; warehouseId: number | null }) =>
        unwrap(await api.PUT('/api/v1/product-locations/home', { body })),
      onSuccess: () => invalidate(KEYS.locations),
    }),
    createReceipt: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<ReceiptCreate>) =>
        unwrap(
          await api.POST('/api/v1/receipts', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: receiptsChanged,
    }),
    updateReceipt: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ReceiptUpdate }) =>
        unwrap(await api.PATCH('/api/v1/receipts/{id}', { params: { path: { id } }, body })),
      onSuccess: receiptsChanged,
    }),
    addReceiptLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ReceiptLineRequest }) =>
        unwrap(await api.POST('/api/v1/receipts/{id}/lines', { params: { path: { id } }, body })),
      onSuccess: receiptsChanged,
    }),
    updateReceiptLine: useMutation({
      mutationFn: async ({
        id,
        body,
      }: {
        id: number;
        body: { enteredQty?: string; binId?: number };
      }) =>
        unwrap(await api.PATCH('/api/v1/receipt-lines/{id}', { params: { path: { id } }, body })),
      onSuccess: receiptsChanged,
    }),
    removeReceiptLine: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/receipt-lines/{id}', { params: { path: { id } } })),
      onSuccess: receiptsChanged,
    }),
    postReceipt: useMutation({
      mutationFn: async ({ id, key }: { id: number; key: string }) =>
        unwrap(
          await api.POST('/api/v1/receipts/{id}/post', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: receiptsChanged,
    }),
    cancelReceipt: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/receipts/{id}/cancel', { params: { path: { id } } })),
      onSuccess: receiptsChanged,
    }),
    costReceipt: useMutation({
      mutationFn: async ({
        id,
        key,
        body,
      }: {
        id: number;
        key: string;
        body: ReceiptCostRequest;
      }) =>
        unwrap(
          await api.PUT('/api/v1/receipts/{id}/costs', {
            params: { path: { id }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: receiptsChanged,
    }),
    createMove: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<BinMoveCreate>) =>
        unwrap(
          await api.POST('/api/v1/bin-moves', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: () => invalidate(KEYS.moves, KEYS.stock),
    }),
    createAdjustment: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<AdjustmentCreate>) =>
        unwrap(
          await api.POST('/api/v1/adjustments', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: adjustmentsChanged,
    }),
    updateAdjustment: useMutation({
      mutationFn: async ({
        id,
        body,
      }: {
        id: number;
        body: { reason?: RequestableReason; note?: string | null };
      }) => unwrap(await api.PATCH('/api/v1/adjustments/{id}', { params: { path: { id } }, body })),
      onSuccess: adjustmentsChanged,
    }),
    addAdjustmentLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: AdjustmentLineRequest }) =>
        unwrap(
          await api.POST('/api/v1/adjustments/{id}/lines', { params: { path: { id } }, body }),
        ),
      onSuccess: adjustmentsChanged,
    }),
    updateAdjustmentLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: { enteredQty?: string } }) =>
        unwrap(
          await api.PATCH('/api/v1/adjustment-lines/{id}', { params: { path: { id } }, body }),
        ),
      onSuccess: adjustmentsChanged,
    }),
    removeAdjustmentLine: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/adjustment-lines/{id}', { params: { path: { id } } })),
      onSuccess: adjustmentsChanged,
    }),
    adjustmentAction: useMutation({
      mutationFn: async ({ id, action }: { id: number; action: 'submit' | 'return' | 'cancel' }) =>
        unwrap(
          await (action === 'submit'
            ? api.POST('/api/v1/adjustments/{id}/submit', { params: { path: { id } } })
            : action === 'return'
              ? api.POST('/api/v1/adjustments/{id}/return', { params: { path: { id } } })
              : api.POST('/api/v1/adjustments/{id}/cancel', { params: { path: { id } } })),
        ),
      onSuccess: adjustmentsChanged,
    }),
    approveAdjustment: useMutation({
      mutationFn: async ({
        id,
        key,
        costs,
      }: {
        id: number;
        key: string;
        costs: { lineId: number; unitCost: string }[];
      }) =>
        unwrap(
          await api.POST('/api/v1/adjustments/{id}/post', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { costs },
          }),
        ),
      onSuccess: adjustmentsChanged,
    }),
  };
}

export type TransferSummary = Schemas['TransferSummary'];
export type TransferDetail = Schemas['TransferDetail'];
export type TransferLine = Schemas['TransferLine'];
export type TransferCreate = Schemas['TransferCreateRequest'];
export type TransferCount = Schemas['TransferCount'];
export type TransferStatus = TransferDetail['status'];
export type TransferOrigin = TransferDetail['origin'];

export interface TransferFilter {
  warehouseId?: number;
  direction?: 'INCOMING' | 'OUTGOING';
  status?: TransferStatus;
}

export function useTransfers(filter: TransferFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.transfers, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/transfers', {
          params: {
            query: {
              warehouseId: filter.warehouseId,
              direction: filter.warehouseId === undefined ? undefined : filter.direction,
              status: filter.status,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useTransfer(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.transfers, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/transfers/{id}', { params: { path: { id } }, signal })),
  });
}

/** Transfer mutations; each refreshes the transfers and, when stock moved, the stock pages. */
export function useTransferMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = (stock = false) =>
    Promise.all(
      [KEYS.transfers, ...(stock ? [KEYS.stock] : [])].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );

  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<TransferCreate>) =>
        unwrap(
          await api.POST('/api/v1/transfers', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: () => changed(),
    }),
    addLine: useMutation({
      mutationFn: async ({
        id,
        body,
      }: {
        id: number;
        body: { productUnitId: number; qty: string };
      }) =>
        unwrap(await api.POST('/api/v1/transfers/{id}/lines', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    updateLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: { qty?: string } }) =>
        unwrap(await api.PATCH('/api/v1/transfer-lines/{id}', { params: { path: { id } }, body })),
      onSuccess: () => changed(),
    }),
    removeLine: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/transfer-lines/{id}', { params: { path: { id } } })),
      onSuccess: () => changed(),
    }),
    request: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/transfers/{id}/request', { params: { path: { id } } })),
      onSuccess: () => changed(),
    }),
    ship: useMutation({
      mutationFn: async ({ id, key, lines }: { id: number; key: string; lines: TransferCount[] }) =>
        unwrap(
          await api.POST('/api/v1/transfers/{id}/ship', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { lines },
          }),
        ),
      onSuccess: () => changed(true),
    }),
    receive: useMutation({
      mutationFn: async ({ id, key, lines }: { id: number; key: string; lines: TransferCount[] }) =>
        unwrap(
          await api.POST('/api/v1/transfers/{id}/receive', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { lines },
          }),
        ),
      onSuccess: () => changed(true),
    }),
    cancel: useMutation({
      mutationFn: async ({ id, reason }: { id: number; reason?: string }) =>
        unwrap(
          await api.POST('/api/v1/transfers/{id}/cancel', {
            params: { path: { id } },
            body: reason ? { reason } : {},
          }),
        ),
      onSuccess: () => changed(),
    }),
  };
}
