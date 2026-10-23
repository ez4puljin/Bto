import {
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey, type paths } from '@tugeel/api-client';
import { useCallback } from 'react';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type Bin = Schemas['Bin'];
export type BinType = Bin['type'];
export type BinCreate = Schemas['BinCreateRequest'];
export type BinRangeRequest = Schemas['BinRangeRequest'];
export type BinRangeResult = Schemas['BinRangeResult'];
export type ProductLocation = Schemas['ProductLocation'];
export type StockMovement = Schemas['StockMovement'];
export type LowStockRow = Schemas['LowStockRow'];
export type MovementDocType = NonNullable<
  NonNullable<
    NonNullable<paths['/api/v1/stock/movements']['get']['parameters']['query']>['docType']
  >
>;
export type LocationRequest = Schemas['ProductLocationRequest'];
export type ReceiptSummary = Schemas['ReceiptSummary'];
export type ReceiptDetail = Schemas['ReceiptDetail'];
export type ReceiptLine = Schemas['ReceiptLine'];
export type ReceiptCreate = Schemas['ReceiptCreateRequest'];
export type ReceiptUpdate = Schemas['ReceiptUpdateRequest'];
export type ReceiptLineRequest = Schemas['ReceiptLineRequest'];
export type ReceiptLineUpdate = Schemas['ReceiptLineUpdateRequest'];
export type ReceiptCostRequest = Schemas['ReceiptCostRequest'];
export type ReceiptStatus = ReceiptDetail['status'];
export type ReceiptPaymentMethod = ReceiptDetail['paymentMethod'];
export type ReceiptPaymentAccount = Schemas['ReceiptPaymentAccount'];
export type LastReceiptPrice = Schemas['LastReceiptPrice'];
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
  stocktakes: ['inventory', 'stocktakes'] as const,
  issues: ['inventory', 'issues'] as const,
  expenseTypes: ['inventory', 'issue-expense-types'] as const,
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

export function useProductStock(productId: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stock, 'product', productId],
    enabled,
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
export interface MovementFilter {
  productId?: number;
  warehouseId?: number;
  binId?: number;
  docType?: MovementDocType;
  from?: string;
  to?: string;
}

/** Movement history (SPEC §8.2 #1): ledger rows newest first, 50 at a time. */
export function useStockMovements(filter: MovementFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.stock, 'movements', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock/movements', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The low-stock list of a warehouse (ADR-0039), 100 rows at a time; off without a warehouse. */
export function useLowStock(warehouseId: number | undefined) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.stock, 'low', warehouseId],
    enabled: warehouseId !== undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock/low', {
          params: { query: { warehouseId: warehouseId ?? 0, cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

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

/** One bin by id (a filter that remembers a shelf); off without an id. */
export function useBin(id: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.bins, 'one', id],
    enabled: id !== undefined,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/bins/{id}', { params: { path: { id: id ?? 0 } }, signal })),
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

export function useProductLocations(productId: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.locations, productId],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/product-locations', {
          params: { query: { productId, limit: 200 } },
          signal,
        }),
      ).data,
  });
}

/**
 * Home warehouses and fixed shelves of a page of products (the product list, ADR-0037): one
 * request per page, none while `enabled` is false.
 */
export function useProductLocationsOf(productIds: readonly number[], enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.locations, 'of', productIds],
    enabled: enabled && productIds.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/product-locations', {
          params: { query: { productIds: [...productIds] } },
          signal,
        }),
      ).data,
  });
}

export interface ReceiptFilter {
  /** Receipts with a line in this warehouse (ADR-0099). */
  warehouseId?: number;
  status?: ReceiptStatus;
  costingPending?: boolean;
  q?: string;
  supplierId?: number;
  /** Receipts with a line of this product. */
  productId?: number;
  /** The delivery note's date range (inclusive). */
  from?: string;
  to?: string;
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
              supplierId: filter.supplierId,
              productId: filter.productId,
              from: filter.from || undefined,
              to: filter.to || undefined,
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

/** One receipt; `enabled: false` while the page is a new receipt that does not exist yet. */
export function useReceipt(id: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.receipts, id],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipts/{id}', { params: { path: { id } }, signal })),
  });
}

/**
 * The latest copy of a receipt in the cache, read when a queued scan runs (ADR-0047 #2): line
 * changes write the returned draft there before the next scan looks for its line. Takes the id
 * at the call, since a new receipt gets its id from its first scan.
 */
export function useReceiptSnapshot(): (id: number) => ReceiptDetail | undefined {
  const queryClient = useQueryClient();
  return useCallback(
    (id: number) => queryClient.getQueryData<ReceiptDetail>([...KEYS.receipts, id]),
    [queryClient],
  );
}

/** Posted receipts waiting for their costs, newest first: the accountant's queue (ADR-0047 #1). */
export function usePendingReceipts(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.receipts, 'pending'],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/receipts', {
          params: { query: { costingPending: true, limit: 200 } },
          signal,
        }),
      ).data,
  });
}

/**
 * The latest delivery-note price of these products, from any supplier (ADR-0099 #3; cost holders
 * only): none while `enabled` is false.
 */
export function useLastReceiptPrices(productIds: readonly number[], enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.receipts, 'last-prices', productIds],
    enabled: enabled && productIds.length > 0,
    staleTime: 60_000,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/receipts/last-prices', {
          params: { query: { productIds: [...productIds] } },
          signal,
        }),
      ),
  });
}

/** The cash boxes and bank accounts a receipt paid at once may name (inventory.receipts.manage). */
export function useReceiptPaymentAccounts(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.receipts, 'payment-accounts'],
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipts/payment-accounts', { signal })),
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
  const receiptsChanged = () => invalidate(KEYS.receipts, KEYS.stock, ATTENTION_KEY);
  /** A draft's new copy goes into the cache at once; lists and stock refresh behind it. */
  const receiptLinesChanged = async (receipt: ReceiptDetail) => {
    const key = [...KEYS.receipts, receipt.id];
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData(key, receipt);
    void invalidate([...KEYS.receipts, 'list'], [...KEYS.receipts, 'pending'], KEYS.stock);
  };
  const adjustmentsChanged = () => invalidate(KEYS.adjustments, KEYS.stock, ATTENTION_KEY);

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
      onSuccess: receiptLinesChanged,
    }),
    updateReceipt: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ReceiptUpdate }) =>
        unwrap(await api.PATCH('/api/v1/receipts/{id}', { params: { path: { id } }, body })),
      onSuccess: receiptLinesChanged,
    }),
    addReceiptLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ReceiptLineRequest }) =>
        unwrap(await api.POST('/api/v1/receipts/{id}/lines', { params: { path: { id } }, body })),
      onSuccess: receiptLinesChanged,
    }),
    updateReceiptLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ReceiptLineUpdate }) =>
        unwrap(await api.PATCH('/api/v1/receipt-lines/{id}', { params: { path: { id } }, body })),
      onSuccess: receiptLinesChanged,
    }),
    removeReceiptLine: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/receipt-lines/{id}', { params: { path: { id } } })),
      onSuccess: receiptLinesChanged,
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
              direction: filter.direction,
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

/** One transfer; read again when the window regains focus, as the other side may have moved it on. */
export function useTransfer(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.transfers, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/transfers/{id}', { params: { path: { id } }, signal })),
    refetchOnWindowFocus: true,
  });
}

/**
 * Transfer mutations; each refreshes the transfers and, when stock moved, the stock pages. The
 * steps refresh after a refusal too: the other side may have shipped, taken back or cancelled.
 */
export function useTransferMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = (stock = false) =>
    Promise.all(
      [KEYS.transfers, ATTENTION_KEY, ...(stock ? [KEYS.stock] : [])].map((queryKey) =>
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
      onSettled: () => changed(),
    }),
    /** ADR-0046: the destination takes a sent request back to edit it. */
    reopen: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/transfers/{id}/reopen', { params: { path: { id } } })),
      onSettled: () => changed(),
    }),
    ship: useMutation({
      mutationFn: async ({ id, key, lines }: { id: number; key: string; lines: TransferCount[] }) =>
        unwrap(
          await api.POST('/api/v1/transfers/{id}/ship', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { lines },
          }),
        ),
      onSettled: () => changed(true),
    }),
    receive: useMutation({
      mutationFn: async ({ id, key, lines }: { id: number; key: string; lines: TransferCount[] }) =>
        unwrap(
          await api.POST('/api/v1/transfers/{id}/receive', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { lines },
          }),
        ),
      onSettled: () => changed(true),
    }),
    cancel: useMutation({
      mutationFn: async ({ id, reason }: { id: number; reason?: string }) =>
        unwrap(
          await api.POST('/api/v1/transfers/{id}/cancel', {
            params: { path: { id } },
            body: reason ? { reason } : {},
          }),
        ),
      onSettled: () => changed(),
    }),
  };
}

export type StocktakeSummary = Schemas['StocktakeSummary'];
export type StocktakeDetail = Schemas['StocktakeDetail'];
export type StocktakeBin = Schemas['StocktakeBin'];
export type StocktakeLine = Schemas['StocktakeLine'];
export type StocktakeLinePage = Schemas['StocktakeLinePage'];
export type StocktakeStatus = StocktakeDetail['status'];
export type StocktakeCreate = Schemas['StocktakeCreateRequest'];
export type StocktakeScanResult = Schemas['StocktakeScanResult'];
export type StocktakeCountEntry = Schemas['StocktakeCountEntry'];
export type StocktakeBinPreview = Schemas['StocktakeBinPreview'];

export interface StocktakeFilter {
  warehouseId?: number;
  status?: StocktakeStatus;
}

export function useStocktakes(filter: StocktakeFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.stocktakes, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stocktakes', {
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

/** One stocktake with its bins; fresh again whenever the counter comes back to the page. */
export function useStocktake(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stocktakes, id],
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/stocktakes/{id}', { params: { path: { id } }, signal })),
  });
}

/**
 * The lines of one bin, at most 200 (a shelf holds far fewer). Counters receive only what a person
 * counted there (ADR-0038).
 */
export function useStocktakeBinLines(id: number, binId: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stocktakes, id, 'bin-lines', binId],
    enabled: binId !== undefined,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stocktakes/{id}/lines', {
          params: { path: { id }, query: { binId, limit: 200 } },
          signal,
        }),
      ),
  });
}

/** Lines across bins for an approver's review, 100 at a time. */
export function useStocktakeLines(id: number, differences: boolean, enabled: boolean) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.stocktakes, id, 'lines', differences],
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stocktakes/{id}/lines', {
          params: { path: { id }, query: { differences, cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** What a code prefix or «every bin» would count; off until the form names one. */
export function useStocktakeBinPreview(filter: {
  warehouseId?: number;
  prefix?: string;
  all?: boolean;
}) {
  const api = useApiClient();
  const { warehouseId, prefix, all } = filter;
  return useQuery({
    queryKey: [...KEYS.stocktakes, 'bin-preview', filter],
    enabled: warehouseId !== undefined && (Boolean(prefix) || all === true),
    retry: false,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stocktakes/bin-preview', {
          params: { query: { warehouseId: warehouseId ?? 0, prefix: prefix || undefined, all } },
          signal,
        }),
      ),
  });
}

/** A counted line into the cached bin it belongs to (scans update the page without a refetch). */
function putStocktakeLine(queryClient: QueryClient, id: number, line: StocktakeLine) {
  queryClient.setQueryData<StocktakeLinePage>(
    [...KEYS.stocktakes, id, 'bin-lines', line.binId],
    (old) => {
      if (!old) return old;
      const at = old.data.findIndex((row) => row.id === line.id);
      if (at === -1) return { ...old, data: [...old.data, line] };
      return { ...old, data: old.data.map((row) => (row.id === line.id ? line : row)) };
    },
  );
}

/** A bin's progress into the cached stocktake. */
function putStocktakeBin(queryClient: QueryClient, id: number, bin: StocktakeBin) {
  queryClient.setQueryData<StocktakeDetail>([...KEYS.stocktakes, id], (old) => {
    if (!old) return old;
    const bins = old.bins.map((row) => (row.id === bin.id ? bin : row));
    return { ...old, bins, countedCount: bins.reduce((sum, row) => sum + row.countedCount, 0) };
  });
}

/** Stocktake mutations; a scan updates the cache itself, the other steps refetch. */
export function useStocktakeMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  // Every step may change the approvers' count on the home page.
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(
      [...keys, ATTENTION_KEY].map((queryKey) => queryClient.invalidateQueries({ queryKey })),
    );
  // Starting, cancelling and approving lock or free bins; approving also changes stock.
  const binsChanged = () => invalidate(KEYS.stocktakes, KEYS.bins);

  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<StocktakeCreate>) =>
        unwrap(
          await api.POST('/api/v1/stocktakes', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: () => invalidate(KEYS.stocktakes),
    }),
    start: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/stocktakes/{id}/start', { params: { path: { id } } })),
      onSuccess: binsChanged,
    }),
    scan: useMutation({
      mutationFn: async ({
        id,
        key,
        ...body
      }: {
        id: number;
        key: string;
        binId: number;
        productUnitId: number;
        qty: string;
      }) =>
        unwrap(
          await api.POST('/api/v1/stocktakes/{id}/scan', {
            params: { path: { id }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: (result, { id }) => {
        putStocktakeLine(queryClient, id, result.line);
        putStocktakeBin(queryClient, id, result.bin);
      },
    }),
    setCount: useMutation({
      mutationFn: async ({ id, ...entry }: { id: number } & StocktakeCountEntry) =>
        unwrap(
          await api.POST('/api/v1/stocktakes/{id}/counts', {
            params: { path: { id } },
            body: { entries: [entry] },
          }),
        ),
      onSuccess: (result, { id }) => {
        for (const line of result.lines) putStocktakeLine(queryClient, id, line);
        return queryClient.invalidateQueries({ queryKey: [...KEYS.stocktakes, id], exact: true });
      },
      // A count changed meanwhile: show the stored one again.
      onError: (_error, { id, binId }) =>
        queryClient.invalidateQueries({ queryKey: [...KEYS.stocktakes, id, 'bin-lines', binId] }),
    }),
    finishBin: useMutation({
      mutationFn: async ({ id, binId }: { id: number; binId: number }) =>
        unwrap(
          await api.POST('/api/v1/stocktakes/{id}/bins/{binId}/finish', {
            params: { path: { id, binId } },
          }),
        ),
      onSuccess: (bin, { id }) => {
        putStocktakeBin(queryClient, id, bin);
        return queryClient.invalidateQueries({
          queryKey: [...KEYS.stocktakes, id, 'bin-lines', bin.id],
        });
      },
    }),
    review: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/stocktakes/{id}/review', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.stocktakes),
    }),
    recount: useMutation({
      mutationFn: async ({ id, binIds }: { id: number; binIds: number[] }) =>
        unwrap(
          await api.POST('/api/v1/stocktakes/{id}/recount', {
            params: { path: { id } },
            body: { binIds },
          }),
        ),
      onSuccess: () => invalidate(KEYS.stocktakes),
    }),
    approve: useMutation({
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
          await api.POST('/api/v1/stocktakes/{id}/approve', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { costs },
          }),
        ),
      onSuccess: () => invalidate(KEYS.stocktakes, KEYS.bins, KEYS.stock),
    }),
    cancel: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/stocktakes/{id}/cancel', { params: { path: { id } } })),
      onSuccess: binsChanged,
    }),
  };
}

// -------------------------------------------------------------------------------------------
// Goods issues (GI-, ADR-0081)

export type IssueSummary = Schemas['IssueSummary'];
export type IssueDetail = Schemas['IssueDetail'];
export type IssueLine = Schemas['IssueLine'];
export type IssueCreate = Schemas['IssueCreateRequest'];
export type IssueUpdate = Schemas['IssueUpdateRequest'];
export type IssueLineRequest = Schemas['IssueLineRequest'];
export type IssueLineUpdate = Schemas['IssueLineUpdateRequest'];
export type IssueRecipient = Schemas['IssueRecipientRequest'];
export type IssueRecipientKind = IssueDetail['recipientKind'];
export type IssueStatus = IssueDetail['status'];
export type IssueExpenseType = Schemas['IssueExpenseType'];
export type UserLookup = Schemas['UserLookup'];
export type CustomerLookup = Schemas['CustomerLookup'];

export interface IssueFilter {
  warehouseId?: number;
  status?: IssueStatus;
  expenseTypeId?: number;
  q?: string;
}

export function useIssues(filter: IssueFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.issues, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/issues', {
          params: {
            query: {
              warehouseId: filter.warehouseId,
              status: filter.status,
              expenseTypeId: filter.expenseTypeId,
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

/** One issue; `enabled: false` while the page is a new issue that does not exist yet. */
export function useIssue(id: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.issues, id],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/issues/{id}', { params: { path: { id } }, signal })),
  });
}

/** The latest copy of an issue in the cache, read when a queued scan runs (like receipts). */
export function useIssueSnapshot(): (id: number) => IssueDetail | undefined {
  const queryClient = useQueryClient();
  return useCallback(
    (id: number) => queryClient.getQueryData<IssueDetail>([...KEYS.issues, id]),
    [queryClient],
  );
}

/** Every expense type, retired ones too (an old issue still names its type). */
export function useIssueExpenseTypes() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.expenseTypes,
    staleTime: 5 * 60_000,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/issues/expense-types', { signal })),
  });
}

/** Active staff by name, for an issue's recipient (ADR-0081). */
export function useUserLookup(q: string, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['identity', 'users', 'lookup', q],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/users/lookup', {
          params: { query: { q: q || undefined } },
          signal,
        }),
      ),
  });
}

/** Active customers by name or code, for anyone signed in (ADR-0081 #6). */
export function useCustomerLookup(q: string, enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['partners', 'customers', 'lookup', q],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/customers/lookup', {
          params: { query: { q: q || undefined } },
          signal,
        }),
      ),
  });
}

export function useIssueMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  const issuesChanged = () => invalidate(KEYS.issues, KEYS.stock);
  /** A draft's new copy goes into the cache at once; the list refreshes behind it. */
  const issueChanged = async (issue: IssueDetail) => {
    const key = [...KEYS.issues, issue.id];
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData(key, issue);
    void invalidate([...KEYS.issues, 'list']);
  };
  const typesChanged = () => invalidate(KEYS.expenseTypes);

  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<IssueCreate>) =>
        unwrap(await api.POST('/api/v1/issues', { params: { header: idempotencyKey(key) }, body })),
      onSuccess: issueChanged,
    }),
    update: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: IssueUpdate }) =>
        unwrap(await api.PATCH('/api/v1/issues/{id}', { params: { path: { id } }, body })),
      onSuccess: issueChanged,
    }),
    addLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: IssueLineRequest }) =>
        unwrap(await api.POST('/api/v1/issues/{id}/lines', { params: { path: { id } }, body })),
      onSuccess: issueChanged,
    }),
    updateLine: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: IssueLineUpdate }) =>
        unwrap(await api.PATCH('/api/v1/issue-lines/{id}', { params: { path: { id } }, body })),
      onSuccess: issueChanged,
    }),
    removeLine: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/issue-lines/{id}', { params: { path: { id } } })),
      onSuccess: issueChanged,
    }),
    post: useMutation({
      mutationFn: async ({ id, key }: { id: number; key: string }) =>
        unwrap(
          await api.POST('/api/v1/issues/{id}/post', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: async (issue) => {
        queryClient.setQueryData([...KEYS.issues, issue.id], issue);
        await issuesChanged();
      },
    }),
    cancel: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/issues/{id}/cancel', { params: { path: { id } } })),
      onSuccess: issuesChanged,
    }),
    createType: useMutation({
      mutationFn: async (name: string) =>
        unwrap(await api.POST('/api/v1/issues/expense-types', { body: { name } })),
      onSuccess: typesChanged,
    }),
    updateType: useMutation({
      mutationFn: async ({
        id,
        body,
      }: {
        id: number;
        body: Schemas['IssueExpenseTypeUpdateRequest'];
      }) =>
        unwrap(
          await api.PATCH('/api/v1/issues/expense-types/{id}', { params: { path: { id } }, body }),
        ),
      onSuccess: typesChanged,
    }),
  };
}
