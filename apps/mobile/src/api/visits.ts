import type { components } from '@tugeel/api-client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// The rep's «Айлчлал» (ADR-0183): today's stores from the weekly round, a visit marked with what it
// came to, and money a store handed over reported to the accountant — a report only, the store's
// balance changes when the accountant records it.

export type RepToday = components['schemas']['RepToday'];
export type RepTodayStop = components['schemas']['RepTodayStop'];
export type RepCollection = components['schemas']['RepCollection'];
export type VisitResult = components['schemas']['RepVisitRequest']['result'];
export type CollectionMethod = RepCollection['method'];

const TODAY = ['visits', 'today'] as const;
const COLLECTIONS = ['visits', 'collections'] as const;

export function useVisitsToday() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: TODAY,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-rep/visits/today')),
  });
}

/** «Айлчилсан»: one visit now (one Idempotency-Key per attempt). */
export function useMarkVisit() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      key: string;
      customerId: number;
      result: VisitResult;
      note: string | null;
    }) =>
      unwrap(
        await session.client.POST('/api/v1/sales-rep/visits', {
          params: { header: { 'Idempotency-Key': input.key } },
          body: { customerId: input.customerId, result: input.result, note: input.note },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(TODAY, data),
  });
}

export function useMyCollections() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: COLLECTIONS,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-rep/collections')),
  });
}

/** Money a store handed over, told to the accountant. */
export function useReportCollection() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      key: string;
      customerId: number;
      amount: string;
      method: CollectionMethod;
      note: string | null;
    }) =>
      unwrap(
        await session.client.POST('/api/v1/sales-rep/collections', {
          params: { header: { 'Idempotency-Key': input.key } },
          body: {
            customerId: input.customerId,
            amount: input.amount,
            method: input.method,
            note: input.note,
          },
        }),
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: COLLECTIONS }),
  });
}
