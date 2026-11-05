import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { HR_KEYS } from './api';

/*
 * HR beyond the punch (ADR-0144): divisions, the employees' cards, the schedules, the request
 * types, the requests and the time report. Keys under ['hr', …]; a write refreshes the HR reads.
 */

type Schemas = components['schemas'];
export type HrDivision = Schemas['HrDivision'];
export type HrStaff = Schemas['HrStaff'];
export type HrStaffRequest = Schemas['HrStaffRequest'];
export type HrWorkSchedule = Schemas['HrWorkSchedule'];
export type HrWorkScheduleRequest = Schemas['HrWorkScheduleRequest'];
export type HrScheduleDay = Schemas['HrScheduleDay'];
export type HrRequestType = Schemas['HrRequestType'];
export type HrRequestTypeRequest = Schemas['HrRequestTypeRequest'];
export type HrTimeRequest = Schemas['HrTimeRequest'];
export type HrTimeRequestCreate = Schemas['HrTimeRequestCreate'];
export type HrReport = Schemas['HrReport'];
export type HrReportRow = Schemas['HrReportRow'];

export const WORKFORCE_KEYS = {
  divisions: ['hr', 'divisions'] as const,
  staff: ['hr', 'staff'] as const,
  schedules: ['hr', 'schedules'] as const,
  requestTypes: ['hr', 'request-types'] as const,
  requests: ['hr', 'requests'] as const,
  pending: ['hr', 'requests', 'pending'] as const,
  report: ['hr', 'report'] as const,
};

export function useDivisions(includeArchived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...WORKFORCE_KEYS.divisions, includeArchived],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/divisions', { params: { query: { includeArchived } }, signal }),
      ),
  });
}

export function useStaff() {
  const api = useApiClient();
  return useQuery({
    queryKey: WORKFORCE_KEYS.staff,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/hr/staff', { signal })),
  });
}

export function useWorkSchedules() {
  const api = useApiClient();
  return useQuery({
    queryKey: WORKFORCE_KEYS.schedules,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/hr/schedules', { signal })),
  });
}

export function useRequestTypes() {
  const api = useApiClient();
  return useQuery({
    queryKey: WORKFORCE_KEYS.requestTypes,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/hr/request-types', { signal })),
  });
}

export interface RequestFilter {
  status?: HrTimeRequest['status'];
  userId?: number;
  typeId?: number;
  from?: string;
  to?: string;
}

export function useTimeRequests(filter: RequestFilter) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...WORKFORCE_KEYS.requests, filter],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/requests', { params: { query: filter }, signal })),
  });
}

/** The pending requests for the badges and the employees page's cards (refreshed each minute). */
export function usePendingRequests(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...WORKFORCE_KEYS.requests, { status: 'PENDING' }],
    enabled,
    refetchInterval: 60_000,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/requests', {
          params: { query: { status: 'PENDING' } },
          signal,
        }),
      ),
  });
}

export function useHrReport(query: HrReportQuery, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...WORKFORCE_KEYS.report, query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/reports/days', { params: { query }, signal })),
  });
}

export type HrReportQuery = { from: string; to: string; userId?: number; divisionId?: number };

/** The report's day rows and the employees' list as Excel. */
export function useHrDownloads() {
  const api = useApiClient();
  return {
    report: useMutation({
      mutationFn: async (query: HrReportQuery): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/hr/reports/days.xlsx', { params: { query }, parseAs: 'blob' }),
        ),
    }),
    staff: useMutation({
      mutationFn: async (): Promise<Blob> =>
        unwrap(await api.GET('/api/v1/hr/staff.xlsx', { parseAs: 'blob' })),
    }),
  };
}

export function useWorkforceMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: HR_KEYS.all });
  const path = (id: number) => ({ params: { path: { id } } });
  const user = (userId: number) => ({ params: { path: { userId } } });
  return {
    saveDivision: useMutation({
      mutationFn: async ({ id, ...body }: { id: number | null; name: string; sort: number }) =>
        id === null
          ? unwrap(await api.POST('/api/v1/hr/divisions', { body }))
          : unwrap(await api.PUT('/api/v1/hr/divisions/{id}', { ...path(id), body })),
      onSuccess: refresh,
    }),
    archiveDivision: useMutation({
      mutationFn: async ({ id, archived }: { id: number; archived: boolean }) =>
        unwrap(
          await api.PUT('/api/v1/hr/divisions/{id}/archived', { ...path(id), body: { archived } }),
        ),
      onSuccess: refresh,
    }),
    createStaff: useMutation({
      mutationFn: async ({ key, ...body }: HrStaffRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/hr/staff', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: refresh,
    }),
    updateStaff: useMutation({
      mutationFn: async ({ userId, ...body }: HrStaffRequest & { userId: number }) =>
        unwrap(await api.PUT('/api/v1/hr/staff/{userId}', { ...user(userId), body })),
      onSuccess: refresh,
    }),
    setLeft: useMutation({
      mutationFn: async ({
        userId,
        ...body
      }: {
        userId: number;
        leftOn: string | null;
        reason: string | null;
        reasonKind?: Schemas['HrLeftReasonKind'] | null;
      }) => unwrap(await api.PUT('/api/v1/hr/staff/{userId}/left', { ...user(userId), body })),
      onSuccess: refresh,
    }),
    resetPassword: useMutation({
      mutationFn: async ({ userId, password }: { userId: number; password: string }) =>
        unwrap(
          await api.PUT('/api/v1/hr/staff/{userId}/password', {
            ...user(userId),
            body: { password },
          }),
        ),
      onSuccess: refresh,
    }),
    setPhoto: useMutation({
      mutationFn: async ({ userId, fileId }: { userId: number; fileId: number | null }) =>
        unwrap(
          await api.PUT('/api/v1/hr/staff/{userId}/photo', { ...user(userId), body: { fileId } }),
        ),
      onSuccess: refresh,
    }),
    saveSchedule: useMutation({
      mutationFn: async ({ id, ...body }: HrWorkScheduleRequest & { id: number | null }) =>
        id === null
          ? unwrap(await api.POST('/api/v1/hr/schedules', { body }))
          : unwrap(await api.PUT('/api/v1/hr/schedules/{id}', { ...path(id), body })),
      onSuccess: refresh,
    }),
    archiveSchedule: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/hr/schedules/{id}', path(id))),
      onSuccess: refresh,
    }),
    saveRequestType: useMutation({
      mutationFn: async ({ id, ...body }: HrRequestTypeRequest & { id: number | null }) =>
        id === null
          ? unwrap(await api.POST('/api/v1/hr/request-types', { body }))
          : unwrap(await api.PUT('/api/v1/hr/request-types/{id}', { ...path(id), body })),
      onSuccess: refresh,
    }),
    createRequest: useMutation({
      mutationFn: async ({ key, ...body }: HrTimeRequestCreate & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/hr/requests', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: refresh,
    }),
    decide: useMutation({
      mutationFn: async ({
        id,
        approve,
        note,
      }: {
        id: number;
        approve: boolean;
        note: string | null;
      }) =>
        unwrap(
          await api.POST('/api/v1/hr/requests/{id}/decision', {
            ...path(id),
            body: { approve, note },
          }),
        ),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/hr/requests/{id}/cancel', path(id))),
      onSuccess: refresh,
    }),
  };
}
