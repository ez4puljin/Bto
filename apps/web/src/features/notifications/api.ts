import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type AppNotice = Schemas['AppNotice'];
export type AppNoticeRequest = Schemas['AppNoticeRequest'];
export type NoticeKind = AppNotice['kind'];
export type NoticeState = AppNotice['state'];

export const KEYS = { notices: ['notifications', 'notices'] as const };

/** Every notice sent to the rep app, newest first (ADR-0062). */
export function useAppNotices() {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.notices, 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/app-notices', {
          params: { query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

export function useNoticeMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEYS.notices });
  return {
    /** One Idempotency-Key per dialog, resent unchanged on a retry (ADR-0004). */
    create: useMutation({
      mutationFn: async ({ key, ...body }: AppNoticeRequest & { key: string }) =>
        unwrap(
          await api.POST('/api/v1/app-notices', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: invalidate,
    }),
    withdraw: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.POST('/api/v1/app-notices/{id}/withdraw', { params: { path: { id } } })),
      onSuccess: invalidate,
    }),
  };
}
