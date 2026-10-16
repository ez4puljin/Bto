import { type ApiClient, type components, createApiClient } from '@tugeel/api-client';
import { type AppProblem, NETWORK, problemOf } from './problem';

export type Me = components['schemas']['Me'];

/** What the phone keeps between launches (secure storage): one session per server. */
export interface StoredSession {
  server: string;
  userId: number;
  refreshToken: string;
}

export interface TokenStore {
  load(): Promise<StoredSession | null>;
  save(value: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export type SessionState =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' | 'logout' }
  /** A stored session the server could not be asked about: no connection. */
  | { status: 'offline' }
  | { status: 'signedIn'; me: Me };

type RefreshOutcome = 'ok' | 'rejected' | 'offline';

/** Routes that answer for the token itself: a 401 there is an answer, not a stale access token. */
const AUTH_ROUTE = /\/api\/v1\/auth\/mobile\/(login|refresh|logout)$/;

/** The path of a URL without the URL class (Hermes' URL may lack it). */
const pathOf = (url: string) =>
  url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';

/** Refresh this long before the access token ends, so a call never leaves with a dead one. */
const EARLY_MS = 30_000;

export interface SessionOptions {
  server: string;
  store: TokenStore;
  fetch: (request: Request) => Promise<Response>;
  randomUUID: () => string;
  now?: () => number;
}

/**
 * The staff app's side of ADR-0061 #4: the access token lives in memory, the refresh token in
 * secure storage; one refresh at a time, its rotated token stored before anyone uses it; a call
 * answered 401 refreshes once and is sent again. A refresh nobody answered leaves the phone
 * `offline` with its session kept; one the server refused ends the session.
 */
export class MobileSession {
  readonly client: ApiClient;
  readonly server: string;
  private readonly options: SessionOptions;
  private accessToken: string | null = null;
  private accessEndsAt = 0;
  private refreshToken: string | null = null;
  private userId: number | null = null;
  private state: SessionState = { status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private refreshing: Promise<RefreshOutcome> | null = null;

  constructor(options: SessionOptions) {
    this.options = options;
    this.server = options.server;
    this.client = createApiClient({
      baseUrl: options.server,
      fetch: (request) => this.fetchWithRefresh(request),
      getToken: () => this.accessToken,
      randomUUID: options.randomUUID,
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): SessionState => this.state;

  /** Signs in again with the stored token, once at start or when the connection comes back. */
  async restore(): Promise<void> {
    const stored = await this.options.store.load();
    if (!stored || stored.server !== this.server) {
      this.update({ status: 'anonymous' });
      return;
    }
    this.refreshToken = stored.refreshToken;
    this.userId = stored.userId;
    const outcome = await this.refresh();
    if (outcome === 'offline') {
      this.update({ status: 'offline' });
      return;
    }
    if (outcome === 'rejected') {
      await this.forget('expired');
      return;
    }
    try {
      const me = await this.client.GET('/api/v1/auth/me');
      if (me.data) this.update({ status: 'signedIn', me: me.data });
      else await this.forget('expired');
    } catch {
      this.update({ status: 'offline' });
    }
  }

  /** Null when signed in; otherwise why not (wrong password, locked, no connection…). */
  async login(username: string, password: string): Promise<AppProblem | null> {
    let result;
    try {
      result = await this.client.POST('/api/v1/auth/mobile/login', {
        body: { username, password },
      });
    } catch {
      return NETWORK;
    }
    if (!result.data) return problemOf(result.error, result.response.status);
    this.takeAccess(result.data.accessToken, result.data.accessTokenExpiresAt);
    this.refreshToken = result.data.refreshToken;
    this.userId = result.data.me.id;
    await this.options.store.save({
      server: this.server,
      userId: result.data.me.id,
      refreshToken: result.data.refreshToken,
    });
    this.update({ status: 'signedIn', me: result.data.me });
    return null;
  }

  /** Ends this phone's session; the stored token goes even without a connection. */
  async logout(): Promise<void> {
    const token = this.refreshToken;
    if (token) {
      await this.client
        .POST('/api/v1/auth/mobile/logout', { body: { refreshToken: token } })
        .catch(() => undefined);
    }
    await this.forget('logout');
  }

  /** One refresh at a time; concurrent callers share it. */
  refresh(): Promise<RefreshOutcome> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    const token = this.refreshToken;
    if (!token) return 'rejected';
    let result;
    try {
      result = await this.client.POST('/api/v1/auth/mobile/refresh', {
        body: { refreshToken: token },
      });
    } catch {
      return 'offline';
    }
    if (!result.data) {
      const status = result.response.status;
      return status === 401 || status === 403 ? 'rejected' : 'offline';
    }
    // The rotated token is stored before anyone uses it; null (the grace answer) keeps ours.
    if (result.data.refreshToken !== null) {
      this.refreshToken = result.data.refreshToken;
      if (this.userId !== null) {
        await this.options.store.save({
          server: this.server,
          userId: this.userId,
          refreshToken: result.data.refreshToken,
        });
      }
    }
    this.takeAccess(result.data.accessToken, result.data.accessTokenExpiresAt);
    return 'ok';
  }

  private async fetchWithRefresh(request: Request): Promise<Response> {
    const path = pathOf(request.url);
    const own = AUTH_ROUTE.test(path);
    if (!own && this.refreshToken && this.now() > this.accessEndsAt - EARLY_MS) {
      const outcome = await this.refresh();
      if (outcome === 'rejected') await this.forget('expired');
      if (this.accessToken) request.headers.set('authorization', `Bearer ${this.accessToken}`);
    }
    const retry = own ? null : request.clone();
    const response = await this.options.fetch(request);
    if (response.status !== 401 || retry === null || !this.refreshToken) return response;
    const outcome = await this.refresh();
    if (outcome !== 'ok') {
      if (outcome === 'rejected') await this.forget('expired');
      return response;
    }
    if (this.accessToken) retry.headers.set('authorization', `Bearer ${this.accessToken}`);
    return this.options.fetch(retry);
  }

  private takeAccess(token: string, endsAt: string): void {
    this.accessToken = token;
    const parsed = Date.parse(endsAt);
    this.accessEndsAt = Number.isFinite(parsed) ? parsed : this.now() + 60_000;
  }

  private async forget(reason: 'expired' | 'logout'): Promise<void> {
    this.accessToken = null;
    this.accessEndsAt = 0;
    this.refreshToken = null;
    this.userId = null;
    await this.options.store.clear().catch(() => undefined);
    this.update({ status: 'anonymous', reason });
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private update(state: SessionState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
