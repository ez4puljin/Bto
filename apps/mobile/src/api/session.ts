import { type ApiClient, type components, createApiClient } from '@tugeel/api-client';
import { retryDelay } from '../outbox/backoff';
import { type AppProblem, NETWORK, problemOf } from './problem';

export type Me = components['schemas']['Me'];
export type CustomerAppMe = components['schemas']['CustomerAppMe'];

/** The store signed in to «Bto300» (ADR-0079): its app account and what `GET /customer-app/me` says. */
export interface CustomerPrincipal {
  accountId: number;
  store: CustomerAppMe;
}

/** What the phone keeps between launches (secure storage): one session per server. */
export interface StoredSession {
  server: string;
  /** The staff user's id, or the store's app account (`account.id`, ADR-0082). */
  userId: number;
  refreshToken: string;
}

export interface TokenStore {
  load(): Promise<StoredSession | null>;
  save(value: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Who signed in, as the server last said it (the staff app only): kept per server and user at
 * every sign-in and restore, so the app opens from it when the server does not answer. No token.
 */
export interface IdentityStore {
  load(server: string, userId: number): Promise<unknown>;
  save(server: string, userId: number, me: unknown): Promise<void>;
  clear(server: string, userId: number): Promise<void>;
}

export type SessionState<P = Me> =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' | 'logout' }
  /** A stored session the server could not be asked about: no connection. */
  | { status: 'offline' }
  /**
   * Signed in. `offline`: the server does not answer (opened from the stored identity, or a call
   * found no connection); the session tries again by itself and drops the flag once answered.
   */
  | { status: 'signedIn'; me: P; userId: number; offline?: true };

type RefreshOutcome = 'ok' | 'rejected' | 'offline';

/** An openapi-fetch answer, as far as the session reads it. */
interface Answer<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

interface SignInTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
}

interface RefreshTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** Null within the server's grace window: the stored token stays. */
  refreshToken: string | null;
}

/** Who a session belongs to, or why the server would not say. */
type Who<P> = { me: P } | { problem: AppProblem };

/** A server that failed (5xx) or never answered says nothing about the session: keep it. */
const serverFailed = (problem: AppProblem) => problem.status === 0 || problem.status >= 500;

/** The path of a URL without the URL class (Hermes' URL may lack it). */
const pathOf = (url: string) =>
  url.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, '').split(/[?#]/)[0] ?? '';

/** Refresh this long before the access token ends, so a call never leaves with a dead one. */
const EARLY_MS = 30_000;

/**
 * React Native's fetch never gives up by itself (OkHttp without timeouts): a stored server that
 * had left the Wi-Fi held the start logo for minutes (2026-10-17). Every call is aborted after
 * this long and then counts as no connection.
 */
export const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Calls that wait for an outside service by design (ADR-0199): a model reading product photos and
 * the background service cutting a picture out take tens of seconds, and giving up at ten would
 * throw away an answer already paid for. Everything else keeps the short limit.
 */
export const SLOW_ROUTES = /^\/api\/v1\/product-registrations\/ai\/(read|image)$/;
export const SLOW_REQUEST_TIMEOUT_MS = 120_000;

/** How long a call to `path` may take before it counts as no connection. */
export function timeoutFor(path: string, base: number = REQUEST_TIMEOUT_MS): number {
  return SLOW_ROUTES.test(path) ? Math.max(base, SLOW_REQUEST_TIMEOUT_MS) : base;
}

export interface SessionOptions {
  server: string;
  store: TokenStore;
  /** The platform's fetch; `init.signal` aborts a call that ran out of time. */
  fetch: (request: Request, init: { signal: AbortSignal }) => Promise<Response>;
  randomUUID: () => string;
  now?: () => number;
  /** Milliseconds before a call is abandoned; `REQUEST_TIMEOUT_MS` unless a test shortens it. */
  timeoutMs?: number;
  /**
   * The stored identity (the staff app, owner 2026-11-19): with it a stored session opens without
   * the server and tries again by itself. «Bto300» passes none and keeps the offline page.
   */
  identity?: IdentityStore;
  /** Timers for the tries again; the platform's unless a test drives them. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * The native token transport of ADR-0061 #4, for either app (ADR-0085): the access token lives in
 * memory, the refresh token in secure storage; one refresh at a time, its rotated token stored
 * before anyone uses it; a call answered 401 refreshes once and is sent again (a 403 never is). A
 * refresh nobody answered leaves the phone `offline` with its session kept; one the server refused
 * ends the session. The staff and the customer sessions differ only in their routes and in who
 * signed in.
 */
export abstract class MobileSession<P> {
  readonly client: ApiClient;
  readonly server: string;
  private readonly options: SessionOptions;
  private accessToken: string | null = null;
  private accessEndsAt = 0;
  private refreshToken: string | null = null;
  private userId: number | null = null;
  private state: SessionState<P> = { status: 'loading' };
  private readonly listeners = new Set<() => void>();
  private refreshing: Promise<RefreshOutcome> | null = null;
  private reconnecting: Promise<void> | null = null;
  private retryTimer: unknown = null;
  private retries = 0;
  private disposed = false;

  /** Routes that answer for the token itself: a 401 there is an answer, not a stale access token. */
  protected abstract readonly ownRoutes: RegExp;
  protected abstract postRefresh(refreshToken: string): Promise<Answer<RefreshTokens>>;
  protected abstract postLogout(refreshToken: string): Promise<unknown>;
  /** Who the session is (a call with the access token); throws when nothing answered. */
  protected abstract whoAmI(userId: number): Promise<Who<P>>;
  /** A stored identity read back; null when it is not one (the customer session keeps none). */
  protected identityOf(_value: unknown): P | null {
    return null;
  }

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

  getSnapshot = (): SessionState<P> => this.state;

  /** Signs in again with the stored token, once at start or when the connection comes back. */
  async restore(): Promise<void> {
    this.disposed = false;
    const stored = await this.options.store.load();
    if (!stored || stored.server !== this.server) {
      this.update({ status: 'anonymous' });
      return;
    }
    this.refreshToken = stored.refreshToken;
    this.userId = stored.userId;
    const outcome = await this.refresh();
    if (outcome === 'offline') {
      await this.openOffline(stored.userId);
      return;
    }
    if (outcome === 'rejected') {
      await this.forget('expired');
      return;
    }
    try {
      const who = await this.whoAmI(stored.userId);
      if ('me' in who) await this.online(who.me, stored.userId);
      else if (serverFailed(who.problem)) await this.openOffline(stored.userId);
      else await this.forget('expired');
    } catch {
      await this.openOffline(stored.userId);
    }
  }

  /**
   * Asks the server again for a session opened without it (no-op otherwise): answered, the app is
   * simply online; refused, it goes to the sign-in; no answer, it tries again later. Never blocks a
   * screen; one at a time.
   */
  reconnect(): Promise<void> {
    const state = this.state;
    if (state.status !== 'signedIn' || !state.offline || this.disposed) return Promise.resolve();
    this.reconnecting ??= this.doReconnect(state.userId).finally(() => {
      this.reconnecting = null;
    });
    return this.reconnecting;
  }

  /** Stops the tries again: the session is no longer used (another server was chosen). */
  dispose(): void {
    this.disposed = true;
    this.stopRetries();
  }

  /** Is this the staff app's session that may open without the server? */
  get keepsIdentity(): boolean {
    return this.options.identity !== undefined;
  }

  private async doReconnect(userId: number): Promise<void> {
    const outcome =
      this.accessToken === null || this.now() > this.accessEndsAt - EARLY_MS
        ? await this.refresh()
        : 'ok';
    if (outcome === 'rejected') {
      await this.forget('expired');
      return;
    }
    if (outcome === 'offline') {
      this.scheduleRetry();
      return;
    }
    let who: Who<P>;
    try {
      who = await this.whoAmI(userId);
    } catch {
      this.scheduleRetry();
      return;
    }
    if ('me' in who) await this.online(who.me, userId);
    else if (serverFailed(who.problem)) this.scheduleRetry();
    else await this.forget('expired');
  }

  /**
   * A stored session whose server did not answer: open from the stored identity when there is
   * one for this server and user (and try again by itself), the offline page otherwise.
   */
  private async openOffline(userId: number): Promise<void> {
    const identity = this.options.identity;
    const me = identity
      ? this.identityOf(await identity.load(this.server, userId).catch(() => null))
      : null;
    if (me === null) {
      this.update({ status: 'offline' });
      return;
    }
    this.update({ status: 'signedIn', me, userId, offline: true });
    this.scheduleRetry();
  }

  /** The server said who: online, and the identity kept for the next start without it. */
  private async online(me: P, userId: number): Promise<void> {
    this.stopRetries();
    this.retries = 0;
    this.update({ status: 'signedIn', me, userId });
    await this.options.identity?.save(this.server, userId, me).catch(() => undefined);
  }

  /** A call found no connection while signed in: the note shows and the tries again start. */
  private lostConnection(): void {
    const state = this.state;
    if (!this.options.identity || state.status !== 'signedIn' || state.offline) return;
    this.update({ ...state, offline: true });
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    if (this.disposed || this.retryTimer !== null) return;
    const delay = retryDelay(this.retries);
    this.retries += 1;
    const set = this.options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    this.retryTimer = set(() => {
      this.retryTimer = null;
      void this.reconnect();
    }, delay);
  }

  private stopRetries(): void {
    if (this.retryTimer === null) return;
    const clear =
      this.options.clearTimer ??
      ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    clear(this.retryTimer);
    this.retryTimer = null;
  }

  /** Ends this phone's session; the stored token goes even without a connection. */
  async logout(): Promise<void> {
    const token = this.refreshToken;
    if (token) await this.postLogout(token).catch(() => undefined);
    await this.forget('logout');
  }

  /** One refresh at a time; concurrent callers share it. */
  refresh(): Promise<RefreshOutcome> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /**
   * The access token for a request outside the API client (the live stock stream, ADR-0173 #4):
   * refreshed first when it is about to end, or when it is `rejected`, the token the server has
   * just answered 401 to (a token another call has already replaced is not refreshed again). Null
   * without a session, without a connection to refresh through, or when the server refused the
   * refresh — which ends the session, as for any other call.
   */
  async streamToken(rejected?: string): Promise<string | null> {
    if (!this.refreshToken) return null;
    const stale = rejected !== undefined && rejected === this.accessToken;
    if (stale || this.accessToken === null || this.now() > this.accessEndsAt - EARLY_MS) {
      const outcome = await this.refresh();
      if (outcome === 'rejected') await this.forget('expired');
      if (outcome !== 'ok') return null;
    }
    return this.accessToken;
  }

  /**
   * A sign-in's answer (a password, or the office's code): the tokens are kept and stored, then
   * the session learns who signed in — from the answer itself or by asking. Null when signed in;
   * otherwise why not (wrong password, locked, no connection…).
   */
  protected async signIn<T extends SignInTokens>(
    call: () => Promise<Answer<T>>,
    identify: (data: T) => { userId: number; me: P | null },
  ): Promise<AppProblem | null> {
    let result;
    try {
      result = await call();
    } catch {
      return NETWORK;
    }
    if (!result.data) return problemOf(result.error, result.response.status);
    const { userId, me } = identify(result.data);
    this.takeAccess(result.data.accessToken, result.data.accessTokenExpiresAt);
    this.refreshToken = result.data.refreshToken;
    this.userId = userId;
    await this.options.store.save({
      server: this.server,
      userId,
      refreshToken: result.data.refreshToken,
    });
    if (me !== null) {
      await this.online(me, userId);
      return null;
    }
    let who;
    try {
      who = await this.whoAmI(userId);
    } catch {
      // Signed in, but the answer to "who" was lost: the offline screen asks again.
      this.update({ status: 'offline' });
      return null;
    }
    if ('me' in who) {
      await this.online(who.me, userId);
      return null;
    }
    if (serverFailed(who.problem)) {
      // Signed in, but the server failed to say who: the offline screen asks again.
      this.update({ status: 'offline' });
      return null;
    }
    await this.forget('expired');
    return who.problem;
  }

  private async doRefresh(): Promise<RefreshOutcome> {
    const token = this.refreshToken;
    if (!token) return 'rejected';
    let result;
    try {
      result = await this.postRefresh(token);
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
    const own = this.ownRoutes.test(path);
    if (!own && this.refreshToken && this.now() > this.accessEndsAt - EARLY_MS) {
      const outcome = await this.refresh();
      if (outcome === 'rejected') await this.forget('expired');
      if (this.accessToken) request.headers.set('authorization', `Bearer ${this.accessToken}`);
    }
    const retry = own ? null : request.clone();
    const response = await this.watched(request);
    if (response.status !== 401 || retry === null || !this.refreshToken) return response;
    const outcome = await this.refresh();
    if (outcome !== 'ok') {
      if (outcome === 'rejected') await this.forget('expired');
      return response;
    }
    if (this.accessToken) retry.headers.set('authorization', `Bearer ${this.accessToken}`);
    return this.watched(retry);
  }

  /**
   * A call that tells the session about the connection (the staff app): no answer starts the
   * «no connection» note and the tries again; any answer while it shows asks the server again.
   */
  private async watched(request: Request): Promise<Response> {
    let response: Response;
    try {
      response = await this.send(request);
    } catch (error) {
      this.lostConnection();
      throw error;
    }
    if (this.state.status === 'signedIn' && this.state.offline) void this.reconnect();
    return response;
  }

  /**
   * One call within the time limit: past it the call is aborted and fails like a dropped
   * connection, even where the platform's fetch ignores the abort.
   */
  private async send(request: Request): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => {
          controller.abort();
          reject(new TypeError('Network request timed out'));
        },
        timeoutFor(pathOf(request.url), this.options.timeoutMs ?? REQUEST_TIMEOUT_MS),
      );
    });
    try {
      return await Promise.race([
        this.options.fetch(request, { signal: controller.signal }),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private takeAccess(token: string, endsAt: string): void {
    this.accessToken = token;
    const parsed = Date.parse(endsAt);
    this.accessEndsAt = Number.isFinite(parsed) ? parsed : this.now() + 60_000;
  }

  private async forget(reason: 'expired' | 'logout'): Promise<void> {
    this.stopRetries();
    this.retries = 0;
    const userId = this.userId;
    if (userId !== null) {
      await this.options.identity?.clear(this.server, userId).catch(() => undefined);
    }
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

  private update(state: SessionState<P>): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** The sales rep's session (ADR-0061 #4): `/auth/mobile/*`, the user from `GET /auth/me`. */
export class StaffSession extends MobileSession<Me> {
  readonly kind = 'staff';
  protected readonly ownRoutes = /\/api\/v1\/auth\/mobile\/(login|refresh|logout)$/;

  /** `login`: the registered phone, or the login name of a record without one (ADR-0128 #1). */
  login(login: string, password: string): Promise<AppProblem | null> {
    return this.signIn(
      () => this.client.POST('/api/v1/auth/mobile/login', { body: { login, password } }),
      (data) => ({ userId: data.me.id, me: data.me }),
    );
  }

  protected postRefresh(refreshToken: string) {
    return this.client.POST('/api/v1/auth/mobile/refresh', { body: { refreshToken } });
  }

  protected postLogout(refreshToken: string) {
    return this.client.POST('/api/v1/auth/mobile/logout', { body: { refreshToken } });
  }

  /** The stored `GET /auth/me` answer, when it still looks like one. */
  protected override identityOf(value: unknown): Me | null {
    if (typeof value !== 'object' || value === null) return null;
    const me = value as Partial<Me>;
    return typeof me.id === 'number' && Array.isArray(me.permissions) ? (value as Me) : null;
  }

  protected async whoAmI(): Promise<Who<Me>> {
    const result = await this.client.GET('/api/v1/auth/me');
    return result.data
      ? { me: result.data }
      : { problem: problemOf(result.error, result.response.status) };
  }
}

/**
 * A store's session in «Bto300» (ADR-0079 #3, ADR-0082): `/auth/customer/*`, signed in with the
 * phone and a password or the office's one-time code, keyed on the app account, the store read
 * from `GET /customer-app/me`.
 */
export class CustomerSession extends MobileSession<CustomerPrincipal> {
  readonly kind = 'customer';
  protected readonly ownRoutes =
    /\/api\/v1\/auth\/customer\/(login|refresh|logout|password\/setup)$/;

  login(phone: string, password: string): Promise<AppProblem | null> {
    return this.signIn(
      () => this.client.POST('/api/v1/auth/customer/login', { body: { phone, password } }),
      (data) => ({ userId: data.account.id, me: null }),
    );
  }

  /** «Нууц үг тавих»: the office's code sets the password and signs in (other phones sign out). */
  setupPassword(phone: string, code: string, newPassword: string): Promise<AppProblem | null> {
    return this.signIn(
      () =>
        this.client.POST('/api/v1/auth/customer/password/setup', {
          body: { phone, code, newPassword },
        }),
      (data) => ({ userId: data.account.id, me: null }),
    );
  }

  protected postRefresh(refreshToken: string) {
    return this.client.POST('/api/v1/auth/customer/refresh', { body: { refreshToken } });
  }

  protected postLogout(refreshToken: string) {
    return this.client.POST('/api/v1/auth/customer/logout', { body: { refreshToken } });
  }

  protected async whoAmI(userId: number): Promise<Who<CustomerPrincipal>> {
    const result = await this.client.GET('/api/v1/customer-app/me');
    return result.data
      ? { me: { accountId: userId, store: result.data } }
      : { problem: problemOf(result.error, result.response.status) };
  }
}

export type AnySession = StaffSession | CustomerSession;
