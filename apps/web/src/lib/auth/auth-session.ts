import {
  type ApiClient,
  type components,
  createApiClient,
  type ProblemDetails,
} from '@tugeel/api-client';
import type { Permission } from '@tugeel/shared/auth';
import { problemOf } from '@/lib/problem';
import { randomUuid } from '@/lib/uuid';

export type Me = components['schemas']['Me'];

export type AuthState =
  | { status: 'unknown' }
  | { status: 'anonymous'; reason?: 'expired' | 'logout' }
  | { status: 'authenticated'; me: Me };

export type AuthResult = { ok: true } | { ok: false; problem: ProblemDetails };

/** Routes that authenticate by password or cookie: a 401 there is an answer, not a stale token. */
const AUTH_ROUTE = /^\/api\/v1\/auth\/(login|refresh|logout|password\/setup)$/;

/**
 * The browser side of ADR-0027: the access token lives only in memory, the refresh token in an
 * httpOnly cookie. A call that answers 401 triggers one shared refresh and is retried once. The
 * state is a tiny external store that React reads through useSyncExternalStore.
 */
export class AuthSession {
  readonly client: ApiClient;
  private token: string | null = null;
  private state: AuthState = { status: 'unknown' };
  private readonly listeners = new Set<() => void>();
  private refreshing: Promise<boolean> | null = null;
  private restoring: Promise<void> | null = null;
  private readonly send: (request: Request) => Promise<Response>;

  constructor(options: {
    baseUrl: string;
    fetch?: (request: Request) => Promise<Response>;
    randomUUID?: () => string;
  }) {
    this.send = options.fetch ?? ((request) => globalThis.fetch(request));
    this.client = createApiClient({
      baseUrl: options.baseUrl,
      fetch: (request) => this.fetchWithRefresh(request),
      getToken: () => this.token,
      randomUUID: options.randomUUID ?? randomUuid,
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AuthState => this.state;

  hasPermission(permission: Permission): boolean {
    return this.state.status === 'authenticated' && this.state.me.permissions.includes(permission);
  }

  /** Restores a session from the refresh cookie once per page load (StrictMode-safe). */
  restore(): Promise<void> {
    this.restoring ??= this.refresh().then((ok) => {
      if (!ok && this.state.status === 'unknown') this.update({ status: 'anonymous' });
    });
    return this.restoring;
  }

  /** `login`: the registered phone, or the login name of a record without a phone (ADR-0128). */
  async login(login: string, password: string): Promise<AuthResult> {
    const result = await this.client.POST('/api/v1/auth/login', { body: { login, password } });
    if (!result.data) return { ok: false, problem: problemOf(result.error) };
    this.token = result.data.accessToken;
    this.update({ status: 'authenticated', me: result.data.me });
    return { ok: true };
  }

  async setupPassword(login: string, code: string, newPassword: string): Promise<AuthResult> {
    const result = await this.client.POST('/api/v1/auth/password/setup', {
      body: { login, code, newPassword },
    });
    if (!result.data) return { ok: false, problem: problemOf(result.error) };
    this.token = result.data.accessToken;
    this.update({ status: 'authenticated', me: result.data.me });
    return { ok: true };
  }

  async logout(): Promise<void> {
    await this.client.POST('/api/v1/auth/logout').catch(() => undefined);
    this.signOut('logout');
  }

  async logoutAll(): Promise<void> {
    await this.client.POST('/api/v1/auth/logout-all').catch(() => undefined);
    this.signOut('logout');
  }

  /** Re-reads the caller (after an admin changed their own name, for example). */
  async reloadMe(): Promise<void> {
    const result = await this.client.GET('/api/v1/auth/me');
    if (result.data) this.update({ status: 'authenticated', me: result.data });
  }

  /** One refresh at a time; concurrent callers share it. */
  refresh(): Promise<boolean> {
    this.refreshing ??= this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefresh(): Promise<boolean> {
    const result = await this.client.POST('/api/v1/auth/refresh').catch(() => undefined);
    if (!result?.data) {
      this.signOut(this.state.status === 'authenticated' ? 'expired' : undefined);
      return false;
    }
    this.token = result.data.accessToken;
    if (this.state.status !== 'authenticated') {
      const me = await this.client.GET('/api/v1/auth/me');
      if (!me.data) {
        this.signOut();
        return false;
      }
      this.update({ status: 'authenticated', me: me.data });
    }
    return true;
  }

  private async fetchWithRefresh(request: Request): Promise<Response> {
    const retry = request.clone();
    const response = await this.send(request);
    if (response.status !== 401 || AUTH_ROUTE.test(new URL(request.url).pathname)) return response;
    if (!this.token || !(await this.refresh())) return response;
    retry.headers.set('authorization', `Bearer ${this.token}`);
    return this.send(retry);
  }

  private signOut(reason?: 'expired' | 'logout'): void {
    this.token = null;
    this.update(reason ? { status: 'anonymous', reason } : { status: 'anonymous' });
  }

  private update(state: AuthState): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
