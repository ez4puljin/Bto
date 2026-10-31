import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// «Ирц» (ADR-0131): the signed-in person's own attendance — today, a month's days, and the punch.
// Every write refreshes `['attendance']`.

export type MyAttendance = components['schemas']['MyAttendance'];
export type AttendanceDay = components['schemas']['AttendanceDay'];
export type AttendanceEvent = components['schemas']['AttendanceEvent'];
export type AttendanceSite = components['schemas']['AttendanceSite'];
export type AttendancePunchRequest = components['schemas']['AttendancePunchRequest'];

/** Today's state, events and figures, the schedule and the person's work sites. */
export function useMyAttendance() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['attendance', 'me'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/attendance/me')),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

/** One month's days (`YYYY-MM`), newest first. */
export function useMyDays(month: string) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['attendance', 'days', month],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/hr/attendance/me/days', {
          params: { query: { month } },
        }),
      ),
    staleTime: 15_000,
  });
}

/** «Ирсэн» or «явсан» from inside a work site: the server checks the radius and the fix. */
export function usePunch() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: AttendancePunchRequest) =>
      unwrap(await session.client.POST('/api/v1/hr/attendance/punch', { body })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['attendance'] }),
  });
}
