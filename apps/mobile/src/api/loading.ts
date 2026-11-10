import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// The driver's «Ачилт» (ADR-0179): the picked orders waiting for a truck and the caller's own
// loadings of today; «Ачсан» for the ticked stores' orders; a loading taken back the same day.
// The list re-reads every 30 s, so orders packed meanwhile show up.

const POLL_MS = 30_000;

export function useLoadingWork() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['loading', 'work'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-loading')),
    refetchInterval: POLL_MS,
  });
}

/** «Ачсан»: the orders onto the caller's truck now (one Idempotency-Key per attempt). */
export function useLoadOrders() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, orderIds }: { key: string; orderIds: number[] }) =>
      unwrap(
        await session.client.POST('/api/v1/sales-loading', {
          params: { header: { 'Idempotency-Key': key } },
          body: { orderIds },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(['loading', 'work'], data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['loading'] }),
  });
}

/** A wrong tick taken back: the order waits again. */
export function useUndoLoad() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (orderId: number) =>
      unwrap(
        await session.client.POST('/api/v1/sales-loading/{orderId}/undo', {
          params: { path: { orderId } },
        }),
      ),
    onSuccess: (data) => queryClient.setQueryData(['loading', 'work'], data),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['loading'] }),
  });
}
