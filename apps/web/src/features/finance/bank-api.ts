import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import type { BankExportFile } from '@tugeel/shared/finance';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { uploadFile } from '@/lib/upload';
import { randomUuid } from '@/lib/uuid';

type Schemas = components['schemas'];
export type BankStatement = Schemas['BankStatement'];
export type BankStatementDetail = Schemas['BankStatementDetail'];
export type BankLine = Schemas['BankStatementLine'];
export type BankLinePatch = Schemas['BankLinePatch'];
export type BankRules = Schemas['BankStatementRules'];
export type BankPostResult = Schemas['BankStatementPostResult'];
export type BankUpload = Schemas['BankStatementUpload'];

const ROOT = ['bank-statements'] as const;

/** «Тооцоо хаах» (ADR-0169): how many statements each day of a month holds. */
export function useBankCalendar(month: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'calendar', month],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/finance/bank-statements/calendar', {
          params: { query: { month } },
          signal,
        }),
      ),
  });
}

export function useBankDay(date: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'day', date],
    enabled: date !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/finance/bank-statements', {
          params: { query: { date: date ?? '' } },
          signal,
        }),
      ),
  });
}

export function useBankStatement(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'statement', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/finance/bank-statements/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useBankRules() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ROOT, 'rules'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/finance/bank-statements/rules', { signal })),
  });
}

export function useBankMutations() {
  const api = useApiClient();
  const client = useQueryClient();
  const changed = () => client.invalidateQueries({ queryKey: ROOT });
  return {
    /** Sends the file, then has its lines read; the bank's own file name holds the account. */
    upload: useMutation({
      mutationFn: async (file: File): Promise<BankUpload> => {
        const fileId = await uploadFile(
          api,
          'finance.bank_statement',
          new Blob([file], { type: XLSX_CONTENT_TYPE }),
        );
        return unwrap(
          await api.POST('/api/v1/finance/bank-statements', {
            params: { header: idempotencyKey(randomUuid()) },
            body: { fileId, fileName: file.name },
          }),
        );
      },
      onSuccess: changed,
    }),
    remove: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.DELETE('/api/v1/finance/bank-statements/{id}', {
            params: { path: { id } },
          }),
        ),
      onSuccess: changed,
    }),
    link: useMutation({
      mutationFn: async (input: { id: number; moneyAccountId: number }) =>
        unwrap(
          await api.PUT('/api/v1/finance/bank-statements/{id}/money-account', {
            params: { path: { id: input.id } },
            body: { moneyAccountId: input.moneyAccountId },
          }),
        ),
      onSuccess: changed,
    }),
    swap: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/finance/bank-statements/{id}/swap', {
            params: { path: { id } },
          }),
        ),
      onSuccess: changed,
    }),
    updateLine: useMutation({
      mutationFn: async (input: { id: number; lineId: number; patch: BankLinePatch }) =>
        unwrap(
          await api.PATCH('/api/v1/finance/bank-statements/{id}/lines/{lineId}', {
            params: { path: { id: input.id, lineId: input.lineId } },
            body: input.patch,
          }),
        ),
      onSuccess: changed,
    }),
    bulk: useMutation({
      mutationFn: async (input: {
        id: number;
        lineIds: number[];
        patch: BankLinePatch;
        descriptionFromBank?: boolean;
      }) =>
        unwrap(
          await api.POST('/api/v1/finance/bank-statements/{id}/lines/bulk', {
            params: { path: { id: input.id } },
            body: {
              lineIds: input.lineIds,
              ...input.patch,
              ...(input.descriptionFromBank ? { descriptionFromBank: true } : {}),
            },
          }),
        ),
      onSuccess: changed,
    }),
    post: useMutation({
      mutationFn: async (id: number): Promise<BankPostResult> =>
        unwrap(
          await api.POST('/api/v1/finance/bank-statements/{id}/post', {
            params: { path: { id }, header: idempotencyKey(randomUuid()) },
            body: {},
          }),
        ),
      onSuccess: changed,
    }),
    reverse: useMutation({
      mutationFn: async (input: { id: number; lineId: number; reason: string }) =>
        unwrap(
          await api.POST('/api/v1/finance/bank-statements/{id}/lines/{lineId}/reverse', {
            params: {
              path: { id: input.id, lineId: input.lineId },
              header: idempotencyKey(randomUuid()),
            },
            body: { reason: input.reason },
          }),
        ),
      onSuccess: changed,
    }),
    saveRules: useMutation({
      mutationFn: async (rules: BankRules) =>
        unwrap(await api.PUT('/api/v1/finance/bank-statements/rules', { body: rules })),
      onSuccess: changed,
    }),
    manifest: useMutation({
      mutationFn: async (date: string) =>
        unwrap(
          await api.GET('/api/v1/finance/bank-statements/export-manifest', {
            params: { query: { date } },
          }),
        ),
    }),
    exportStatement: useMutation({
      mutationFn: async (input: { id: number; file: BankExportFile }): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/finance/bank-statements/{id}/export.xlsx', {
            params: { path: { id: input.id }, query: { file: input.file } },
            parseAs: 'blob',
          }),
        ),
    }),
    exportDate: useMutation({
      mutationFn: async (input: { date: string; file: BankExportFile }): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/finance/bank-statements/export-by-date.xlsx', {
            params: { query: input },
            parseAs: 'blob',
          }),
        ),
    }),
    exportFees: useMutation({
      mutationFn: async (range: { from: string; to: string }): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/finance/bank-statements/export-fees.xlsx', {
            params: { query: range },
            parseAs: 'blob',
          }),
        ),
    }),
  };
}
