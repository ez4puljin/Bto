import { useQueryClient } from '@tanstack/react-query';
import type { LiveStockCustomerItem, LiveStockStaffItem, StockApp } from '@tugeel/shared/sales';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { isCustomerItem, isStaffItem, LIVE_STOCK_PATHS, LiveStockStream } from '../api/live-stock';
import { applyLiveEvent } from '../api/live-stock-cache';
import type { AnySession } from '../api/session';

/**
 * The app's live stock (ADR-0173 #4), mounted once in each app's signed-in layout: while the app
 * is in the foreground one stream is open and its events reach the cache (patched products, stale
 * lists, refetched quotes); in the background it is closed, and coming back opens it again — its
 * `ready` refetches whatever changed meanwhile. `enabled` false (a staff member who is not a rep)
 * opens nothing.
 */
export function useLiveStock(session: AnySession, app: StockApp, enabled = true): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return undefined;
    const stream = new LiveStockStream<LiveStockStaffItem | LiveStockCustomerItem>({
      url: `${session.server}${LIVE_STOCK_PATHS[app]}`,
      token: (rejected) => session.streamToken(rejected),
      isItem: app === 'STAFF' ? isStaffItem : isCustomerItem,
      onEvent: (event) => applyLiveEvent(queryClient, app, event),
    });
    // `inactive` (iOS, a passing system sheet) and `unknown` (before the first report) keep it.
    const follow = (state: AppStateStatus) => {
      if (state === 'background') stream.stop();
      else if (state === 'active') stream.start();
    };
    if (AppState.currentState !== 'background') stream.start();
    const subscription = AppState.addEventListener('change', follow);
    return () => {
      subscription.remove();
      stream.stop();
    };
  }, [session, app, enabled, queryClient]);
}
