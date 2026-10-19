import type { components } from '@tugeel/api-client';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCustomer } from '../state/session';
import { STORE_KEY } from './customer';
import { unwrap } from './problem';

export type StoreNotice = components['schemas']['CustomerAppNotice'];
export type StoreNotification = components['schemas']['CustomerAppNotification'];
export type StoreNotificationKind = StoreNotification['kind'];

const KEY = [...STORE_KEY, 'notifications'] as const;
export const STORE_SUMMARY_KEY = [...KEY, 'summary'] as const;

/**
 * The running notices for customers and the unread count (ADR-0079 #8): read at start and on
 * return to the foreground (the popup gate refetches), and every minute for the bell.
 */
export function useStoreNotificationSummary() {
  const { session } = useCustomer();
  return useQuery({
    queryKey: STORE_SUMMARY_KEY,
    queryFn: async () =>
      unwrap(await session.client.GET('/api/v1/customer-app/notifications/summary')),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/** The store's own notifications (an order confirmed, cancelled, sold; a payment; a due invoice). */
export function useStoreNotifications() {
  const { session } = useCustomer();
  return useInfiniteQuery({
    queryKey: [...KEY, 'mine'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }) =>
      unwrap(
        await session.client.GET('/api/v1/customer-app/notifications', {
          params: { query: { ...(pageParam ? { cursor: pageParam } : {}), limit: 30 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Marks notices (shown or opened) and own notifications read; the bell follows at once. */
export function useStoreMarkRead() {
  const { session } = useCustomer();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ids: { noticeIds?: number[]; notificationIds?: number[] }) =>
      unwrap(await session.client.POST('/api/v1/customer-app/notifications/read', { body: ids })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
