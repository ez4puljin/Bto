import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ErxesSettings = Schemas['ErxesSettings'];
export type ErxesSettingsUpdate = Schemas['ErxesSettingsUpdateRequest'];
export type ErxesSettingsTest = Schemas['ErxesSettingsTestRequest'];
export type ErxesCheck = Schemas['ErxesCheck'];
export type ErxesPipeline = Schemas['ErxesPipeline'];
export type ErxesPipelineUpdate = Schemas['ErxesPipelineUpdateRequest'];
export type ErxesUser = Schemas['ErxesUser'];
export type ErxesPullResult = Schemas['ErxesPullResult'];
export type ErxesDealRow = Schemas['ErxesDealRow'];
export type ErxesDeal = Schemas['ErxesDeal'];
export type ErxesDealLine = Schemas['ErxesDealLine'];
export type ErxesWaitIssue = Schemas['ErxesWaitIssue'];
export type ErxesDealChoice = Schemas['ErxesDealChoiceRequest'];
export type ErxesDealStatus = ErxesDealRow['status'];
export type ErxesRangePipeline = Schemas['ErxesRangePipeline'];
export type ErxesRangeRequest = Schemas['ErxesRangeRequest'];
export type ErxesRangeCopyRequest = Schemas['ErxesRangeCopyRequest'];
export type ErxesRangeDeal = Schemas['ErxesRangeDeal'];
export type ErxesRangePreview = Schemas['ErxesRangePreview'];
export type ErxesRangeCopy = Schemas['ErxesRangeCopy'];
export type ErxesRangeResult = Schemas['ErxesRangeResult'];

const KEYS = {
  settings: ['erxes', 'settings'] as const,
  pipelines: ['erxes', 'pipelines'] as const,
  users: ['erxes', 'users'] as const,
  deals: ['erxes', 'deals'] as const,
  rangePipelines: ['erxes', 'range', 'pipelines'] as const,
  deal: (id: number) => ['erxes', 'deal', id] as const,
  orderDeal: (orderId: number) => ['erxes', 'order', orderId] as const,
};

/** How often the page asks again: the worker pulls every minute. */
const LIST_POLL_MS = 60_000;

export function useErxesSettings(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.settings,
    enabled,
    refetchInterval: LIST_POLL_MS,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/erxes/settings', { signal })),
  });
}

export function useErxesSettingsMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    update: useMutation({
      mutationFn: async (body: ErxesSettingsUpdate) =>
        unwrap(await api.PATCH('/api/v1/erxes/settings', { body })),
      onSuccess: (view) => queryClient.setQueryData(KEYS.settings, view),
    }),
    /** Signs in to erxes with what is typed, or with what is saved; saves nothing. */
    test: useMutation({
      mutationFn: async (body: ErxesSettingsTest) =>
        unwrap(await api.POST('/api/v1/erxes/settings/test', { body })),
    }),
  };
}

export function useErxesPipelines(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.pipelines,
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/erxes/pipelines', { signal })),
  });
}

export function useErxesUsers(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.users,
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/erxes/users', { signal })),
  });
}

export function useErxesDirectoryMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    /** Reads erxes's pipelines and users again. */
    refresh: useMutation({
      mutationFn: async () => unwrap(await api.POST('/api/v1/erxes/pipelines/refresh')),
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: KEYS.pipelines }),
          queryClient.invalidateQueries({ queryKey: KEYS.users }),
          // A refused refresh is written as the last failure.
          queryClient.invalidateQueries({ queryKey: KEYS.settings }),
          queryClient.invalidateQueries({ queryKey: KEYS.rangePipelines }),
        ]),
    }),
    pipeline: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ErxesPipelineUpdate }) =>
        unwrap(await api.PATCH('/api/v1/erxes/pipelines/{id}', { params: { path: { id } }, body })),
      onSuccess: (list) => {
        queryClient.setQueryData(KEYS.pipelines, list);
        return queryClient.invalidateQueries({ queryKey: KEYS.rangePipelines });
      },
    }),
    user: useMutation({
      mutationFn: async ({ id, btoUserId }: { id: number; btoUserId: number | null }) =>
        unwrap(
          await api.PATCH('/api/v1/erxes/users/{id}', {
            params: { path: { id } },
            body: { btoUserId },
          }),
        ),
      onSuccess: (list) => queryClient.setQueryData(KEYS.users, list),
    }),
  };
}

/** The deals of one state, newest first; asked again every minute, as the worker pulls. */
export function useErxesDeals(status: ErxesDealStatus) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.deals, status],
    initialPageParam: undefined as string | undefined,
    refetchInterval: LIST_POLL_MS,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/erxes/deals', {
          params: { query: { status, cursor: pageParam, limit: 100 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useErxesDeal(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.deal(id ?? 0),
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/erxes/deals/{id}', { params: { path: { id: id ?? 0 } }, signal }),
      ),
  });
}

/** The deal an order was copied from; `deal` is null for an order made in Bto. */
export function useErxesOrderDeal(orderId: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.orderDeal(orderId),
    // A deal is copied once and never changes after: nothing to ask again for.
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/erxes/orders/{orderId}/deal', {
          params: { path: { orderId } },
          signal,
        }),
      ),
  });
}

export function useErxesDealActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const done = (deal: ErxesDeal) => {
    queryClient.setQueryData(KEYS.deal(deal.id), deal);
    return Promise.all([
      queryClient.invalidateQueries({ queryKey: KEYS.deals }),
      queryClient.invalidateQueries({ queryKey: KEYS.settings }),
    ]);
  };
  return {
    /** «Одоо татах»: one pull now. */
    pull: useMutation({
      mutationFn: async () => unwrap(await api.POST('/api/v1/erxes/pull')),
      onSettled: () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey: KEYS.deals }),
          queryClient.invalidateQueries({ queryKey: KEYS.settings }),
        ]),
    }),
    choose: useMutation({
      mutationFn: async ({ id, body }: { id: number; body: ErxesDealChoice }) =>
        unwrap(await api.PATCH('/api/v1/erxes/deals/{id}', { params: { path: { id } }, body })),
      onSuccess: done,
    }),
    /** «Bto руу хуулах»: the answer is the deal, an order's id on it when it was copied. */
    copy: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/erxes/deals/{id}/copy', { params: { path: { id } } })),
      onSuccess: done,
    }),
    dismiss: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/erxes/deals/{id}/dismiss', { params: { path: { id } } })),
      onSuccess: done,
    }),
    restore: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/erxes/deals/{id}/restore', { params: { path: { id } } })),
      onSuccess: done,
    }),
  };
}

/** The pipelines a range may read (ADR-0220): not blocked, with their Bto place chosen. */
export function useErxesRangePipelines() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.rangePipelines,
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/erxes/range/pipelines', { signal })),
  });
}

/** «Харах» and «Bto руу хуулах» of a range of days (ADR-0220). */
export function useErxesRangeActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return {
    preview: useMutation({
      mutationFn: async (body: ErxesRangeRequest) =>
        unwrap(await api.POST('/api/v1/erxes/range/preview', { body })),
      onSettled: () => queryClient.invalidateQueries({ queryKey: KEYS.settings }),
    }),
    /** One part of the ticked deals; the dialog sends the parts one after another. */
    copy: useMutation({
      mutationFn: async (body: ErxesRangeCopyRequest) =>
        unwrap(await api.POST('/api/v1/erxes/range/copy', { body })),
    }),
    /** After the last part: the lists and the waiting count are asked again. */
    settle: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: KEYS.deals }),
        queryClient.invalidateQueries({ queryKey: KEYS.settings }),
      ]),
  };
}
