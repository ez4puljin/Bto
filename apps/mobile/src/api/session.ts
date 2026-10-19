import { type ApiClient, type components, createApiClient } from '@tugeel/api-client';
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

export type SessionState<P = Me> =
  | { status: 'loading' }
  | { status: 'anonymous'; reason?: 'expired' | 'logout' }
  /** A stored session the server could not be asked about: no connection. */
  | { status: 'offline' }
  | { status: 'signedIn'; me: P; userId: number };

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

export interface SessionOptions {
  server: string;
  store: TokenStore;
  /** The platform's fetch; `init.signal` aborts a call that ran out of time. */
  fetch: (request: Request, init: { signal: AbortSignal }) => Promise<Response>;
  randomUUID: () => string;
  now?: () => number;
  /** Milliseconds before a call is abandoned; `REQUEST_TIMEOUT_MS` unless a test shortens it. */
  timeoutMs?: number;
}

/**
 * The native token transport of ADR-0061 #4, for either app (ADR-0083): the access token lives in
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

  /** Routes that answer for the token itself: a 401 there is an answer, not a stale access token. */
  protected abstract readonly ownRoutes: RegExp;
  protected abstract postRefresh(refreshToken: string): Promise<Answer<RefreshTokens>>;
  protected abstract postLogout(refreshToken: string): Promise<unknown>;
  /** Who the session is (a call with the access token); throws when nothing answered. */
  protected abstract whoAmI(userId: number): Promise<Who<P>>;

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
      const who = await this.whoAmI(stored.userId);
      if ('me' in who) this.update({ status: 'signedIn', me: who.me, userId: stored.userId });
      else if (serverFailed(who.problem)) this.update({ status: 'offline' });
      else await this.forget('expired');
    } catch {
      this.update({ status: 'offline' });
    }
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
      this.update({ status: 'signedIn', me, userId });
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
      this.update({ status: 'signedIn', me: who.me, userId });
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
    const response = await this.send(request);
    if (response.status !== 401 || retry === null || !this.refreshToken) return response;
    const outcome = await this.refresh();
    if (outcome !== 'ok') {
      if (outcome === 'rejected') await this.forget('expired');
      return response;
    }
    if (this.accessToken) retry.headers.set('authorization', `Bearer ${this.accessToken}`);
    return this.send(retry);
  }

  /**
   * One call within the time limit: past it the call is aborted and fails like a dropped
   * connection, even where the platform's fetch ignores the abort.
   */
  private async send(request: Request): Promise<Response> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new TypeError('Network request timed out'));
      }, this.options.timeoutMs ?? REQUEST_TIMEOUT_MS);
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

  login(username: string, password: string): Promise<AppProblem | null> {
    return this.signIn(
      () => this.client.POST('/api/v1/auth/mobile/login', { body: { username, password } }),
      (data) => ({ userId: data.me.id, me: data.me }),
    );
  }

  protected postRefresh(refreshToken: string) {
    return this.client.POST('/api/v1/auth/mobile/refresh', { body: { refreshToken } });
  }

  protected postLogout(refreshToken: string) {
    return this.client.POST('/api/v1/auth/mobile/logout', { body: { refreshToken } });
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
