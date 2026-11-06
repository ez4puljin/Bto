import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { DiscountMeasure, PriceList, ProgramApplyType } from '@tugeel/shared/pricing';
import { businessDate } from '@tugeel/shared/time';
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
export type PriceProfileUpdateRequest = Schemas['PriceProfileUpdateRequest'];
export type PriceRounding = PriceProfileValues['rounding'];
export type DiscountProgram = Schemas['DiscountProgram'];
export type { PriceList };
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

export interface ProfileFilter {
  q?: string;
  status?: PriceProfile['status'];
  rounding?: PriceRounding;
  bulk?: 'WITH' | 'WITHOUT';
  used?: 'USED' | 'UNUSED';
}

export function usePriceProfiles(filter: ProfileFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.profiles, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/price-profiles', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
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
  q?: string;
  status?: ProgramStatus;
  applyType?: ProgramApplyType;
  priority?: 'ONLY' | 'EXCLUDE';
  condition?: DiscountMeasure;
  productId?: number;
  pipelineId?: number;
  tillId?: number;
  date?: string;
}

export function useDiscountPrograms(filter: ProgramFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.programs, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/discount-programs', {
          params: { query: { ...filter, cursor: pageParam, limit: 50 } },
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
    updateProfile: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: PriceProfileUpdateRequest }) =>
        unwrap(await api.PUT('/api/v1/price-profiles/{id}', { params: { path: { id } }, body })),
      onSuccess: () => Promise.all([invalidate(KEYS.profiles), invalidate(KEYS.prices)]),
    }),
    archiveProfile: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/price-profiles/{id}/archive', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.profiles),
    }),
    restoreProfile: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/price-profiles/{id}/restore', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.profiles),
    }),
    deleteProfile: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/price-profiles/{id}', { params: { path: { id } } })),
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
    archiveProgram: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/discount-programs/{id}/archive', { params: { path: { id } } }),
        ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.programs }),
    }),
    restoreProgram: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/discount-programs/{id}/restore', { params: { path: { id } } }),
        ),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: KEYS.programs }),
    }),
    deleteProgram: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/discount-programs/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.programs),
    }),
  };
}

/**
 * A quote of lines being edited (ADR-0059: an order's products before they are saved), read again
 * whenever the lines change; the previous answer stays on screen meanwhile.
 */
export function useLinesQuote(
  lines: readonly { productUnitId: number; qty: string }[],
  enabled = true,
  pipelineId?: number | null,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['pricing', 'quote', lines, pipelineId ?? null],
    enabled: enabled && lines.length > 0,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.POST('/api/v1/pricing/quote', {
          body: {
            list: 'WHOLESALE',
            date: businessDate(),
            ...(pipelineId ? { pipelineId } : {}),
            lines: [...lines],
          },
          signal,
        }),
      ),
  });
}

/** A quote of a test cart (the calculator); nothing is stored. */
export function useQuote() {
  const api = useApiClient();
  return useMutation({
    mutationFn: async (body: QuoteRequest) =>
      unwrap(await api.POST('/api/v1/pricing/quote', { body })),
  });
}
