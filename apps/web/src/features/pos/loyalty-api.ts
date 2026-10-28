import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { ATTENTION_KEY } from '@/features/home/api';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type LoyaltyMember = Schemas['PosLoyaltyMember'];
export type LoyaltyMemberRequest = Schemas['PosLoyaltyMemberRequest'];
export type LoyaltyMemberUpdate = Schemas['PosLoyaltyMemberUpdate'];
export type LoyaltyEntry = Schemas['PosLoyaltyEntry'];
export type LoyaltyTier = Schemas['PosLoyaltyTier'];
export type LoyaltyTiersRequest = Schemas['PosLoyaltyTiersRequest'];
export type SaleLoyalty = Schemas['PosSaleLoyalty'];
export type LoyaltyMemberStatus = LoyaltyMember['status'];

/** The supermarket's bonus card (ADR-0112). */
export const LOYALTY_KEYS = {
  members: ['pos', 'loyalty', 'members'] as const,
  tiers: ['pos', 'loyalty', 'tiers'] as const,
  toCheck: ['pos', 'loyalty', 'to-check'] as const,
};

export interface LoyaltyMemberFilter {
  status?: LoyaltyMemberStatus;
  q?: string;
}

export function useLoyaltyMembers(filter: LoyaltyMemberFilter) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...LOYALTY_KEYS.members, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/loyalty-members', {
          params: { query: { ...filter, q: filter.q || undefined, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useLoyaltyMember(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...LOYALTY_KEYS.members, 'detail', id],
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/loyalty-members/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

/** A member's points history, newest first, a page at a time. */
export function useLoyaltyEntries(id: number | null) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...LOYALTY_KEYS.members, 'entries', id],
    enabled: id !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/pos/loyalty-members/{id}/entries', {
          params: { path: { id: id ?? 0 }, query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useLoyaltyTiers() {
  const api = useApiClient();
  return useQuery({
    queryKey: LOYALTY_KEYS.tiers,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/loyalty-tiers', { signal })),
  });
}

/** The member sales the centre flagged (a blocked card, points past the balance), not yet checked. */
export function useSaleLoyaltyToCheck(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: LOYALTY_KEYS.toCheck,
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/pos/sale-loyalty', { signal })),
  });
}

/** Registering, editing, the PIN, blocking, adjusting points; each refreshes the members. */
export function useLoyaltyMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = (...keys: readonly (readonly string[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  return {
    register: useMutation({
      mutationFn: async ({ key, ...body }: LoyaltyMemberRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/pos/loyalty-members', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      // The new member opens in the panel at once, from the answer.
      onSuccess: (created) => {
        queryClient.setQueryData([...LOYALTY_KEYS.members, 'detail', created.id], created);
        return refresh(LOYALTY_KEYS.members);
      },
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: LoyaltyMemberUpdate & { id: number }) =>
        unwrap(
          await api.PATCH('/api/v1/pos/loyalty-members/{id}', {
            params: { path: { id } },
            body,
          }),
        ),
      onSuccess: () => refresh(LOYALTY_KEYS.members),
    }),
    setPin: useMutation({
      mutationFn: async ({ id, pin }: { id: number; pin: string }) =>
        unwrap(
          await api.POST('/api/v1/pos/loyalty-members/{id}/pin', {
            params: { path: { id } },
            body: { pin },
          }),
        ),
      onSuccess: () => refresh(LOYALTY_KEYS.members),
    }),
    block: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/pos/loyalty-members/{id}/block', { params: { path: { id } } }),
        ),
      onSuccess: () => refresh(LOYALTY_KEYS.members),
    }),
    unblock: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/pos/loyalty-members/{id}/unblock', { params: { path: { id } } }),
        ),
      onSuccess: () => refresh(LOYALTY_KEYS.members),
    }),
    adjust: useMutation({
      mutationFn: async ({
        id,
        key,
        points,
        reason,
      }: {
        id: number;
        key: string;
        points: string;
        reason: string;
      }) =>
        unwrap(
          await api.POST('/api/v1/pos/loyalty-members/{id}/adjust', {
            params: { path: { id }, header: idempotencyKey(key) },
            body: { points, reason },
          }),
        ),
      onSuccess: () => refresh(LOYALTY_KEYS.members),
    }),
    saveTiers: useMutation({
      mutationFn: async (body: LoyaltyTiersRequest) =>
        unwrap(await api.PUT('/api/v1/pos/loyalty-tiers', { body })),
      onSuccess: (tiers) => queryClient.setQueryData(LOYALTY_KEYS.tiers, tiers),
    }),
    review: useMutation({
      mutationFn: async ({ id, note }: { id: number; note: string | null }) =>
        unwrap(
          await api.POST('/api/v1/pos/sale-loyalty/{id}/review', {
            params: { path: { id } },
            body: { note },
          }),
        ),
      onSuccess: () => refresh(LOYALTY_KEYS.toCheck, ATTENTION_KEY),
    }),
  };
}
