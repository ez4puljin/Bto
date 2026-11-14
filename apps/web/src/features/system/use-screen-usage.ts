import { screenKeyFromPath, USAGE, UsageMeter } from '@tugeel/shared/usage';
import { useEffect, useRef } from 'react';
import { useLocation, useMatches } from 'react-router';
import { useApiClient } from '@/app/api-client-context';

/**
 * Counts which screens of the office web are opened and how long they stand in front (ADR-0197),
 * and sends the counts once a minute and when the tab goes out of sight. Only a screen's name
 * leaves the browser (`/catalog/products/:id`), never an id, a filter or anything on the screen.
 * A send that fails is dropped: counting must never trouble the work it counts.
 */
export function useScreenUsage(): void {
  const api = useApiClient();
  const location = useLocation();
  const params = useMatches().at(-1)?.params ?? {};
  const meter = useRef<UsageMeter | null>(null);
  meter.current ??= new UsageMeter();
  const screen = screenKeyFromPath(location.pathname, params);
  const latest = useRef(screen);
  latest.current = screen;

  useEffect(() => {
    meter.current?.show(screen, Date.now());
  }, [screen]);

  useEffect(() => {
    const counter = meter.current;
    if (!counter) return undefined;
    // A tab opened in the background counts nothing until it is looked at.
    if (document.visibilityState === 'hidden') counter.hide(Date.now());
    const send = () => {
      const events = counter.take(Date.now());
      if (events.length === 0) return;
      // keepalive: the last send of a closing tab still leaves.
      api
        .POST('/api/v1/usage/screens', { body: { app: 'web', events }, keepalive: true })
        .catch(() => undefined);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        counter.hide(Date.now());
        send();
      } else {
        counter.back(Date.now());
        counter.show(latest.current, Date.now());
      }
    };
    const timer = window.setInterval(send, USAGE.flushMs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [api]);
}
