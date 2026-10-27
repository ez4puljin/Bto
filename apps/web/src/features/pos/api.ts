import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type PosSettings = Schemas['PosSettings'];
export type PosSettingsPatch = Schemas['PosSettingsPatch'];
export type EdgeNode = Schemas['PosEdgeNode'];
export type EdgeNodeRequest = Schemas['PosEdgeNodeRequest'];
export type EdgeNodePatch = Schemas['PosEdgeNodePatch'];
export type Till = Schemas['PosTill'];
export type TillRequest = Schemas['PosTillRequest'];
export type TillPatch = Schemas['PosTillPatch'];
export type Cashier = Schemas['PosCashier'];
export type Shift = Schemas['PosShift'];
export type ShiftStatus = Shift['status'];
export type Sale = Schemas['PosSale'];
export type SaleDetail = Schemas['PosSaleDetail'];
export type SaleKind = Sale['kind'];
export type EbarimtStatus = Sale['ebarimtStatus'];
export type Shortfall = Schemas['PosShortfall'];
export type Rejection = Schemas['PosSyncRejection'];
export type PosAttention = Schemas['PosAttention'];
export type HandoverRequest = Schemas['PosHandoverRequest'];
export type DevSaleRequest = Schemas['PosDevSaleRequest'];
export type DevOpenShiftRequest = Schemas['PosDevOpenShiftRequest'];
export type DevCloseShiftRequest = Schemas['PosDevCloseShiftRequest'];
export type QuickGroup = Schemas['PosQuickGroup'];
export type QuickButton = Schemas['PosQuickButton'];
export type QuickButtonsRequest = Schemas['PosQuickButtonsRequest'];
export type Void = Schemas['PosVoid'];
export type VoidDetail = Schemas['PosVoidDetail'];
export type VoidReason = Void['reason'];

/** Idempotent routes take the key from the caller: one key per user intent (ADR-0004). */
type Keyed<T> = T & { key: string };

export const POS_KEYS = {
  settings: ['pos', 'settings'] as const,
  nodes: ['pos', 'nodes'] as const,
  tills: ['pos', 'tills'] as const,
  cashiers: ['pos', 'cashiers'] as const,
  shifts: ['pos', 'shifts'] as const,
  sales: ['pos', 'sales'] as const,
  shortfalls: ['pos', 'shortfalls'] as const,
  rejections: ['pos', 'rejections'] as const,
  quickButtons: ['pos', 'quick-buttons'] as const,
  voids: ['pos', 'voids'] as const,
};

export function usePosSettings(options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: POS_KEYS.settings,
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/settings', { signal })),
  });
}

export function useEdgeNodes() {
  const api = useApiClient();
  return useQuery({
    queryKey: POS_KEYS.nodes,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/edge-nodes', { signal })),
  });
}

export function useTills(edgeNodeId?: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...POS_KEYS.tills, edgeNodeId ?? 'all'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/pos/tills', { params: { query: { edgeNodeId } }, signal })),
  });
}

export function useCashiers() {
  const api = useApiClient();
  return useQuery({
    queryKey: POS_KEYS.cashiers,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/cashiers', { signal })),
  });
}

export interface ShiftFilter {
  edgeNodeId?: number;
  tillId?: number;
  cashierUserId?: number;
  status?: ShiftStatus;
  from?: string;
  to?: string;
}

export function useShifts(filter: ShiftFilter, options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...POS_KEYS.shifts, 'list', filter],
    enabled: options.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/shifts', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useShift(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...POS_KEYS.shifts, 'detail', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/shifts/{id}', { params: { path: { id: id ?? 0 } }, signal }),
      ),
  });
}

export interface SaleFilter {
  q?: string;
  edgeNodeId?: number;
  tillId?: number;
  shiftId?: number;
  cashierUserId?: number;
  kind?: SaleKind;
  ebarimtStatus?: EbarimtStatus;
  from?: string;
  to?: string;
}

export function useSales(filter: SaleFilter, options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...POS_KEYS.sales, 'list', filter],
    enabled: options.enabled ?? true,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/sales', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useSale(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...POS_KEYS.sales, 'detail', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/sales/{id}', { params: { path: { id: id ?? 0 } }, signal }),
      ),
  });
}

export function useShortfalls(filter: { productId?: number; resolved?: boolean }) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...POS_KEYS.shortfalls, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/shortfalls', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** The till's F7 panel (ADR-0104): the groups and their buttons, in order. */
export function useQuickButtons() {
  const api = useApiClient();
  return useQuery({
    queryKey: POS_KEYS.quickButtons,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/quick-buttons', { signal })),
  });
}

export interface VoidFilter {
  tillId?: number;
  cashierUserId?: number;
  reason?: VoidReason;
  from?: string;
  to?: string;
}

export function useVoids(filter: VoidFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...POS_KEYS.voids, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/voids', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useVoid(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...POS_KEYS.voids, 'detail', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/voids/{id}', { params: { path: { id: id ?? 0 } }, signal }),
      ),
  });
}

export function usePosAttention(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ATTENTION_KEY, 'pos'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/attention', { signal })),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** Mutations; each refreshes what it can change. */
export function usePosMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = (...keys: readonly (readonly string[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  return {
    saveSettings: useMutation({
      mutationFn: async (body: PosSettingsPatch) =>
        unwrap(await api.PUT('/api/v1/pos/settings', { body })),
      onSuccess: () => refresh(POS_KEYS.settings),
    }),
    createNode: useMutation({
      mutationFn: async (body: EdgeNodeRequest) =>
        unwrap(await api.POST('/api/v1/pos/edge-nodes', { body })),
      onSuccess: () => refresh(POS_KEYS.nodes),
    }),
    updateNode: useMutation({
      mutationFn: async ({ id, ...body }: EdgeNodePatch & { id: number }) =>
        unwrap(await api.PUT('/api/v1/pos/edge-nodes/{id}', { params: { path: { id } }, body })),
      onSuccess: () => refresh(POS_KEYS.nodes),
    }),
    issueToken: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/pos/edge-nodes/{id}/token', { params: { path: { id } } })),
      onSuccess: () => refresh(POS_KEYS.nodes),
    }),
    createTill: useMutation({
      mutationFn: async (body: TillRequest) =>
        unwrap(await api.POST('/api/v1/pos/tills', { body })),
      onSuccess: () => refresh(POS_KEYS.tills),
    }),
    updateTill: useMutation({
      mutationFn: async ({ id, ...body }: TillPatch & { id: number }) =>
        unwrap(await api.PUT('/api/v1/pos/tills/{id}', { params: { path: { id } }, body })),
      onSuccess: () => refresh(POS_KEYS.tills),
    }),
    pairingCode: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/pos/tills/{id}/pairing-code', { params: { path: { id } } })),
      onSuccess: () => refresh(POS_KEYS.tills),
    }),
    setPin: useMutation({
      mutationFn: async ({ userId, pin }: { userId: number; pin: string }) =>
        unwrap(
          await api.PUT('/api/v1/pos/cashiers/{userId}/pin', {
            params: { path: { userId } },
            body: { pin },
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.cashiers),
    }),
    setCashierStatus: useMutation({
      mutationFn: async ({ userId, status }: { userId: number; status: Cashier['status'] }) =>
        unwrap(
          await api.PUT('/api/v1/pos/cashiers/{userId}/status', {
            params: { path: { userId } },
            body: { status },
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.cashiers),
    }),
    unlockCashier: useMutation({
      mutationFn: async (userId: number) =>
        unwrap(
          await api.POST('/api/v1/pos/cashiers/{userId}/unlock', { params: { path: { userId } } }),
        ),
      onSuccess: () => refresh(POS_KEYS.cashiers),
    }),
    handOver: useMutation({
      mutationFn: async ({ id, key, ...body }: Keyed<HandoverRequest & { id: number }>) =>
        unwrap(
          await api.POST('/api/v1/pos/shifts/{id}/handover', {
            params: { path: { id }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.shifts, ATTENTION_KEY, ['finance']),
    }),
    resolveShortfall: useMutation({
      mutationFn: async ({ id, note }: { id: number; note: string | null }) =>
        unwrap(
          await api.POST('/api/v1/pos/shortfalls/{id}/resolve', {
            params: { path: { id } },
            body: { note },
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.shortfalls, POS_KEYS.sales, ATTENTION_KEY),
    }),
    reviewCredit: useMutation({
      mutationFn: async ({ id, note }: { id: number; note: string | null }) =>
        unwrap(
          await api.POST('/api/v1/pos/sales/{id}/credit-review', {
            params: { path: { id } },
            body: { note },
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.sales, ATTENTION_KEY),
    }),
    saveQuickButtons: useMutation({
      mutationFn: async (body: QuickButtonsRequest) =>
        unwrap(await api.PUT('/api/v1/pos/quick-buttons', { body })),
      // The answer is the whole saved set: the page shows it at once, without a second read.
      onSuccess: (groups) => queryClient.setQueryData(POS_KEYS.quickButtons, groups),
    }),
    devOpenShift: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<DevOpenShiftRequest>) =>
        unwrap(
          await api.POST('/api/v1/pos/dev/shifts/open', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.shifts, ATTENTION_KEY),
    }),
    devSale: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<DevSaleRequest>) =>
        unwrap(
          await api.POST('/api/v1/pos/dev/sales', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.sales, POS_KEYS.shifts, POS_KEYS.shortfalls, ['stock']),
    }),
    devCloseShift: useMutation({
      mutationFn: async ({ id, key, ...body }: Keyed<DevCloseShiftRequest & { id: number }>) =>
        unwrap(
          await api.POST('/api/v1/pos/dev/shifts/{id}/close', {
            params: { path: { id }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => refresh(POS_KEYS.shifts, ATTENTION_KEY, ['finance']),
    }),
  };
}
