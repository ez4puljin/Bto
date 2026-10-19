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
import {
  type AnySession,
  type CustomerPrincipal,
  CustomerSession,
  type Me,
  type SessionOptions,
  type SessionState,
  StaffSession,
} from '../api/session';
import { APP } from '../config/app';
import { readJson, SERVER_KEY, secureTokenStore, writeJson } from '../device/storage';

interface SessionValue {
  /** undefined while the stored address is read; null when none is set. */
  server: string | null | undefined;
  session: AnySession | null;
  state: SessionState<Me | CustomerPrincipal>;
  setServer: (server: string | null) => Promise<void>;
  /** A production build's own server (ADR-0079 #10): no server screen, no «Сервер солих». */
  serverFixed: boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

const LOADING: SessionState = { status: 'loading' };
const ANONYMOUS: SessionState = { status: 'anonymous' };
const never = () => () => undefined;

/** This build's session on a server: the rep's (`staff`) or the store's (`customer`, ADR-0084). */
function sessionOn(server: string): AnySession {
  const options: SessionOptions = {
    server,
    store: secureTokenStore,
    fetch: (request, init) => fetch(request, init),
    randomUUID: Crypto.randomUUID,
  };
  return APP.variant === 'customer' ? new CustomerSession(options) : new StaffSession(options);
}

/** The server address and the session on it; a new address starts a new session. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const fixed = APP.serverFixed ? APP.defaultServer : null;
  const [server, setServerState] = useState<string | null | undefined>(fixed ?? undefined);

  useEffect(() => {
    if (fixed !== null) return;
    void readJson(SERVER_KEY).then((value) => {
      setServerState(typeof value === 'string' ? value : null);
    });
  }, [fixed]);

  const session = useMemo(() => (server ? sessionOn(server) : null), [server]);

  useEffect(() => {
    if (session) void session.restore();
  }, [session]);

  const state = useSyncExternalStore<SessionState<Me | CustomerPrincipal>>(
    session?.subscribe ?? never,
    session?.getSnapshot ?? (() => (server === undefined ? LOADING : ANONYMOUS)),
  );

  const setServer = useCallback(
    async (value: string | null) => {
      if (fixed !== null) return;
      await writeJson(SERVER_KEY, value);
      setServerState(value);
    },
    [fixed],
  );

  const value = useMemo(
    () => ({ server, session, state, setServer, serverFixed: fixed !== null }),
    [server, session, state, setServer, fixed],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession outside SessionProvider');
  return value;
}

/** The rep's signed-in session; screens under (staff) only render once there is one. */
export function useSignedIn() {
  const { session, server } = useSession();
  const state = session?.kind === 'staff' ? session.getSnapshot() : null;
  if (session?.kind !== 'staff' || state?.status !== 'signedIn' || !server) {
    throw new Error('a staff screen rendered without a staff session');
  }
  return { session, me: state.me, server };
}

/** The store's signed-in session in «Bto300»; screens under (customer) only render once there is one. */
export function useCustomer() {
  const { session, server } = useSession();
  const state = session?.kind === 'customer' ? session.getSnapshot() : null;
  if (session?.kind !== 'customer' || state?.status !== 'signedIn' || !server) {
    throw new Error('a store screen rendered without a store session');
  }
  return { session, me: state.me, accountId: state.userId, server };
}
