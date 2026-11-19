import * as Crypto from 'expo-crypto';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { AppState } from 'react-native';
import { unwrap } from '../api/problem';
import { keptDisk } from '../offline/files';
import { type KeptState, KeptStore } from '../offline/store';
import type { KeptSource } from '../offline/walk';
import { useSignedIn } from './session';

interface KeptValue {
  store: KeptStore | null;
  state: KeptState;
  /** «Одоо шинэчлэх»: false when it did not happen (no server, or the walk failed). */
  refresh: () => Promise<boolean>;
}

const NONE: KeptState = { ready: true, pointer: null, progress: null, failed: false };

const KeptContext = createContext<KeptValue>({
  store: null,
  state: NONE,
  refresh: () => Promise.resolve(false),
});

/**
 * The data kept for the rep's order without the server (ADR-0225 #2), per server and user: a new
 * copy is downloaded at start and on return to the foreground when the kept one is older than six
 * hours, and from «Одоо шинэчлэх»; never while the session has no connection. Only for a rep.
 */
export function KeptProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const { session, server, me, offline } = useSignedIn();

  const store = useMemo(() => {
    if (!enabled) return null;
    const source: KeptSource = {
      products: async (cursor) =>
        unwrap(
          await session.client.GET('/api/v1/sales-rep/offline/products', {
            params: { query: { ...(cursor ? { cursor } : {}), limit: 500 } },
          }),
        ),
      customers: async (cursor) =>
        unwrap(
          await session.client.GET('/api/v1/sales-rep/offline/customers', {
            params: { query: { ...(cursor ? { cursor } : {}), limit: 1000 } },
          }),
        ),
      context: async () => unwrap(await session.client.GET('/api/v1/sales-rep/context')),
      categories: async () => unwrap(await session.client.GET('/api/v1/categories')).data,
      suppliers: async () => unwrap(await session.client.GET('/api/v1/sales-rep/suppliers')),
    };
    return new KeptStore(keptDisk(server, me.id), source, {
      now: () => new Date(),
      newGen: () => `g${Date.now().toString(36)}${Crypto.randomUUID().slice(0, 8)}`,
    });
  }, [enabled, session, server, me.id]);

  // A store that is no longer the current one (signed out, another server) stops its walk.
  useEffect(() => () => store?.dispose(), [store]);

  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : () => undefined),
    [store],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => store?.getSnapshot() ?? NONE,
    () => NONE,
  );

  const refresh = useCallback(async () => {
    if (!store || offline) return false;
    return store.refresh();
  }, [store, offline]);

  // At start (and when the connection comes back) when the copy is missing or six hours old.
  useEffect(() => {
    if (!store || offline) return;
    void store.ready.then(() => {
      if (store.isStale()) void store.refresh();
    });
  }, [store, offline]);

  // Back in the foreground, the same rule.
  useEffect(() => {
    if (!store) return;
    const watch = AppState.addEventListener('change', (next) => {
      if (next === 'active' && !offline && store.isStale()) void store.refresh();
    });
    return () => watch.remove();
  }, [store, offline]);

  const value = useMemo(() => ({ store, state, refresh }), [store, state, refresh]);
  return <KeptContext.Provider value={value}>{children}</KeptContext.Provider>;
}

/** The kept copy and its state; outside KeptProvider (or for a non-rep) there is none. */
export function useKept(): KeptValue {
  return useContext(KeptContext);
}
