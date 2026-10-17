import * as Crypto from 'expo-crypto';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import { MobileSession, type SessionState } from '../api/session';
import { readJson, SERVER_KEY, secureTokenStore, writeJson } from '../device/storage';

interface SessionValue {
  /** undefined while the stored address is read; null when none is set. */
  server: string | null | undefined;
  session: MobileSession | null;
  state: SessionState;
  setServer: (server: string | null) => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

const LOADING: SessionState = { status: 'loading' };
const ANONYMOUS: SessionState = { status: 'anonymous' };
const never = () => () => undefined;

/** The server address and the session on it; a new address starts a new session. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [server, setServerState] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void readJson(SERVER_KEY).then((value) => {
      setServerState(typeof value === 'string' ? value : null);
    });
  }, []);

  const session = useMemo(
    () =>
      server
        ? new MobileSession({
            server,
            store: secureTokenStore,
            fetch: (request, init) => fetch(request, init),
            randomUUID: Crypto.randomUUID,
          })
        : null,
    [server],
  );

  useEffect(() => {
    if (session) void session.restore();
  }, [session]);

  const state = useSyncExternalStore(
    session?.subscribe ?? never,
    session?.getSnapshot ?? (() => (server === undefined ? LOADING : ANONYMOUS)),
  );

  const setServer = useCallback(async (value: string | null) => {
    await writeJson(SERVER_KEY, value);
    setServerState(value);
  }, []);

  const value = useMemo(
    () => ({ server, session, state, setServer }),
    [server, session, state, setServer],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

/** The signed-in session; screens under (staff) only render once there is one. */
export function useSignedIn() {
  const { session, state, server } = useSession();
  if (!session || state.status !== 'signedIn' || !server) {
    throw new Error('a staff screen rendered without a session');
  }
  return { session, me: state.me, server };
}
