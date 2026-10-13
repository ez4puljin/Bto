import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { KEYS as CATALOG_KEYS } from '@/features/catalog/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ProductPrices = Schemas['ProductPrices'];
export type UnitPriceView = Schemas['UnitPriceView'];
export type PricePeriod = Schemas['PricePeriod'];
export type CurrentPrice = Schemas['CurrentPrice'];
export type PriceEntry = Schemas['PriceEntryRequest'];
export type PriceList = CurrentPrice['list'];
export type DiscountProgram = Schemas['DiscountProgram'];
export type DiscountProgramRequest = Schemas['DiscountProgramRequest'];
export type ProgramStatus = DiscountProgram['status'];
export type Quote = Schemas['Quote'];
export type QuoteLine = Schemas['QuoteLine'];
export type QuoteRequest = Schemas['QuoteRequest'];

export const KEYS = {
  prices: ['pricing', 'prices'] as const,
  programs: ['pricing', 'programs'] as const,
};

/** Idempotent routes take one key per user intent, resent unchanged on a retry (ADR-0004). */
type Keyed<T> = T & { key: string };

/** Every current unit of a product in both lists (the product page). */
export function useProductPrices(productId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.prices, 'product', productId],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/unit-prices', { params: { query: { productId } }, signal })),
  });
}

/** Base unit prices of a page of products, only while a price column shows (ADR-0037). */
export function useCurrentPricesOf(productIds: readonly number[], enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.prices, 'of', productIds],
    enabled: enabled && productIds.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/unit-prices/current', {
          params: { query: { productIds: [...productIds] } },
          signal,
        }),
      ),
  });
}

export interface ProgramFilter {
  status?: ProgramStatus;
}

export function useDiscountPrograms(filter: ProgramFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.programs, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/discount-programs', {
          params: { query: { status: filter.status, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useDiscountProgram(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.programs, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/discount-programs/{id}', { params: { path: { id } }, signal })),
  });
}

/**
 * Mutations; prices refresh the price queries, programs the program queries, completing products
 * (ADR-0044) the product queries.
 */
export function usePricingMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey });

  return {
    completeProducts: useMutation({
      mutationFn: async ({ key, productIds }: Keyed<{ productIds: number[] }>) =>
        unwrap(
          await api.POST('/api/v1/pricing/sale-ready', {
            params: { header: idempotencyKey(key) },
            body: { productIds },
          }),
        ),
      onSuccess: () =>
        Promise.all([invalidate(CATALOG_KEYS.products), invalidate(CATALOG_KEYS.readiness)]),
    }),
    setPrices: useMutation({
      mutationFn: async ({
        key,
        ...body
      }: Keyed<{ productId: number; validFrom: string; entries: PriceEntry[] }>) =>
        unwrap(
          await api.POST('/api/v1/unit-prices', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: (prices) => {
        queryClient.setQueryData([...KEYS.prices, 'product', prices.productId], prices);
        return invalidate([...KEYS.prices, 'of']);
      },
    }),
    createProgram: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<DiscountProgramRequest>) =>
        unwrap(
          await api.POST('/api/v1/discount-programs', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => invalidate(KEYS.programs),
    }),
    updateProgram: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: DiscountProgramRequest }) =>
        unwrap(await api.PUT('/api/v1/discount-programs/{id}', { params: { path: { id } }, body })),
      onSuccess: () => invalidate(KEYS.programs),
    }),
    stopProgram: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/discount-programs/{id}/stop', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.programs),
    }),
    deleteProgram: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/discount-programs/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.programs),
    }),
  };
}

/** A quote of a test cart (the calculator); nothing is stored. */
export function useQuote() {
  const api = useApiClient();
  return useMutation({
    mutationFn: async (body: QuoteRequest) =>
      unwrap(await api.POST('/api/v1/pricing/quote', { body })),
  });
}
