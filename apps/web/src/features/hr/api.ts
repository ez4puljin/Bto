import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

/*
 * The attendance module's reads and writes (ADR-0131): work sites, the company schedule, the
 * employees' own settings, the dashboard, the day log and the events behind a day. Every key sits
 * under ['hr', …]; a write invalidates what it changes.
 */

type Schemas = components['schemas'];
export type WorkSite = Schemas['WorkSite'];
export type WorkSiteRequest = Schemas['WorkSiteRequest'];
export type HrSchedule = Schemas['HrSchedule'];
export type HrScheduleRequest = Schemas['HrScheduleRequest'];
export type HrEmployee = Schemas['HrEmployee'];
export type HrEmployeeRequest = Schemas['HrEmployeeRequest'];
export type AttendanceDashboard = Schemas['AttendanceDashboard'];
export type AttendanceDashboardRow = Schemas['AttendanceDashboardRow'];
export type AttendanceMonthRow = Schemas['AttendanceMonthRow'];
export type AttendanceTrendPoint = Schemas['AttendanceTrendPoint'];
export type AttendanceDay = Schemas['AttendanceDay'];
export type AttendanceEvent = Schemas['AttendanceEvent'];
export type AttendanceEventRequest = Schemas['AttendanceEventRequest'];
export type DayStatus = AttendanceDay['status'];

export const HR_KEYS = {
  all: ['hr'] as const,
  sites: ['hr', 'sites'] as const,
  schedule: ['hr', 'schedule'] as const,
  employees: ['hr', 'employees'] as const,
  dashboard: ['hr', 'dashboard'] as const,
  days: ['hr', 'days'] as const,
  events: ['hr', 'events'] as const,
};

/** The day's board, refreshed every minute while the page is open. */
export function useAttendanceDashboard(date: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...HR_KEYS.dashboard, date],
    enabled: date !== null,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/attendance/dashboard', {
          params: { query: { date: date ?? undefined } },
          signal,
        }),
      ),
  });
}

/** The day log of a period (at most 62 days), newest first, optionally one person's. */
export function useAttendanceDays(from: string, to: string, userId?: number, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...HR_KEYS.days, from, to, userId ?? null],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/attendance/days', {
          params: { query: { from, to, userId } },
          signal,
        }),
      ).data,
  });
}

/** One person's events of one day, struck-out ones included. */
export function useAttendanceEvents(userId: number | null, date: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...HR_KEYS.events, userId, date],
    enabled: userId !== null && date !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/attendance/events', {
          params: { query: { userId: userId ?? 0, date: date ?? '' } },
          signal,
        }),
      ).data,
  });
}

export function useWorkSites(includeArchived = false) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...HR_KEYS.sites, includeArchived],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/work-sites', {
          params: { query: { includeArchived: includeArchived ? 'true' : 'false' } },
          signal,
        }),
      ),
  });
}

export function useHrSchedule() {
  const api = useApiClient();
  return useQuery({
    queryKey: HR_KEYS.schedule,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/hr/schedule', { signal })),
  });
}

export function useHrEmployees() {
  const api = useApiClient();
  return useQuery({
    queryKey: HR_KEYS.employees,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/hr/employees', { signal })),
  });
}

/** The setup page's writes; each refreshes the lists it changed. */
export function useHrMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refreshSites = () => {
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.sites });
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.employees });
  };
  const refreshAttendance = () => {
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.dashboard });
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.days });
  };
  return {
    createSite: useMutation({
      mutationFn: async (body: WorkSiteRequest) =>
        unwrap(await api.POST('/api/v1/hr/work-sites', { body })),
      onSuccess: refreshSites,
    }),
    updateSite: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: WorkSiteRequest }) =>
        unwrap(await api.PUT('/api/v1/hr/work-sites/{id}', { params: { path: { id } }, body })),
      onSuccess: refreshSites,
    }),
    archiveSite: useMutation({
      mutationFn: async ({ id, archived }: { id: number; archived: boolean }) =>
        unwrap(
          await api.PUT('/api/v1/hr/work-sites/{id}/archived', {
            params: { path: { id } },
            body: { archived },
          }),
        ),
      onSuccess: refreshSites,
    }),
    saveSchedule: useMutation({
      mutationFn: async (body: HrScheduleRequest) =>
        unwrap(await api.PUT('/api/v1/hr/schedule', { body })),
      onSuccess: (saved) => {
        queryClient.setQueryData(HR_KEYS.schedule, saved);
        void queryClient.invalidateQueries({ queryKey: HR_KEYS.employees });
        refreshAttendance();
      },
    }),
    saveEmployee: useMutation({
      mutationFn: async ({ userId, body }: { userId: number; body: HrEmployeeRequest }) =>
        unwrap(
          await api.PUT('/api/v1/hr/employees/{userId}', { params: { path: { userId } }, body }),
        ),
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: HR_KEYS.employees });
        refreshAttendance();
      },
    }),
  };
}

/** The corrections HR types into a day: an OFFICE event added, an event struck out. */
export function useAttendanceCorrections() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.events });
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.days });
    void queryClient.invalidateQueries({ queryKey: HR_KEYS.dashboard });
  };
  return {
    addEvent: useMutation({
      mutationFn: async (body: AttendanceEventRequest) =>
        unwrap(await api.POST('/api/v1/hr/attendance/events', { body })),
      onSuccess: refresh,
    }),
    strikeEvent: useMutation({
      mutationFn: async ({ id, reason }: { id: number; reason: string }) =>
        unwrap(
          await api.DELETE('/api/v1/hr/attendance/events/{id}', {
            params: { path: { id } },
            body: { reason },
          }),
        ),
      onSuccess: refresh,
    }),
  };
}
