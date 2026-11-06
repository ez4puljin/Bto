import { type components, idempotencyKey } from '@tugeel/api-client';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';

export type EbarimtReport = components['schemas']['EbarimtReportDto'];
export type EbarimtRow = components['schemas']['EbarimtReportRowDto'];
export type EbarimtHistoryEvent = components['schemas']['EbarimtHistoryEventDto'];
export type EbarimtUnregistered = components['schemas']['EbarimtUnregisteredRowDto'];
export type EbarimtLink = components['schemas']['EbarimtLinkViewDto'];
export type EbarimtReceipt = components['schemas']['EbarimtReceiptBriefDto'];
export type EbarimtEntry = components['schemas']['EbarimtEntryViewDto'];
export type EbarimtMonth = components['schemas']['EbarimtMonthDto'];
export type EbarimtAccount = components['schemas']['EbarimtAccountOptionDto'];

const KEYS = {
  all: ['ebarimt-check'] as const,
  report: (periods: readonly number[]) => ['ebarimt-check', 'report', periods.join(',')] as const,
  receipts: (periods: readonly number[], supplierId: number) =>
    ['ebarimt-check', 'receipts', periods.join(','), supplierId] as const,
  entries: (periods: readonly number[], target: EntriesTarget) =>
    ['ebarimt-check', 'entries', periods.join(','), target] as const,
  files: (year: number) => ['ebarimt-check', 'files', year] as const,
  settings: ['ebarimt-check', 'settings'] as const,
};

export interface EntriesTarget {
  supplierId?: number;
  ttd?: string;
}

export function useEbarimtReport(periods: readonly number[]) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.report(periods),
    enabled: periods.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/report', {
          params: { query: { periods: periods.join(',') } },
          signal,
        }),
      ),
  });
}

export function useEbarimtReceipts(periods: readonly number[], supplierId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.receipts(periods, supplierId),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/receipts', {
          params: { query: { periods: periods.join(','), supplierId } },
          signal,
        }),
      ),
  });
}

export function useEbarimtEntries(periods: readonly number[], target: EntriesTarget) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.entries(periods, target),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/entries', {
          params: { query: { periods: periods.join(','), ...target } },
          signal,
        }),
      ),
  });
}

export function useEbarimtFiles(year: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.files(year),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/files', {
          params: { query: { year } },
          signal,
        }),
      ),
  });
}

export function useEbarimtSettings(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/ebarimt-check/settings', { signal })),
  });
}

/** Everything the page writes; each change reloads what it can move. */
export function useEbarimtMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const changed = () => void queryClient.invalidateQueries({ queryKey: KEYS.all });
  return {
    importFile: useMutation({
      mutationFn: async ({ file, key }: { file: File; key: string }) => {
        const fileId = await uploadFile(
          api,
          'ebarimt.source',
          new Blob([file], { type: XLSX_CONTENT_TYPE }),
        );
        return unwrap(
          await api.POST('/api/v1/ebarimt-check/files', {
            params: { header: idempotencyKey(key) },
            body: { fileId, fileName: file.name },
          }),
        );
      },
      onSuccess: changed,
    }),
    removeFile: useMutation({
      mutationFn: async (period: number) =>
        unwrap(
          await api.DELETE('/api/v1/ebarimt-check/files/{period}', {
            params: { path: { period } },
          }),
        ),
      onSuccess: changed,
    }),
    download: useMutation({
      mutationFn: async (id: number): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/ebarimt-check/files/{id}/download', {
            params: { path: { id } },
            parseAs: 'blob',
          }),
        ),
    }),
    saveSettings: useMutation({
      mutationFn: async (accountCodes: string[]) =>
        unwrap(await api.PUT('/api/v1/ebarimt-check/settings', { body: { accountCodes } })),
      onSuccess: changed,
    }),
    saveMonthValue: useMutation({
      mutationFn: async (body: {
        period: number;
        supplierId: number;
        exemptAmount?: string;
        note?: string | null;
      }) => unwrap(await api.PUT('/api/v1/ebarimt-check/month-values', { body })),
      onSuccess: changed,
    }),
    saveProfile: useMutation({
      mutationFn: async ({
        supplierId,
        ...body
      }: {
        supplierId: number;
        registers?: string | null;
        phone?: string | null;
        remark?: string | null;
      }) =>
        unwrap(
          await api.PUT('/api/v1/ebarimt-check/suppliers/{id}/profile', {
            params: { path: { id: supplierId } },
            body,
          }),
        ),
      onSuccess: changed,
    }),
    assign: useMutation({
      mutationFn: async (body: { period: number; supplierIds: number[]; userId: number | null }) =>
        unwrap(await api.PUT('/api/v1/ebarimt-check/assignments', { body })),
      onSuccess: changed,
    }),
    link: useMutation({
      mutationFn: async (body: {
        period: number;
        receiptKeys: string[];
        supplierId: number | null;
      }) => unwrap(await api.PUT('/api/v1/ebarimt-check/receipt-links', { body })),
      onSuccess: changed,
    }),
  };
}
