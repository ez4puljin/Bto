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

// «Цагийн хүсэлт» (ADR-0144): the person's own time requests — leave, trips, overtime, a missed
// punch — the types HR keeps, the send and the take-back. Every write refreshes `['attendance']`.

export type TimeRequest = components['schemas']['HrTimeRequest'];
export type RequestType = components['schemas']['HrRequestType'];
export type TimeRequestCreate = components['schemas']['HrTimeRequestCreate'];

export function useRequestTypes() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['attendance', 'request-types'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/request-types')),
    staleTime: 5 * 60_000,
  });
}

export function useMyRequests() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['attendance', 'requests'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/hr/requests/mine')),
    staleTime: 15_000,
    refetchOnMount: true,
  });
}

/** Sends a request; the key is kept by the form so a retried send is answered once. */
export function useSendRequest() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, body }: { key: string; body: TimeRequestCreate }) =>
      unwrap(
        await session.client.POST('/api/v1/hr/requests', {
          body,
          params: { header: { 'Idempotency-Key': key } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['attendance'] }),
  });
}

/** Takes back a pending request. */
export function useCancelRequest() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) =>
      unwrap(
        await session.client.POST('/api/v1/hr/requests/{id}/cancel', {
          params: { path: { id } },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['attendance'] }),
  });
}
