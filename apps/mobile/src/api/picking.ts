import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignedIn } from '../state/session';
import type { ConfirmLine } from '../picking/sections';
import { unwrap } from './problem';

// The keeper's picking (ADR-0126 #2 on the phone, ADR-0132): the work list, one order with its
// parts and lines (the keeper sees their warehouses' lines only), the shelves proposed per line,
// taking a part and confirming its counts. The open screens re-read every 15 s, so the other
// warehouses' progress shows; every write refreshes `['picking']` and the order.

const POLL_MS = 15_000;

/** `GET /sales-picks`: the parts in the keeper's warehouses, not done or done today. */
export function usePickWork() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['picking', 'work'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/sales-picks')),
    refetchInterval: POLL_MS,
  });
}

export function usePickOrder(id: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['picking', 'order', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-orders/{id}', { params: { path: { id: id ?? 0 } } }),
      ),
    enabled: id !== null,
    refetchInterval: POLL_MS,
  });
}

/** The shelves per line (`GET /sales-orders/:id/pick-info`): the fixed one, else the fullest. */
export function usePickInfo(id: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: ['picking', 'info', id],
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/sales-orders/{id}/pick-info', {
          params: { path: { id: id ?? 0 } },
        }),
      ),
    enabled: id !== null,
  });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['picking'] });
}

/** «Бэлдэж эхлэх»: the part is the keeper's; the order is picking. */
export function useTakePart() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({ orderId, warehouseId }: { orderId: number; warehouseId: number }) =>
      unwrap(
        await session.client.POST('/api/v1/sales-orders/{id}/picks/{warehouseId}/take', {
          params: { path: { id: orderId, warehouseId } },
        }),
      ),
    onSettled: refresh,
  });
}

/**
 * «Батлах»: every line of the part with its count and shelf, once (the Idempotency-Key from the
 * screen, new for each attempt that reached the server).
 */
export function useConfirmPart() {
  const { session } = useSignedIn();
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({
      orderId,
      warehouseId,
      key,
      lines,
    }: {
      orderId: number;
      warehouseId: number;
      key: string;
      lines: ConfirmLine[];
    }) =>
      unwrap(
        await session.client.POST('/api/v1/sales-orders/{id}/picks/{warehouseId}/pick', {
          params: { path: { id: orderId, warehouseId }, header: { 'Idempotency-Key': key } },
          body: { lines },
        }),
      ),
    onSettled: refresh,
  });
}
