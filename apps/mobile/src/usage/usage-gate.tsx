import { screenKeyFromSegments, USAGE, type UsageEvent, UsageMeter } from '@tugeel/shared/usage';
import { useSegments } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * Counts which screens of the app are opened and how long they stand in front (ADR-0197), and hands
 * the counts to `send` once a minute and when the app leaves the foreground. Only a screen's name
 * leaves the phone (`/order/:id`), never an id or anything on the screen. It renders nothing, waits
 * for nothing and drops a send that fails: counting must never slow the app it counts.
 */
export function UsageGate({ send }: { send: (events: UsageEvent[]) => Promise<unknown> }) {
  const screen = screenKeyFromSegments(useSegments());
  const meter = useRef<UsageMeter | null>(null);
  meter.current ??= new UsageMeter();
  const latest = useRef({ send, screen });
  latest.current = { send, screen };

  useEffect(() => {
    meter.current?.show(screen, Date.now());
  }, [screen]);

  useEffect(() => {
    const counter = meter.current;
    if (!counter) return undefined;
    if (AppState.currentState !== 'active') counter.hide(Date.now());
    const flush = () => {
      const events = counter.take(Date.now());
      if (events.length > 0) void latest.current.send(events).catch(() => undefined);
    };
    const timer = setInterval(flush, USAGE.flushMs);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        counter.back(Date.now());
        counter.show(latest.current.screen, Date.now());
      } else {
        counter.hide(Date.now());
        flush();
      }
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, []);

  return null;
}
