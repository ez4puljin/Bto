import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import type { ImportKind } from '@tugeel/shared/imports';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';

type Schemas = components['schemas'];
export type ImportJob = Schemas['ImportJob'];
export type ImportRow = Schemas['ImportRow'];
export type ImportStatus = ImportJob['status'];
export type RowFilter = 'ERRORS' | 'WARNINGS' | 'ALL';
export type ReceiptImportOptions = Schemas['ReceiptImportOptions'];
export type IssueImportOptions = Schemas['IssueImportOptions'];
export type ReceiptPaymentAccount = Schemas['ReceiptPaymentAccount'];

const KEYS = { imports: ['imports'] as const };

/** Statuses the worker is still working on: the page polls until they change. */
export const RUNNING: readonly ImportStatus[] = [
  'UPLOADED',
  'VALIDATING',
  'COMMITTING',
  'REVERTING',
];

export function useImports() {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.imports, 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/imports', {
          params: { query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useImport(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.imports, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/imports/{id}', { params: { path: { id } }, signal })),
    refetchInterval: (query) =>
      query.state.data && RUNNING.includes(query.state.data.status) ? 1_500 : false,
  });
}

export function useImportRows(id: number, filter: RowFilter, version: string | undefined) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.imports, id, 'rows', filter, version],
    enabled: version !== undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/imports/{id}/rows', {
          params: { path: { id }, query: { filter, cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useImportMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => queryClient.invalidateQueries({ queryKey: KEYS.imports });

  return {
    /** Uploads the sheet (typed as .xlsx whatever the browser says) and creates the job. */
    create: useMutation({
      mutationFn: async ({
        kind,
        file,
        key,
        receiptOptions,
        issueOptions,
      }: {
        kind: ImportKind;
        file: File;
        key: string;
        /** A receipts import's warehouse and payment (ADR-0078). */
        receiptOptions?: ReceiptImportOptions;
        /** An issues import's warehouse (ADR-0081). */
        issueOptions?: IssueImportOptions;
      }) => {
        const fileId = await uploadFile(
          api,
          'imports.source',
          new Blob([file], { type: XLSX_CONTENT_TYPE }),
        );
        return unwrap(
          await api.POST('/api/v1/imports', {
            params: { header: idempotencyKey(key) },
            body: {
              kind,
              fileId,
              fileName: file.name,
              ...(receiptOptions ? { receiptOptions } : {}),
              ...(issueOptions ? { issueOptions } : {}),
            },
          }),
        );
      },
      onSuccess: changed,
    }),
    commit: useMutation({
      mutationFn: async ({ id, key }: { id: number; key: string }) =>
        unwrap(
          await api.POST('/api/v1/imports/{id}/commit', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: changed,
    }),
    revert: useMutation({
      mutationFn: async ({ id, key }: { id: number; key: string }) =>
        unwrap(
          await api.POST('/api/v1/imports/{id}/revert', {
            params: { path: { id }, header: idempotencyKey(key) },
          }),
        ),
      onSuccess: changed,
    }),
    /** The template of a kind as a file the browser saves. */
    template: useMutation({
      mutationFn: async (kind: ImportKind): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/imports/templates/{kind}', {
            params: { path: { kind } },
            parseAs: 'blob',
          }),
        ),
    }),
  };
}

/** The cash boxes and bank accounts a receipts import may name (ADR-0078). */
export function useReceiptPaymentAccounts(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['receipts', 'payment-accounts'] as const,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/receipts/payment-accounts', { signal })),
  });
}
