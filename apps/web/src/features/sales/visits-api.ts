import { type components } from '@tugeel/api-client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

export type RepPlanDay = components['schemas']['RepPlanDay'];
export type RepVisit = components['schemas']['RepVisit'];
export type RepVisitSummaryRow = components['schemas']['RepVisitSummaryRow'];

const VISITS = ['sales', 'rep-visits'] as const;

export interface VisitFilter {
  userId?: number | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/** The staff who hold the rep right: whose round and visits the office reads. */
export function useReps() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...VISITS, 'reps'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/rep-visits/reps', { signal })),
  });
}

export function useRepPlan(userId: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...VISITS, 'plan', userId],
    enabled: userId !== undefined,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/rep-visits/plans/{userId}', {
          params: { path: { userId: userId ?? 0 } },
          signal,
        }),
      ),
  });
}

/** Replaces one weekday of a rep's round. */
export function useSetRepPlanDay() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { userId: number; weekday: number; customerIds: number[] }) =>
      unwrap(
        await api.PUT('/api/v1/rep-visits/plans/{userId}/{weekday}', {
          params: { path: { userId: input.userId, weekday: input.weekday } },
          body: { customerIds: input.customerIds },
        }),
      ),
    onSuccess: (plan, input) => queryClient.setQueryData([...VISITS, 'plan', input.userId], plan),
  });
}

export function useRepVisits(filter: VisitFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...VISITS, 'log', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/rep-visits', {
          params: {
            query: {
              userId: filter.userId,
              from: filter.from,
              to: filter.to,
              cursor: pageParam,
              limit: 50,
            },
          },
          signal,
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useRepVisitSummary(filter: VisitFilter) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...VISITS, 'summary', filter],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/rep-visits/summary', {
          params: { query: { userId: filter.userId, from: filter.from, to: filter.to } },
          signal,
        }),
      ),
  });
}
