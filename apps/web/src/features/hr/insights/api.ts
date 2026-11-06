import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

/*
 * The HR dashboard's reads (ADR-0146 #5). A new range keeps the old figures until the new ones
 * arrive, so the charts move from one to the other instead of blanking.
 */

type Schemas = components['schemas'];
export type HrCount = Schemas['HrCount'];
export type HrGenderCount = Schemas['HrGenderCount'];
export type HrMatrixRow = Schemas['HrMatrixRow'];
export type HrMovementMonth = Schemas['HrMovementMonth'];
export type HrMissingDetails = Schemas['HrMissingDetails'];
export type HrWorkforceInsights = Schemas['HrWorkforceInsights'];
export type HrAttendanceInsights = Schemas['HrAttendanceInsights'];
export type HrAttendanceEmployee = Schemas['HrAttendanceEmployee'];
export type HrRequestInsights = Schemas['HrRequestInsights'];
export type HrCalendarItem = Schemas['HrCalendarItem'];

const INSIGHTS = ['hr', 'insights'] as const;

export function useWorkforceInsights(from: string, to: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...INSIGHTS, 'workforce', from, to],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/insights/workforce', {
          params: { query: { from, to } },
          signal,
        }),
      ),
  });
}

export function useAttendanceInsights(from: string, to: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...INSIGHTS, 'attendance', from, to],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/insights/attendance', {
          params: { query: { from, to } },
          signal,
        }),
      ),
  });
}

export function useRequestInsights(year: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...INSIGHTS, 'requests', year],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/hr/insights/requests', {
          params: { query: { year } },
          signal,
        }),
      ),
  });
}

/** One month's birthdays and work anniversaries come from the HR calendar. */
export function useInsightsCalendar(month: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...INSIGHTS, 'calendar', month],
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/hr/calendar', { params: { query: { month } }, signal })),
  });
}
