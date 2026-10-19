import { type QueryKey, useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { SUMMARY_KEY, useNotificationSummary } from '../api/notifications';
import { useShop } from '../state/shop';
import { type FeedNotice, popupQueue } from './feed';

/** Screens a popup never covers: the camera, the customer, the checkout, a new password. */
const BUSY_PATHS = new Set(['/scan', '/customers', '/checkout', '/password', '/notice-popup']);

/** The rep's popup gate: the staff summary (ADR-0062 #3). */
export function NoticePopupGate() {
  const { pending } = useShop();
  const { data, isFetching } = useNotificationSummary();
  return (
    <PopupGate
      notices={data?.notices}
      fetching={isFetching}
      pending={pending !== null}
      summaryKey={SUMMARY_KEY}
      busyPaths={BUSY_PATHS}
    />
  );
}

/**
 * Opens the notice popup (ADR-0062 #3, ADR-0079 #8) when the app starts and each time it returns
 * to the foreground, after a fresh summary — never from the minute's refresh. A chance that comes
 * while the camera, a busy screen or an unanswered send is open waits until they are gone. Either
 * app passes its own summary; both name their popup route `/notice-popup`.
 */
export function PopupGate({
  notices,
  fetching,
  pending,
  summaryKey,
  busyPaths,
}: {
  notices: readonly FeedNotice[] | undefined;
  fetching: boolean;
  /** An unanswered send: the cart's own card speaks first. */
  pending: boolean;
  summaryKey: QueryKey;
  busyPaths: ReadonlySet<string>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const wanted = useRef(true);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      wanted.current = true;
      void queryClient.invalidateQueries({ queryKey: summaryKey });
    });
    return () => subscription.remove();
  }, [queryClient, summaryKey]);

  useEffect(() => {
    if (!wanted.current || !notices || fetching) return;
    if (pending || busyPaths.has(pathname)) return;
    wanted.current = false;
    if (popupQueue(notices).length > 0) router.push('/notice-popup');
  }, [notices, fetching, pending, busyPaths, pathname, router]);

  return null;
}
