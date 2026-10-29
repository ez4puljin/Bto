import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { KEYS as INVENTORY_KEYS } from '@/features/inventory/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type PurchaseOrderSummary = Schemas['PurchaseOrderSummary'];
export type PurchaseOrderDetail = Schemas['PurchaseOrderDetail'];
export type PurchaseOrderSupplier = Schemas['PurchaseOrderSupplier'];
export type PurchaseOrderCreate = Schemas['PurchaseOrderCreateRequest'];
export type PoStatus = PurchaseOrderDetail['status'];
export type GridRow = Schemas['PurchaseOrderGridRow'];
export type GridUnit = Schemas['PurchaseOrderGridUnit'];
export type GridChange = Schemas['PurchaseOrderGridChange'];
export type GridSaveResult = Schemas['PurchaseOrderGridSaveResult'];
export type GridRefusalReason = Schemas['PurchaseOrderGridRefusal']['reason'];
export type PurchaseOrderPrint = Schemas['PurchaseOrderPrint'];
export type OrdererCandidate = Schemas['OrdererCandidate'];
export type SupplierOrderer = Schemas['SupplierOrderer'];
export type GridFilter = 'ALL' | 'ORDERED' | 'BELOW_MIN';

/** A supplier's statuses inside an order, in their order (ADR-0115). */
export const PO_STATUSES: readonly PoStatus[] = [
  'PREPARING',
  'SENT',
  'IN_TRANSIT',
  'ARRIVED',
  'ACCOUNTING',
  'RECEIVED',
];

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

const rowsKey = (id: number, supplierId: number) => [...KEYS.orders, id, 'rows', supplierId];

/** One supplier's grid: its products 200 at a time, with the order's lines and the facts beside them. */
export function usePurchaseOrderRows(
  id: number,
  supplierId: number | undefined,
  filter: { q?: string; filter: GridFilter },
) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...rowsKey(id, supplierId ?? 0), filter],
    enabled: id > 0 && supplierId !== undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/purchase-orders/{id}/suppliers/{supplierId}/rows', {
          params: {
            path: { id, supplierId: supplierId ?? 0 },
            query: {
              q: filter.q || undefined,
              filter: filter.filter,
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
    await invalidate([...KEYS.orders, 'list'], [...KEYS.orders, order.id, 'rows']);
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
      // The grid shows the saved values before it lets go of the typed ones.
      onSuccess: (_result, { id }) => invalidate([...KEYS.orders, id], [...KEYS.orders, 'list']),
    }),
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
