import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { paths } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

/** A report's body as its route answers it (named by route: the schema names may change). */
type Body<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer T } } } };
}
  ? T
  : never;

export type Dashboard = Body<'/api/v1/reports/dashboard'>;
export type DashboardCategory = Dashboard['categories'][number];
export type Aging = Body<'/api/v1/reports/aging'>;
export type AgingRow = Aging['rows'][number];
export type AgingItems = Body<'/api/v1/reports/aging/{partyId}/items'>;
export type ProfitReport = Body<'/api/v1/reports/profit'>;
export type ProfitRow = ProfitReport['rows'][number];
export type SalesDocuments = Body<'/api/v1/reports/sales-documents'>;
export type SalesDocument = SalesDocuments['rows'][number];
export type StockReport = Body<'/api/v1/reports/stock'>;
export type StockReportRow = StockReport['rows'][number];
export type SupplierReport = Body<'/api/v1/reports/suppliers'>;
export type SupplierReportRow = SupplierReport['rows'][number];
export type SupplierEntries = Body<'/api/v1/reports/suppliers/{partyId}/entries'>;
export type ReportRefreshState = Body<'/api/v1/reports/refresh-state'>;

export type SettlementGroup = NonNullable<AgingRow['settlementGroup']>;
export type ProfitGrouping = ProfitReport['by'];
export type SalesSource = 'ALL' | 'WHOLESALE' | 'POS';
export type StockFilterKind = 'ALL' | 'SLOW' | 'LOW';
export type SlowDays = 30 | 60 | 90 | 180;

export const PROFIT_GROUPINGS = ['customer', 'product', 'category', 'rep'] as const;
export const SALES_SOURCES = ['ALL', 'WHOLESALE', 'POS'] as const;
export const STOCK_FILTERS = ['ALL', 'SLOW', 'LOW'] as const;
export const SLOW_DAYS = [30, 60, 90, 180] as const;

/** Every query of the management reports (ADR-0108) lives under this key; «Шинэчлэх» refetches them. */
const REPORTS = ['reports'] as const;

export interface AgingFilter {
  settlementGroup?: SettlementGroup;
  q?: string;
  overdueOnly?: boolean;
}

/** What narrows the sales figures: the profit report and its documents share it. */
export interface SalesFilter {
  from: string;
  to: string;
  source?: SalesSource;
  customerId?: number;
  productId?: number;
  categoryId?: number;
  repUserId?: number;
  app?: boolean;
}

export interface StockFilter {
  slowDays: SlowDays;
  filter: StockFilterKind;
  q?: string;
  warehouseId?: number;
  categoryId?: number;
}

export interface SupplierFilter {
  from: string;
  to: string;
  q?: string;
}

/** The query string of a sales filter: only what narrows (a default source, no app flag). */
function salesQuery(filter: SalesFilter) {
  return {
    from: filter.from,
    to: filter.to,
    ...(filter.source && filter.source !== 'ALL' ? { source: filter.source } : {}),
    ...(filter.customerId ? { customerId: filter.customerId } : {}),
    ...(filter.productId ? { productId: filter.productId } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    ...(filter.repUserId ? { repUserId: filter.repUserId } : {}),
    ...(filter.app ? { app: true } : {}),
  };
}

function agingQuery(filter: AgingFilter) {
  return {
    ...(filter.settlementGroup ? { settlementGroup: filter.settlementGroup } : {}),
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.overdueOnly ? { overdueOnly: true } : {}),
  };
}

function stockQuery(filter: StockFilter) {
  return {
    slowDays: filter.slowDays,
    filter: filter.filter,
    ...(filter.q ? { q: filter.q } : {}),
    ...(filter.warehouseId ? { warehouseId: filter.warehouseId } : {}),
    ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
  };
}

function supplierQuery(filter: SupplierFilter) {
  return { from: filter.from, to: filter.to, ...(filter.q ? { q: filter.q } : {}) };
}

/** When the daily totals were last rebuilt. */
export function useRefreshState() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'refresh-state'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/reports/refresh-state', { signal })),
  });
}

/** «Шинэчлэх»: rebuilds the daily totals (the server skips it within a minute), then refetches. */
export function useRefreshReports() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/api/v1/reports/refresh')),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: REPORTS }),
  });
}

export function useDashboard(month: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'dashboard', month],
    enabled: month !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/dashboard', {
          params: { query: month ? { month } : {} },
          signal,
        }),
      ),
  });
}

export function useAging(filter: AgingFilter) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'aging', filter],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/aging', { params: { query: agingQuery(filter) }, signal }),
      ),
  });
}

export function useAgingItems(partyId: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'aging-items', partyId],
    enabled: partyId !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/aging/{partyId}/items', {
          params: { path: { partyId: partyId ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useProfit(by: ProfitGrouping, filter: SalesFilter | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'profit', by, filter],
    enabled: filter !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/profit', {
          params: { query: { by, ...salesQuery(filter ?? { from: '', to: '' }) } },
          signal,
        }),
      ),
  });
}

export function useSalesDocuments(filter: SalesFilter | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'sales-documents', filter],
    enabled: filter !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/sales-documents', {
          params: { query: salesQuery(filter ?? { from: '', to: '' }) },
          signal,
        }),
      ),
  });
}

/** The stock report a page («Цааш үзэх») at a time. */
export function useStockReport(filter: StockFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...REPORTS, 'stock', filter],
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/stock', {
          params: { query: { ...stockQuery(filter), offset: pageParam, limit: 200 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** The first 500 rows of the stock report, for paper. */
export function useStockPrint(filter: StockFilter) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'stock-print', filter],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/stock', {
          params: { query: { ...stockQuery(filter), limit: 500 } },
          signal,
        }),
      ),
  });
}

export function useSupplierReport(filter: SupplierFilter | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'suppliers', filter],
    enabled: filter !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/suppliers', {
          params: { query: supplierQuery(filter ?? { from: '', to: '' }) },
          signal,
        }),
      ),
  });
}

export function useSupplierEntries(partyId: number | null, range: { from: string; to: string }) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...REPORTS, 'supplier-entries', partyId, range],
    enabled: partyId !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/suppliers/{partyId}/entries', {
          params: { path: { partyId: partyId ?? 0 }, query: range },
          signal,
        }),
      ),
  });
}

/** The Excel copies of the reports, downloaded as files. */
export function useReportDownloads() {
  const api = useApiClient();
  return {
    dashboard: useMutation({
      mutationFn: async (month: string): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/dashboard.xlsx', {
            params: { query: { month } },
            parseAs: 'blob',
          }),
        ),
    }),
    aging: useMutation({
      mutationFn: async (filter: AgingFilter): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/aging.xlsx', {
            params: { query: agingQuery(filter) },
            parseAs: 'blob',
          }),
        ),
    }),
    profit: useMutation({
      mutationFn: async ({
        by,
        filter,
      }: {
        by: ProfitGrouping;
        filter: SalesFilter;
      }): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/profit.xlsx', {
            params: { query: { by, ...salesQuery(filter) } },
            parseAs: 'blob',
          }),
        ),
    }),
    stock: useMutation({
      mutationFn: async (filter: StockFilter): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/stock.xlsx', {
            params: { query: stockQuery(filter) },
            parseAs: 'blob',
          }),
        ),
    }),
    suppliers: useMutation({
      mutationFn: async (filter: SupplierFilter): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/suppliers.xlsx', {
            params: { query: supplierQuery(filter) },
            parseAs: 'blob',
          }),
        ),
    }),
  };
}
