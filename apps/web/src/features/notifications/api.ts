import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
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

export type MyNotice = Schemas['MyNotice'];
export type MyNotification = Schemas['MyNotification'];

/** The signed-in user's own inbox (ADR-0062 #3), the web's bell since ADR-0114. */
export const INBOX_KEY = ['notifications', 'mine'] as const;

/** The running notices and the unread count: read every minute and on return to the window. */
export function useInboxSummary() {
  const api = useApiClient();
  return useQuery({
    queryKey: [...INBOX_KEY, 'summary'],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/me/notifications/summary', { signal })),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The newest own notifications (a sold order), first page only. */
export function useInboxItems(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...INBOX_KEY, 'items'],
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/me/notifications', { params: { query: { limit: 20 } }, signal }),
      ),
    enabled,
    staleTime: 30_000,
  });
}

/** Marks notices and own notifications read; the bell follows at once. */
export function useMarkInboxRead() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: { noticeIds?: number[]; notificationIds?: number[] }) =>
      unwrap(await api.POST('/api/v1/me/notifications/read', { body: ids })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: INBOX_KEY }),
  });
}
