import type { components } from '@tugeel/api-client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSignedIn } from '../state/session';
import { unwrap } from './problem';

export type MyNotice = components['schemas']['MyNotice'];
export type MyNotification = components['schemas']['MyNotification'];
export type MySummary = components['schemas']['MyNotificationSummary'];

const KEY = ['notifications'] as const;
export const SUMMARY_KEY = [...KEY, 'summary'] as const;

/**
 * The running notices and the unread count (ADR-0062 #3): read at start and on return to the
 * foreground (the caller refetches), and every minute for the bell.
 */
export function useNotificationSummary() {
  const { session } = useSignedIn();
  return useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/me/notifications/summary')),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** The rep's own notifications (a sold order), newest first. */
export function useMyNotifications() {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: [...KEY, 'mine'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/me/notifications', {
          params: { query: { ...(pageParam ? { cursor: pageParam } : {}), limit: 30 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Marks notices (shown or opened) and own notifications read; the bell follows at once. */
export function useMarkRead() {
  const { session } = useSignedIn();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: { noticeIds?: number[]; notificationIds?: number[] }) =>
      unwrap(await session.client.POST('/api/v1/me/notifications/read', { body: ids })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
