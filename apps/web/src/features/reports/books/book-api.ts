import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { paths } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

/** A report's body as its route answers it. */
type Body<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer T } } } };
}
  ? T
  : never;
/** A route's query parameters. */
type Query<P extends keyof paths> = paths[P] extends {
  get: { parameters: { query: infer Q } };
}
  ? Q
  : never;

export type LedgerReport = Body<'/api/v1/finance/reports/ledger'>;
export type LedgerRow = LedgerReport['data'][number];
export type LedgerParty = NonNullable<LedgerRow['party']>;
export type LedgerLines = Body<'/api/v1/finance/reports/ledger/lines'>;
export type LedgerLine = LedgerLines['data'][number];
export type LedgerAccount = Body<'/api/v1/finance/reports/ledger/accounts'>['data'][number];
export type LedgerQuery = Query<'/api/v1/finance/reports/ledger'>;
export type LedgerKind = LedgerQuery['kind'];

export type BookOptions = Body<'/api/v1/reports/book-options'>;
export type BookOption = BookOptions['warehouses'][number];

export type StockBalance = Body<'/api/v1/reports/stock-balance'>;
export type StockBalanceRow = StockBalance['rows'][number];
export type StockBalanceQuery = Query<'/api/v1/reports/stock-balance'>;
export type StockBalanceLines = Body<'/api/v1/reports/stock-balance/lines'>;
export type StockBalanceLine = StockBalanceLines['rows'][number];

export type ProductSales = Body<'/api/v1/reports/product-sales'>;
export type ProductSalesRow = ProductSales['rows'][number];
export type ProductSalesQuery = Query<'/api/v1/reports/product-sales'>;
export type ProductSalesDocuments = Body<'/api/v1/reports/product-sales/documents'>;
export type ProductSalesDocument = ProductSalesDocuments['rows'][number];
export type ProductSalesPayment = ProductSales['payments'][number];
export type PaidAmount = ProductSalesRow['paid'][number];

export type StockDocuments = Body<'/api/v1/reports/stock-documents'>;
export type StockDocumentRow = StockDocuments['rows'][number];
export type StockDocumentsQuery = Query<'/api/v1/reports/stock-documents'>;
export type StockDocType = StockDocumentRow['docType'];
export type StockDocumentLine = Body<'/api/v1/reports/stock-documents/lines'>['data'][number];

const KEYS = {
  ledgerAccounts: ['books', 'ledger-accounts'] as const,
  ledger: ['books', 'ledger'] as const,
  ledgerLines: ['books', 'ledger-lines'] as const,
  options: ['books', 'options'] as const,
  stockBalance: ['books', 'stock-balance'] as const,
  stockBalanceLines: ['books', 'stock-balance-lines'] as const,
  productSales: ['books', 'product-sales'] as const,
  productSalesDocuments: ['books', 'product-sales-documents'] as const,
  stockDocuments: ['books', 'stock-documents'] as const,
  stockDocumentLines: ['books', 'stock-document-lines'] as const,
};

export function useLedgerAccounts() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.ledgerAccounts,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/finance/reports/ledger/accounts', { signal })).data,
    staleTime: 5 * 60_000,
  });
}

export function useBookOptions() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.options,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/reports/book-options', { signal })),
    staleTime: 5 * 60_000,
  });
}

export function useLedgerReport(query: LedgerQuery | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.ledger, query],
    enabled: query !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/finance/reports/ledger', {
          params: { query: query ?? ({} as LedgerQuery) },
          signal,
        }),
      ),
  });
}

export function useLedgerLines(
  query: LedgerQuery | null,
  row: { accountId: number; partyId?: string } | null,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.ledgerLines, query, row],
    enabled: query !== null && row !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/finance/reports/ledger/lines', {
          params: { query: { ...(query ?? ({} as LedgerQuery)), ...(row ?? { accountId: 0 }) } },
          signal,
        }),
      ),
  });
}

export function useStockBalance(query: StockBalanceQuery | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stockBalance, query],
    enabled: query !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/stock-balance', {
          params: { query: query ?? ({} as StockBalanceQuery) },
          signal,
        }),
      ),
  });
}

export function useStockBalanceLines(
  query: StockBalanceQuery | null,
  row: { productId: number; warehouseIds?: number[] } | null,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stockBalanceLines, query?.from, query?.to, query?.warehouseIds, row],
    enabled: query !== null && row !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/stock-balance/lines', {
          params: {
            query: {
              from: query?.from ?? '',
              to: query?.to ?? '',
              productId: row?.productId ?? 0,
              warehouseIds: row?.warehouseIds ?? query?.warehouseIds,
            },
          },
          signal,
        }),
      ),
  });
}

export function useProductSales(query: ProductSalesQuery | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.productSales, query],
    enabled: query !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/product-sales', {
          params: { query: query ?? ({} as ProductSalesQuery) },
          signal,
        }),
      ),
  });
}

export function useProductSalesDocuments(
  query: ProductSalesQuery | null,
  productId: number | null,
  /** The row's group under `query.by`. */
  group: string | null = null,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.productSalesDocuments, query, productId, group],
    enabled: query !== null && productId !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/product-sales/documents', {
          params: {
            query: {
              ...(query ?? ({} as ProductSalesQuery)),
              productId: productId ?? 0,
              ...(group === null ? {} : { group }),
            },
          },
          signal,
        }),
      ),
  });
}

export function useStockDocuments(query: StockDocumentsQuery | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stockDocuments, query],
    enabled: query !== null,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/stock-documents', {
          params: { query: query ?? ({} as StockDocumentsQuery) },
          signal,
        }),
      ),
  });
}

export function useStockDocumentLines(
  doc: { docType: StockDocType; docId: number; warehouseIds?: number[] } | null,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.stockDocumentLines, doc],
    enabled: doc !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/reports/stock-documents/lines', {
          params: { query: doc ?? { docType: 'GR', docId: 0 } },
          signal,
        }),
      ).data,
  });
}

/** The Excel copies of the five reports, downloaded as files. */
export function useBookDownloads() {
  const api = useApiClient();
  return {
    ledger: useMutation({
      mutationFn: async (query: LedgerQuery): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/finance/reports/ledger/xlsx', {
            params: { query },
            parseAs: 'blob',
          }),
        ),
    }),
    stockBalance: useMutation({
      mutationFn: async (query: StockBalanceQuery): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/stock-balance.xlsx', {
            params: { query },
            parseAs: 'blob',
          }),
        ),
    }),
    productSales: useMutation({
      mutationFn: async (query: ProductSalesQuery): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/product-sales.xlsx', {
            params: { query },
            parseAs: 'blob',
          }),
        ),
    }),
    stockDocuments: useMutation({
      mutationFn: async (query: StockDocumentsQuery): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/reports/stock-documents.xlsx', {
            params: { query },
            parseAs: 'blob',
          }),
        ),
    }),
  };
}
