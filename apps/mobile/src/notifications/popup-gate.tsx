import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { SUMMARY_KEY, useNotificationSummary } from '../api/notifications';
import { useShop } from '../state/shop';
import { popupQueue } from './feed';

/** Screens a popup never covers: the camera, the customer, the checkout, a new password. */
const BUSY_PATHS = new Set(['/scan', '/customers', '/checkout', '/password', '/notice-popup']);

/**
 * Opens the notice popup (ADR-0062 #3) when the app starts and each time it returns to the
 * foreground, after a fresh summary — never from the minute's refresh. A chance that comes while
 * the camera, the customer picker or an unanswered send is open waits until they are gone.
 */
export function NoticePopupGate() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { pending } = useShop();
  const summary = useNotificationSummary();
  const wanted = useRef(true);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      wanted.current = true;
      void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY });
    });
    return () => subscription.remove();
  }, [queryClient]);

  const { data, isFetching } = summary;
  useEffect(() => {
    if (!wanted.current || !data || isFetching) return;
    if (pending !== null || BUSY_PATHS.has(pathname)) return;
    wanted.current = false;
    if (popupQueue(data.notices).length > 0) router.push('/notice-popup');
  }, [data, isFetching, pending, pathname, router]);

  return null;
}
