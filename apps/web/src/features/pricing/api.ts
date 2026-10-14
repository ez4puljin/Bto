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
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ProductPriceView = Schemas['ProductPriceView'];
export type PriceTerms = Schemas['PriceTerms'];
export type PricedUnit = Schemas['PricedUnit'];
export type UnitPriceRow = Schemas['UnitPriceRow'];
export type CurrentTerms = Schemas['CurrentTerms'];
export type SetPriceTermsRequest = Schemas['SetPriceTermsRequest'];
export type PriceProfile = Schemas['PriceProfile'];
export type PriceProfileVersion = Schemas['PriceProfileVersion'];
export type PriceProfileValues = Schemas['PriceProfileValues'];
export type PriceProfileRequest = Schemas['PriceProfileRequest'];
export type PriceProfileVersionRequest = Schemas['PriceProfileVersionRequest'];
export type PriceRounding = PriceProfileValues['rounding'];
export type DiscountProgram = Schemas['DiscountProgram'];
export type PriceList = DiscountProgram['list'];
export type DiscountProgramRequest = Schemas['DiscountProgramRequest'];
export type ProgramStatus = DiscountProgram['status'];
export type Quote = Schemas['Quote'];
export type QuoteLine = Schemas['QuoteLine'];
export type QuotePart = Schemas['QuotePart'];
export type QuoteRequest = Schemas['QuoteRequest'];

export const KEYS = {
  prices: ['pricing', 'prices'] as const,
  profiles: ['pricing', 'profiles'] as const,
  programs: ['pricing', 'programs'] as const,
};

/** Idempotent routes take one key per user intent, resent unchanged on a retry (ADR-0004). */
type Keyed<T> = T & { key: string };

/** A product's price terms, their history and today's prices of each unit (the product page). */
export function useProductPrices(productId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.prices, 'product', productId],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/product-prices', { params: { query: { productId } }, signal })),
  });
}

/** Today's terms of a page of products, only while a price column shows (ADR-0037). */
export function useCurrentPricesOf(productIds: readonly number[], enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.prices, 'of', productIds],
    enabled: enabled && productIds.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/product-prices/current', {
          params: { query: { productIds: [...productIds] } },
          signal,
        }),
      ),
  });
}

/** Live price profiles to choose from (a price dialog); profiles are few, one page holds them. */
export function usePriceProfileChoices() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.profiles, 'choices'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/price-profiles', { params: { query: { limit: 200 } }, signal }))
        .data,
  });
}

export function usePriceProfiles(archived: boolean) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.profiles, 'list', archived],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/price-profiles', {
          params: { query: { archived, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function usePriceProfile(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.profiles, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/price-profiles/{id}', { params: { path: { id } }, signal })),
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
 * Mutations; price terms refresh the price and profile queries, profiles every price shown,
 * programs the program queries, completing products (ADR-0044) the product queries.
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
        Promise.all([
          invalidate(CATALOG_KEYS.products),
          invalidate(CATALOG_KEYS.readiness),
          invalidate(ATTENTION_KEY),
        ]),
    }),
    setTerms: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<SetPriceTermsRequest>) =>
        unwrap(
          await api.POST('/api/v1/product-prices', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: (view) => {
        queryClient.setQueryData([...KEYS.prices, 'product', view.productId], view);
        return Promise.all([invalidate([...KEYS.prices, 'of']), invalidate(KEYS.profiles)]);
      },
    }),
    createProfile: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<PriceProfileRequest>) =>
        unwrap(
          await api.POST('/api/v1/price-profiles', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => invalidate(KEYS.profiles),
    }),
    setProfileVersion: useMutation({
      mutationFn: async ({
        key,
        id,
        ...body
      }: Keyed<PriceProfileVersionRequest & { id: number }>) =>
        unwrap(
          await api.POST('/api/v1/price-profiles/{id}/versions', {
            params: { path: { id }, header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: () => Promise.all([invalidate(KEYS.profiles), invalidate(KEYS.prices)]),
    }),
    renameProfile: useMutation({
      mutationFn: async ({ id, name }: { id: number; name: string }) =>
        unwrap(
          await api.PATCH('/api/v1/price-profiles/{id}', {
            params: { path: { id } },
            body: { name },
          }),
        ),
      onSuccess: () => Promise.all([invalidate(KEYS.profiles), invalidate(KEYS.prices)]),
    }),
    archiveProfile: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/price-profiles/{id}/archive', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.profiles),
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
