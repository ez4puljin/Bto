import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type CompanyContact = Schemas['CompanyContact'];
export type CompanyContactRequest = Schemas['CompanyContactRequest'];
export type CustomerAppAttention = Schemas['CustomerAppAttention'];
export type Banner = Schemas['Banner'];
export type BannerRequest = Schemas['BannerCreateRequest'];

/** The API's bounds on «Холбоо барих» (ADR-0079 #14): rows, and characters of a role and a name. */
export const CONTACT_LIMITS = { maxContacts: 30, maxRole: 60, maxName: 80 } as const;

const KEYS = {
  contacts: ['customer-app', 'contacts'] as const,
  banners: ['customer-app', 'banners'] as const,
};

/** The company's contact people the customer app lists on «Нүүр», in their order. */
export function useCompanyContacts() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.contacts,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/customer/contacts', { signal })),
  });
}

/** Saves the whole ordered list (each change sends every row); the answer is the saved list. */
export function useSaveCompanyContacts() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (contacts: CompanyContactRequest[]) =>
      unwrap(await api.PUT('/api/v1/customer/contacts', { body: { contacts } })),
    onSuccess: (saved) => queryClient.setQueryData(KEYS.contacts, saved),
  });
}

/**
 * Whether app orders have somewhere to land (ADR-0079 #5): stores with an open app account, and
 * whether a stage without an action takes the CUSTOMER_APP channel. A small count, kept fresh like
 * the home page's other attention reads.
 */
export function useCustomerAppAttention(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...ATTENTION_KEY, 'customer-app'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/customer/attention', { signal })),
    enabled,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** «Bto300»'s banners (ADR-0092 #5): the live ones in their order, or the archived ones. */
export function useBanners(archived = false, enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.banners, { archived }],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/customer/banners', { params: { query: { archived } }, signal }))
        .data,
    enabled,
  });
}

export function useBannerMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEYS.banners });
  return {
    /** One Idempotency-Key per dialog, resent unchanged on a retry (ADR-0004). */
    create: useMutation({
      mutationFn: async ({ key, ...body }: BannerRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/customer/banners', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: invalidate,
    }),
    move: useMutation({
      mutationFn: async ({ id, direction }: { id: number; direction: 'UP' | 'DOWN' }) =>
        unwrap(
          await api.POST('/api/v1/customer/banners/{id}/move', {
            params: { path: { id } },
            body: { direction },
          }),
        ),
      onSuccess: invalidate,
    }),
    archive: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/customer/banners/{id}/archive', { params: { path: { id } } }),
        ),
      onSuccess: invalidate,
    }),
  };
}
