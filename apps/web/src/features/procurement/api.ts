import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { PO_SUPPLIER_STATUSES } from '@tugeel/shared/procurement';
import { useApiClient } from '@/app/api-client-context';
import { KEYS as INVENTORY_KEYS } from '@/features/inventory/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type PurchaseOrderSummary = Schemas['PurchaseOrderSummary'];
export type PurchaseOrderDetail = Schemas['PurchaseOrderDetail'];
export type PurchaseOrderSupplier = Schemas['PurchaseOrderSupplier'];
export type PurchaseOrderCreate = Schemas['PurchaseOrderCreateRequest'];
export type PurchaseOrderVersion = Schemas['PurchaseOrderVersion'];
export type PoStatus = PurchaseOrderDetail['status'];
export type GridRow = Schemas['PurchaseOrderGridRow'];
export type GridPage = Schemas['PurchaseOrderGridPage'];
export type GridUnit = Schemas['PurchaseOrderGridUnit'];
export type GridReceiptLine = Schemas['PurchaseOrderGridReceiptLine'];
export type GridChange = Schemas['PurchaseOrderGridChange'];
export type GridSaveResult = Schemas['PurchaseOrderGridSaveResult'];
export type GridRefusalReason = Schemas['PurchaseOrderGridRefusal']['reason'];
export type ArrivalChange = Schemas['PurchaseOrderArrivalChange'];
export type ArrivalSaveResult = Schemas['PurchaseOrderArrivalsSaveResult'];
export type ArrivalRefusalReason = Schemas['PurchaseOrderArrivalRefusal']['reason'];
export type HistoryRow = Schemas['PurchaseOrderHistoryRow'];
export type PurchaseOrderPrint = Schemas['PurchaseOrderPrint'];
export type OrdererCandidate = Schemas['OrdererCandidate'];
export type SupplierOrderer = Schemas['SupplierOrderer'];
export type GridFilter = 'ALL' | 'ORDERED' | 'BELOW_MIN';

/** A supplier's statuses inside an order, in their order (ADR-0115, ADR-0118). */
export const PO_STATUSES: readonly PoStatus[] = PO_SUPPLIER_STATUSES;

export const isPoStatus = (value: string | null): value is PoStatus =>
  PO_STATUSES.some((status) => status === value);

export const KEYS = {
  orders: ['procurement', 'orders'] as const,
  orderers: ['procurement', 'supplier-orderers'] as const,
  candidates: ['procurement', 'orderer-candidates'] as const,
};

/** Idempotent routes take the key from the caller: one key per user intent (ADR-0004). */
type Keyed<T> = T & { key: string };

export interface PurchaseOrderFilter {
  q?: string;
  status?: PoStatus;
  supplierId?: number;
  /** Orders with a supplier the caller orders from. */
  mine?: boolean;
  /** The archived orders instead of the live ones (ADR-0118 #7). */
  archived?: boolean;
}

export function usePurchaseOrders(filter: PurchaseOrderFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.orders, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/purchase-orders', {
          params: {
            query: {
              q: filter.q || undefined,
              status: filter.status,
              supplierId: filter.supplierId,
              mine: filter.mine || undefined,
              archived: filter.archived || undefined,
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

export function usePurchaseOrder(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.orders, id],
    enabled: id > 0,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/purchase-orders/{id}', { params: { path: { id } }, signal })),
  });
}

/**
 * The stamps the detail page polls every 30 s (ADR-0118 #3): when they move past the ones the page
 * loaded with, the yellow bar offers «Дахин ачаалах»; nothing refreshes on its own while someone
 * types.
 */
export function usePurchaseOrderVersion(id: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.orders, id, 'version'],
    enabled: id > 0 && enabled,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/purchase-orders/{id}/version', { params: { path: { id } }, signal }),
      ),
  });
}

export const rowsKey = (id: number, supplierId: number) => [...KEYS.orders, id, 'rows', supplierId];

export interface GridQuery {
  q?: string;
  filter: GridFilter;
  warehouseId?: number;
}

/**
 * One supplier's grid: its products 200 at a time, with the order's lines, the facts and, once it
 * arrived, its receipt line beside them. The rows never refetch on their own (a typed cell must not
 * be swept away): the page reloads them on «Дахин ачаалах» or after its own saves.
 */
export function usePurchaseOrderRows(id: number, supplierId: number, query: GridQuery) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...rowsKey(id, supplierId), query],
    enabled: id > 0 && supplierId > 0,
    initialPageParam: undefined as string | undefined,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/purchase-orders/{id}/suppliers/{supplierId}/rows', {
          params: {
            path: { id, supplierId },
            query: {
              q: query.q || undefined,
              filter: query.filter,
              warehouseId: query.warehouseId,
              cursor: pageParam,
              limit: 200,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The order's sheets for the suppliers: all of them, or one. */
export function usePurchaseOrderPrint(id: number, supplierId: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.orders, id, 'print', supplierId ?? null],
    enabled: id > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/purchase-orders/{id}/print', {
          params: { path: { id }, query: { supplierId } },
          signal,
        }),
      ),
  });
}

export interface HistoryFilter {
  userId?: number;
  supplierId?: number;
  productId?: number;
}

/** The order's history (ADR-0118 #6), newest first, 100 at a time. */
export function useOrderHistory(id: number, filter: HistoryFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.orders, id, 'history', filter],
    enabled: id > 0,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/purchase-orders/{id}/history', {
          params: { path: { id }, query: { ...filter, cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The order's Excel files (ADR-0118 #6–#7), as blobs the page saves. */
export function usePurchaseOrderDownloads() {
  const api = useApiClient();
  return {
    exportExcel: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.GET('/api/v1/purchase-orders/{id}/export.xlsx', {
            params: { path: { id } },
            parseAs: 'blob',
          }),
        ),
    }),
    historyExcel: useMutation({
      mutationFn: async ({ id, ...filter }: { id: number } & HistoryFilter) =>
        unwrap(
          await api.GET('/api/v1/purchase-orders/{id}/history.xlsx', {
            params: { path: { id }, query: filter },
            parseAs: 'blob',
          }),
        ),
    }),
  };
}

export function usePurchaseOrderMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (...keys: (readonly unknown[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  /** The order's new copy goes into the cache; its list and grids refresh behind it. */
  const orderChanged = async (order: PurchaseOrderDetail) => {
    const key = [...KEYS.orders, order.id];
    await queryClient.cancelQueries({ queryKey: key, exact: true });
    queryClient.setQueryData(key, order);
    await invalidate(
      [...KEYS.orders, 'list'],
      [...KEYS.orders, order.id, 'rows'],
      [...KEYS.orders, order.id, 'version'],
    );
  };

  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<PurchaseOrderCreate>) =>
        unwrap(
          await api.POST('/api/v1/purchase-orders', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: orderChanged,
    }),
    updateNote: useMutation({
      mutationFn: async ({ id, note }: { id: number; note: string | null }) =>
        unwrap(
          await api.PATCH('/api/v1/purchase-orders/{id}', {
            params: { path: { id } },
            body: { note },
          }),
        ),
      onSuccess: orderChanged,
    }),
    addSuppliers: useMutation({
      mutationFn: async ({ id, supplierIds }: { id: number; supplierIds: number[] }) =>
        unwrap(
          await api.POST('/api/v1/purchase-orders/{id}/suppliers', {
            params: { path: { id } },
            body: { supplierIds },
          }),
        ),
      onSuccess: orderChanged,
    }),
    removeSupplier: useMutation({
      mutationFn: async ({ id, supplierId }: { id: number; supplierId: number }) =>
        unwrap(
          await api.DELETE('/api/v1/purchase-orders/{id}/suppliers/{supplierId}', {
            params: { path: { id, supplierId } },
          }),
        ),
      onSuccess: orderChanged,
    }),
    /** One step forward or back; ARRIVED makes the supplier's draft receipt. */
    move: useMutation({
      mutationFn: async ({
        key,
        id,
        supplierId,
        to,
      }: {
        key: string;
        id: number;
        supplierId: number;
        to: PoStatus;
      }) =>
        unwrap(
          await api.POST('/api/v1/purchase-orders/{id}/suppliers/{supplierId}/status', {
            params: { path: { id, supplierId }, header: idempotencyKey(key) },
            body: { to },
          }),
        ),
      onSuccess: async (order) => {
        await orderChanged(order);
        await invalidate(INVENTORY_KEYS.receipts);
      },
    }),
    archive: useMutation({
      mutationFn: async ({ key, id, archived }: { key: string; id: number; archived: boolean }) =>
        unwrap(
          archived
            ? await api.POST('/api/v1/purchase-orders/{id}/archive', {
                params: { path: { id }, header: idempotencyKey(key) },
              })
            : await api.POST('/api/v1/purchase-orders/{id}/unarchive', {
                params: { path: { id }, header: idempotencyKey(key) },
              }),
        ),
      onSuccess: orderChanged,
    }),
    /** Only the changed cells, each with the value it had when the page opened. */
    saveLines: useMutation({
      mutationFn: async ({
        id,
        supplierId,
        changes,
      }: {
        id: number;
        supplierId: number;
        changes: GridChange[];
      }) =>
        unwrap(
          await api.PUT('/api/v1/purchase-orders/{id}/suppliers/{supplierId}/lines', {
            params: { path: { id, supplierId } },
            body: { changes },
          }),
        ),
    }),
    /** The keepers' counts typed on the order page (boxes × pieces as a base quantity, a note). */
    saveArrivals: useMutation({
      mutationFn: async ({
        id,
        supplierId,
        changes,
      }: {
        id: number;
        supplierId: number;
        changes: ArrivalChange[];
      }) =>
        unwrap(
          await api.PUT('/api/v1/purchase-orders/{id}/suppliers/{supplierId}/arrivals', {
            params: { path: { id, supplierId } },
            body: { changes },
          }),
        ),
    }),
    /** After the page's own saves: the order's figures, its rows and its version again. */
    refreshOrder: (id: number) =>
      invalidate(
        [...KEYS.orders, id],
        [...KEYS.orders, 'list'],
        [...KEYS.orders, id, 'rows'],
        [...KEYS.orders, id, 'version'],
        INVENTORY_KEYS.receipts,
      ),
  };
}

/** Staff who may be named a supplier's orderer. */
export function useOrdererCandidates(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.candidates,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/procurement/orderer-candidates', { signal })),
  });
}

export function useSupplierOrderer(supplierId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.orderers, supplierId],
    enabled: supplierId > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/procurement/supplier-orderers/{supplierId}', {
          params: { path: { supplierId } },
          signal,
        }),
      ),
  });
}

export function useSetSupplierOrderer(supplierId: number) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (userId: number | null) =>
      unwrap(
        await api.PUT('/api/v1/procurement/supplier-orderers/{supplierId}', {
          params: { path: { supplierId } },
          body: { userId },
        }),
      ),
    onSuccess: async (orderer) => {
      queryClient.setQueryData([...KEYS.orderers, supplierId], orderer);
      await queryClient.invalidateQueries({ queryKey: KEYS.orders });
    },
  });
}
