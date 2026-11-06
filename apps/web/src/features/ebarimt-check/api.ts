import { type components, idempotencyKey } from '@tugeel/api-client';
import { periodYear } from '@tugeel/shared/ebarimt-check';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { Decimal } from '@tugeel/shared/money';
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';

type EbarimtReport = components['schemas']['EbarimtReportDto'];
export type EbarimtRow = components['schemas']['EbarimtReportRowDto'];
export type EbarimtHistoryEvent = components['schemas']['EbarimtHistoryEventDto'];
export type EbarimtUnregistered = components['schemas']['EbarimtUnregisteredRowDto'];
export type EbarimtLink = components['schemas']['EbarimtLinkViewDto'];
export type EbarimtEntry = components['schemas']['EbarimtEntryViewDto'];
export type EbarimtMonth = components['schemas']['EbarimtMonthDto'];

const KEYS = {
  all: ['ebarimt-check'] as const,
  reports: ['ebarimt-check', 'report'] as const,
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

/**
 * The report of these months. A month's rows never stand in for another's, since a cell under the
 * wrong month could be typed into, nor a year's for another's; months of a year chosen one by one
 * keep the last choice's rows until the next arrive, because nothing there is typed month by month.
 */
export function useEbarimtReport(periods: readonly number[], year: number) {
  const api = useApiClient();
  return useQuery<EbarimtReport>({
    queryKey: KEYS.report(periods),
    enabled: periods.length > 0,
    // Rows move only on a save or when asked: a colleague's change is offered by the version's poll.
    refetchOnWindowFocus: false,
    placeholderData: (previous) =>
      periods.length > 1 &&
      previous &&
      previous.periods.length > 1 &&
      periodYear(previous.periods[previous.periods.length - 1] as number) === year
        ? previous
        : undefined,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/report', {
          params: { query: { periods: periods.join(',') } },
          signal,
        }),
      ),
  });
}

/** A colleague's change under an open page: a light stamp polled, rows never moved by it. */
export function useEbarimtVersion(periods: readonly number[]) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['ebarimt-check', 'version', periods.join(',')],
    enabled: periods.length > 0,
    staleTime: 0,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/version', {
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

/** Last December and the year's months: another year's never stand in for them. */
export function useEbarimtFiles(year: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.files(year),
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ebarimt-check/files', {
          params: { query: { year } },
          signal,
        }),
      ),
  });
}

export function useEbarimtSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/ebarimt-check/settings', { signal })),
  });
}

/** Everything the page shows, read again; a query that is switched off sends nothing. */
export function useEbarimtRefresh() {
  const queryClient = useQueryClient();
  return useCallback(
    () => void queryClient.invalidateQueries({ queryKey: KEYS.all }),
    [queryClient],
  );
}

type Reports = [readonly unknown[], EbarimtReport | undefined][];

/** Writes a supplier's row into every report held, so a saved cell shows at once. */
function patchRow(
  client: QueryClient,
  supplierId: number,
  patch: (row: EbarimtRow) => EbarimtRow,
): Reports {
  const held = client.getQueriesData<EbarimtReport>({ queryKey: KEYS.reports });
  for (const [key, report] of held) {
    if (!report) continue;
    client.setQueryData<EbarimtReport>(key, {
      ...report,
      rows: report.rows.map((row) => (row.supplierId === supplierId ? patch(row) : row)),
    });
  }
  return held;
}

function restore(client: QueryClient, held: Reports | undefined) {
  for (const [key, report] of held ?? []) client.setQueryData(key, report);
}

/** A month's exempt amount or note in a row of that month, the difference following. */
function withMonthValue(
  row: EbarimtRow,
  value: { period: number; exemptAmount?: string; note?: string | null },
): EbarimtRow {
  if (!row.byPeriod.some((month) => month.period === value.period)) return row;
  const byPeriod = row.byPeriod.map((month) =>
    month.period !== value.period
      ? month
      : {
          ...month,
          ...(value.exemptAmount === undefined
            ? {}
            : { exemptAmount: new Decimal(value.exemptAmount).toFixed(2) }),
          ...(value.note === undefined ? {} : { note: value.note }),
        },
  );
  const exempt = byPeriod.reduce((sum, month) => sum.plus(month.exemptAmount), new Decimal(0));
  return {
    ...row,
    byPeriod,
    exemptAmount: exempt.toFixed(2),
    diffAmount: new Decimal(row.purchaseAmount).minus(row.ebarimtAmount).minus(exempt).toFixed(2),
  };
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
      mutationFn: async ({ period, fileId }: { period: number; fileId: number }) =>
        unwrap(
          await api.DELETE('/api/v1/ebarimt-check/files/{period}', {
            params: { path: { period }, query: { fileId } },
          }),
        ),
      onSettled: changed,
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
        previousExemptAmount?: string;
        note?: string | null;
        previousNote?: string | null;
      }) => unwrap(await api.PUT('/api/v1/ebarimt-check/month-values', { body })),
      onMutate: async (body) => {
        await queryClient.cancelQueries({ queryKey: KEYS.reports });
        return { held: patchRow(queryClient, body.supplierId, (row) => withMonthValue(row, body)) };
      },
      onError: (_error, _body, context) => restore(queryClient, context?.held),
      onSettled: changed,
    }),
    saveProfile: useMutation({
      mutationFn: async ({
        supplierId,
        ...body
      }: {
        supplierId: number;
        registers?: string | null;
        previousRegisters?: string;
        phone?: string | null;
        previousPhone?: string;
        remark?: string | null;
        previousRemark?: string;
      }) =>
        unwrap(
          await api.PUT('/api/v1/ebarimt-check/suppliers/{id}/profile', {
            params: { path: { id: supplierId } },
            body,
          }),
        ),
      onMutate: async ({ supplierId, registers, phone, remark }) => {
        await queryClient.cancelQueries({ queryKey: KEYS.reports });
        return {
          held: patchRow(queryClient, supplierId, (row) => ({
            ...row,
            ...(registers === undefined
              ? {}
              : { registers: registers ?? row.registersDefault ?? row.registers }),
            ...(phone === undefined ? {} : { phone: phone ?? row.phoneDefault ?? row.phone }),
            ...(remark === undefined ? {} : { remark: remark ?? '' }),
          })),
        };
      },
      onError: (_error, _body, context) => restore(queryClient, context?.held),
      onSettled: changed,
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
        previousSupplierId?: number;
      }) => unwrap(await api.PUT('/api/v1/ebarimt-check/receipt-links', { body })),
      onSuccess: changed,
    }),
  };
}
