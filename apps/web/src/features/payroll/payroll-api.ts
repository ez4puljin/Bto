import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

/*
 * Payroll with KPI (ADR-0235): the rates, the KPI templates, each employee's pay terms, advances,
 * the monthly runs and the scoring. Keys sit under ['payroll', …]; every write refreshes them all.
 */

type Schemas = components['schemas'];
export type PayrollSettings = Schemas['PayrollSettings'];
export type PayrollKpiItem = Schemas['PayrollKpiItem'];
export type PayrollKpiItemRequest = Schemas['PayrollKpiItemRequest'];
export type PayrollTemplate = Schemas['PayrollKpiTemplate'];
export type PayrollTerms = Schemas['PayrollTerms'];
export type PayrollTermsRequest = Schemas['PayrollTermsRequest'];
export type PayrollAdvance = Schemas['PayrollAdvance'];
export type PayrollRun = Schemas['PayrollRun'];
export type PayrollRunDetail = Schemas['PayrollRunDetail'];
export type PayrollLine = Schemas['PayrollLine'];
export type PayrollScoring = Schemas['PayrollScoring'];
export type PayrollScoringRun = Schemas['PayrollScoringRun'];
export type PayrollAdjustmentRequest = Schemas['PayrollAdjustmentRequest'];

export const PAYROLL_KEYS = {
  all: ['payroll'] as const,
  settings: ['payroll', 'settings'] as const,
  templates: ['payroll', 'templates'] as const,
  terms: ['payroll', 'terms'] as const,
  advances: ['payroll', 'advances'] as const,
  runs: ['payroll', 'runs'] as const,
  scoring: ['payroll', 'scoring'] as const,
};

export function usePayrollSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: PAYROLL_KEYS.settings,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/payroll/settings', { signal })),
  });
}

export function useTemplates(includeArchived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...PAYROLL_KEYS.templates, includeArchived],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/payroll/templates', {
          params: { query: { includeArchived } },
          signal,
        }),
      ),
  });
}

export function useAllTerms() {
  const api = useApiClient();
  return useQuery({
    queryKey: PAYROLL_KEYS.terms,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/payroll/terms', { signal })),
  });
}

export function useAdvances(filter: { month?: string; includeVoided: boolean }) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...PAYROLL_KEYS.advances, filter],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/payroll/advances', { params: { query: filter }, signal })),
  });
}

export function useRuns() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...PAYROLL_KEYS.runs, 'list'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/payroll/runs', { signal })),
  });
}

export function useRun(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...PAYROLL_KEYS.runs, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/payroll/runs/{id}', { params: { path: { id } }, signal })),
  });
}

export function useScoringRuns() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...PAYROLL_KEYS.scoring, 'runs'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/payroll/scoring/runs', { signal })),
  });
}

export function useScoring(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...PAYROLL_KEYS.scoring, id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/payroll/scoring/runs/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

/** The run as Excel. */
export function useRunDownload() {
  const api = useApiClient();
  return useMutation({
    mutationFn: async (id: number): Promise<Blob> =>
      unwrap(
        await api.GET('/api/v1/payroll/runs/{id}/export.xlsx', {
          params: { path: { id } },
          parseAs: 'blob',
        }),
      ),
  });
}

export function usePayrollMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: PAYROLL_KEYS.all });
  const run = (id: number) => ({ params: { path: { id } } });
  return {
    saveSettings: useMutation({
      mutationFn: async (body: PayrollSettings) =>
        unwrap(await api.PUT('/api/v1/payroll/settings', { body })),
      onSuccess: refresh,
    }),
    saveTemplate: useMutation({
      mutationFn: async ({
        id,
        key,
        ...body
      }: {
        id: number | null;
        key: string;
        name: string;
        items: PayrollKpiItemRequest[];
      }) =>
        id === null
          ? unwrap(
              await api.POST('/api/v1/payroll/templates', {
                params: { header: idempotencyKey(key) },
                body,
              }),
            )
          : unwrap(
              await api.PUT('/api/v1/payroll/templates/{id}', {
                params: { path: { id } },
                body,
              }),
            ),
      onSuccess: refresh,
    }),
    archiveTemplate: useMutation({
      mutationFn: async ({ id, archived }: { id: number; archived: boolean }) =>
        unwrap(
          await api.PUT('/api/v1/payroll/templates/{id}/archived', {
            ...run(id),
            body: { archived },
          }),
        ),
      onSuccess: refresh,
    }),
    applyTemplate: useMutation({
      mutationFn: async ({ id, userIds }: { id: number; userIds: number[] }) =>
        unwrap(
          await api.POST('/api/v1/payroll/templates/{id}/apply', {
            ...run(id),
            body: { userIds },
          }),
        ),
      onSuccess: refresh,
    }),
    saveTerms: useMutation({
      mutationFn: async ({ userId, ...body }: PayrollTermsRequest & { userId: number }) =>
        unwrap(
          await api.PUT('/api/v1/payroll/terms/{userId}', {
            params: { path: { userId } },
            body,
          }),
        ),
      onSuccess: refresh,
    }),
    createAdvance: useMutation({
      mutationFn: async ({ key, ...body }: Schemas['PayrollAdvanceRequest'] & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/payroll/advances', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: refresh,
    }),
    voidAdvance: useMutation({
      mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
        unwrap(
          await api.POST('/api/v1/payroll/advances/{id}/void', {
            ...run(id),
            body: { reason },
          }),
        ),
      onSuccess: refresh,
    }),
    createRun: useMutation({
      mutationFn: async ({ key, ...body }: Schemas['PayrollRunCreateRequest'] & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/payroll/runs', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: refresh,
    }),
    recompute: useMutation({
      mutationFn: async ({ id, refreshTerms }: { id: number; refreshTerms: boolean }) =>
        unwrap(
          await api.POST('/api/v1/payroll/runs/{id}/recompute', {
            ...run(id),
            body: { refreshTerms },
          }),
        ),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/payroll/runs/{id}/approve', run(id))),
      onSuccess: refresh,
    }),
    reopen: useMutation({
      mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
        unwrap(
          await api.POST('/api/v1/payroll/runs/{id}/reopen', { ...run(id), body: { reason } }),
        ),
      onSuccess: refresh,
    }),
    addAdjustment: useMutation({
      mutationFn: async ({
        runId,
        lineId,
        key,
        ...body
      }: PayrollAdjustmentRequest & { runId: number; lineId: number; key: string }) =>
        unwrap(
          await api.POST('/api/v1/payroll/runs/{id}/lines/{lineId}/adjustments', {
            params: { path: { id: runId, lineId }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: refresh,
    }),
    removeAdjustment: useMutation({
      mutationFn: async (input: { runId: number; lineId: number; adjustmentId: number }) =>
        unwrap(
          await api.DELETE('/api/v1/payroll/runs/{id}/lines/{lineId}/adjustments/{adjustmentId}', {
            params: {
              path: { id: input.runId, lineId: input.lineId, adjustmentId: input.adjustmentId },
            },
          }),
        ),
      onSuccess: refresh,
    }),
    saveScores: useMutation({
      mutationFn: async ({
        runId,
        scores,
      }: {
        runId: number;
        scores: Schemas['PayrollScoreEntry'][];
      }) =>
        unwrap(
          await api.PUT('/api/v1/payroll/scoring/runs/{id}/scores', {
            params: { path: { id: runId } },
            body: { scores },
          }),
        ),
      onSuccess: refresh,
    }),
  };
}
