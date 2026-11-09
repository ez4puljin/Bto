import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

// «Тооллого» (ADR-0176 #4): a counter's own side of a count by product. Every number typed is on
// the server at once, in the counter's open session; «Илгээх» adds the session to the count window.

type Schemas = components['schemas'];
export type OpenStockCount = Schemas['OpenStockCount'];
export type MyStockCount = Schemas['MyStockCount'];
export type StockCountEntry = Schemas['StockCountEntry'];
export type StockCountProductInfo = Schemas['StockCountProductInfo'];
export type ProductUnit = Schemas['ProductUnit'];

const COUNTS = ['counts'] as const;

/** The counts being counted in the warehouses this person may see, with their own state in each. */
export function useOpenCounts() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...COUNTS, 'open'],
    queryFn: async () => unwrap(await session.client.GET('/api/v1/stock-counts/open')),
  });
}

/** One count with this person's open session and what they have typed in it, newest first. */
export function useMyCount(id: number) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...COUNTS, id, 'mine'],
    enabled: Number.isInteger(id),
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/stock-counts/{id}/session', {
          params: { path: { id } },
        }),
      ),
  });
}

/** What this count knows of one product: my number so far and, when the count shows it, the stock. */
export function useCountProductInfo(id: number, productId: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...COUNTS, id, 'product', productId],
    enabled: productId !== null,
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/stock-counts/{id}/products/{productId}', {
          params: { path: { id, productId: productId ?? 0 } },
        }),
      ),
  });
}

/** The product's units still in use, the base unit first and then the smaller packs before the larger. */
export function useCountUnits(productId: number | null) {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: [...COUNTS, 'units', productId],
    enabled: productId !== null,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(
        await session.client.GET('/api/v1/products/{id}', {
          params: { path: { id: productId ?? 0 } },
        }),
      ).units.filter((unit) => unit.supersededAt === null),
  });
}

export function useCountMutations(id: number) {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: COUNTS });
  const keep = (mine: MyStockCount) => queryClient.setQueryData([...COUNTS, id, 'mine'], mine);

  return {
    start: useMutation({
      mutationFn: async () =>
        unwrap(
          await session.client.POST('/api/v1/stock-counts/{id}/session', {
            params: { path: { id } },
          }),
        ),
      onSuccess: keep,
      onSettled: refresh,
    }),
    send: useMutation({
      mutationFn: async () =>
        unwrap(
          await session.client.POST('/api/v1/stock-counts/{id}/session/send', {
            params: { path: { id } },
          }),
        ),
      onSuccess: keep,
      onSettled: refresh,
    }),
    /** One typed number; the key is the form's, so a retried save is answered once. */
    add: useMutation({
      mutationFn: async (input: {
        key: string;
        productId: number;
        productUnitId: number;
        qty: string;
      }) =>
        unwrap(
          await session.client.POST('/api/v1/stock-counts/{id}/session/entries', {
            params: { path: { id }, header: { 'Idempotency-Key': input.key } },
            body: {
              productId: input.productId,
              productUnitId: input.productUnitId,
              qty: input.qty,
            },
          }),
        ),
      onSettled: refresh,
    }),
    /** Takes back one of my own unsent numbers; it stays in the history, struck out. */
    takeBack: useMutation({
      mutationFn: async (entryId: number) =>
        unwrap(
          await session.client.POST('/api/v1/stock-counts/{id}/session/entries/{entryId}/void', {
            params: { path: { id, entryId } },
          }),
        ),
      onSettled: refresh,
    }),
  };
}
