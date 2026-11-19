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

// «Асуудалтай бараа» (ADR-0230): the list per warehouse, its decisions, the settings, the sheets.

type Schemas = components['schemas'];
export type StockProblemWarehouse = Schemas['StockProblemWarehouseDto'];
export type StockProblem = Schemas['StockProblemDto'];
export type StockProblemEvent = Schemas['StockProblemEventDto'];
export type StockProblemPending = Schemas['StockProblemPendingDto'];
export type StockProblemSettings = Schemas['StockProblemSettingsDto'];
export type StockProblemSheet = Schemas['StockProblemSheetDto'];
export type StockProblemSheetDetail = Schemas['StockProblemSheetDetailDto'];
export type StockProblemSheetLine = Schemas['StockProblemSheetLineDto'];
export type SheetStatus = StockProblemSheet['status'];

export const SHEET_STATUSES: readonly SheetStatus[] = ['OPEN', 'APPROVED', 'CLOSED'];

const ROOT = ['stock-problems'] as const;

export function useStockProblemWarehouses() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'warehouses'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/stock-problems/warehouses', { signal })),
  });
}

export function useStockProblems(warehouseId: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'list', warehouseId],
    enabled: warehouseId !== undefined,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-problems', {
          params: { query: { warehouseId: warehouseId ?? 0 } },
          signal,
        }),
      ).data,
  });
}

export function useStockProblemSettings(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'settings'],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/stock-problems/settings', { signal })),
  });
}

export interface SheetFilter {
  warehouseId?: number;
  status?: SheetStatus;
  sheetDate?: string;
}

export function useStockProblemSheets(filter: SheetFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...ROOT, 'sheets', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-problems/sheets', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useStockProblemSheet(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'sheet', id],
    enabled: Number.isInteger(id),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/stock-problems/sheets/{id}', { params: { path: { id } }, signal }),
      ),
  });
}

export function useStockProblemMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () =>
    Promise.all(
      [ROOT, ATTENTION_KEY, ['inventory']].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
  return {
    legit: useMutation({
      mutationFn: async (input: {
        key: string;
        warehouseId: number;
        productId: number;
        note?: string | null;
      }) => {
        const { key, ...body } = input;
        return unwrap(
          await api.POST('/api/v1/stock-problems/legitimate', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        );
      },
      onSuccess: changed,
    }),
    zeroOut: useMutation({
      mutationFn: async (input: {
        key: string;
        warehouseId: number;
        productId: number;
        qty?: string | null;
      }) => {
        const { key, ...body } = input;
        return unwrap(
          await api.POST('/api/v1/stock-problems/zero-out', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        );
      },
      onSuccess: changed,
    }),
    saveSettings: useMutation({
      mutationFn: async (input: {
        warehouseId: number;
        customerId: number | null;
        expenseTypeId: number | null;
      }) =>
        unwrap(
          await api.PUT('/api/v1/stock-problems/settings/{warehouseId}', {
            params: { path: { warehouseId: input.warehouseId } },
            body: { customerId: input.customerId, expenseTypeId: input.expenseTypeId },
          }),
        ),
      onSuccess: changed,
    }),
    build: useMutation({
      mutationFn: async (input: { key: string; warehouseId?: number }) =>
        unwrap(
          await api.POST('/api/v1/stock-problems/sheets/build', {
            params: { header: idempotencyKey(input.key) },
            body: { warehouseId: input.warehouseId },
          }),
        ),
      onSuccess: changed,
    }),
    approve: useMutation({
      mutationFn: async (input: { key: string; id: number; countedOnly: boolean }) =>
        unwrap(
          await api.POST('/api/v1/stock-problems/sheets/{id}/approve', {
            params: { path: { id: input.id }, header: idempotencyKey(input.key) },
            body: { countedOnly: input.countedOnly },
          }),
        ),
      onSuccess: changed,
    }),
  };
}
