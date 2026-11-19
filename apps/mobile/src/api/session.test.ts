import { describe, expect, it } from 'vitest';
import {
  type IdentityStore,
  REQUEST_TIMEOUT_MS,
  SLOW_REQUEST_TIMEOUT_MS,
  StaffSession,
  type StoredSession,
  timeoutFor,
  type TokenStore,
} from './session';

const SERVER = 'http://192.168.1.10:3300';
let uuids = 0;
const randomUUID = () => `00000000-0000-4000-8000-${String((uuids += 1)).padStart(12, '0')}`;
const ME = {
  id: 7,
  username: 'rep',
  phone: '+97699110007',
  fullName: 'Төлөөлөгч',
  permissions: ['sales.orders.rep'],
  roles: [],
  writableWarehouseIds: null,
  sessionStartedAt: '2026-10-15T12:00:00.000Z',
  sessionExpiresAt: '2026-10-16T00:00:00.000Z',
};

class MemoryStore implements TokenStore {
  value: StoredSession | null = null;
  saves = 0;
  load = () => Promise.resolve(this.value);
  save = (value: StoredSession) => {
    this.value = value;
    this.saves += 1;
    return Promise.resolve();
  };
  clear = () => {
    this.value = null;
    return Promise.resolve();
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A fake API: tokens rotate on refresh; `offline` throws like a dropped connection. */
class FakeServer {
  refreshToken = 'rt-1';
  access = 'at-1';
  refreshes = 0;
  offline = false;
  rejectRefresh = false;
  grace = false;
  /** Seconds the access token lives. */
  ttl = 900;
  now = 1_000_000;
  calls: string[] = [];

  fetch = async (request: Request): Promise<Response> => {
    const path = request.url.replace(SERVER, '');
    this.calls.push(path);
    if (this.offline) throw new TypeError('Network request failed');
    const tokens = () => ({
      accessToken: this.access,
      accessTokenExpiresAt: new Date(this.now + this.ttl * 1000).toISOString(),
      sessionExpiresAt: ME.sessionExpiresAt,
    });
    if (path === '/api/v1/auth/mobile/login') {
      const body = (await request.json()) as { password: string };
      if (body.password !== 'secret') return json(401, { code: 'INVALID_CREDENTIALS' });
      return json(200, { ...tokens(), me: ME, refreshToken: this.refreshToken });
    }
    if (path === '/api/v1/auth/mobile/refresh') {
      this.refreshes += 1;
      const body = (await request.json()) as { refreshToken: string };
      if (this.rejectRefresh || body.refreshToken !== this.refreshToken) {
        return json(401, { code: 'UNAUTHORIZED', params: { reason: 'REFRESH' } });
      }
      this.access = `at-${this.refreshes + 1}`;
      if (this.grace) return json(200, { ...tokens(), refreshToken: null });
      this.refreshToken = `rt-${this.refreshes + 1}`;
      return json(200, { ...tokens(), refreshToken: this.refreshToken });
    }
    if (path === '/api/v1/auth/mobile/logout') return new Response(null, { status: 204 });
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${this.access}`) return json(401, { code: 'UNAUTHORIZED' });
    if (path === '/api/v1/auth/me') return json(200, ME);
    return json(200, { ok: true });
  };
}

function setup() {
  const server = new FakeServer();
  const store = new MemoryStore();
  const session = new StaffSession({
    server: SERVER,
    store,
    fetch: server.fetch,
    randomUUID,
    now: () => server.now,
  });
  return { server, store, session };
}

describe('the staff app session (ADR-0061 #4)', () => {
  it('signs in, keeps the refresh token in the store and sends the access token', async () => {
    const { server, store, session } = setup();
    expect(await session.login('rep', 'wrong')).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(await session.login('rep', 'secret')).toBeNull();
    expect(store.value).toEqual({ server: SERVER, userId: 7, refreshToken: 'rt-1' });
    expect(session.getSnapshot()).toMatchObject({ status: 'signedIn', me: { id: 7 } });
    const me = await session.client.GET('/api/v1/auth/me');
    expect(me.data).toMatchObject({ id: 7 });
    expect(server.refreshes).toBe(0);
  });

  it('refreshes once for concurrent calls that found the token dead, then sends them again', async () => {
    const { server, store, session } = setup();
    await session.login('rep', 'secret');
    server.access = 'at-revoked';
    const results = await Promise.all([
      session.client.GET('/api/v1/auth/me'),
      session.client.GET('/api/v1/auth/me'),
      session.client.GET('/api/v1/auth/me'),
    ]);
    expect(results.every((result) => result.data !== undefined)).toBe(true);
    expect(server.refreshes).toBe(1);
    expect(store.value?.refreshToken).toBe('rt-2');
  });

  it('refreshes ahead of the access token’s end', async () => {
    const { server, session } = setup();
    await session.login('rep', 'secret');
    server.now += 890_000;
    await session.client.GET('/api/v1/auth/me');
    expect(server.refreshes).toBe(1);
    expect(server.calls.filter((call) => call === '/api/v1/auth/me')).toHaveLength(1);
  });

  it('keeps the stored token when the server answers within its grace window', async () => {
    const { server, store, session } = setup();
    await session.login('rep', 'secret');
    server.grace = true;
    server.access = 'at-revoked';
    await session.client.GET('/api/v1/auth/me');
    expect(store.value?.refreshToken).toBe('rt-1');
  });

  it('restores a stored session, offline without a connection, anonymous when refused', async () => {
    const first = setup();
    await first.session.login('rep', 'secret');
    const again = new StaffSession({
      server: SERVER,
      store: first.store,
      fetch: first.server.fetch,
      randomUUID,
      now: () => first.server.now,
    });
    await again.restore();
    expect(again.getSnapshot()).toMatchObject({ status: 'signedIn' });

    first.server.offline = true;
    const offline = new StaffSession({
      server: SERVER,
      store: first.store,
      fetch: first.server.fetch,
      randomUUID,
    });
    await offline.restore();
    expect(offline.getSnapshot()).toEqual({ status: 'offline' });
    expect(first.store.value).not.toBeNull();

    first.server.offline = false;
    first.server.rejectRefresh = true;
    const refused = new StaffSession({
      server: SERVER,
      store: first.store,
      fetch: first.server.fetch,
      randomUUID,
    });
    await refused.restore();
    expect(refused.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(first.store.value).toBeNull();
  });

  it('treats a server that never answers as no connection once the time limit passes', async () => {
    const first = setup();
    await first.session.login('rep', 'secret');
    const signals: AbortSignal[] = [];
    const silent = new StaffSession({
      server: SERVER,
      store: first.store,
      // Like OkHttp after a dropped packet: no answer and no error, not even on the abort.
      fetch: (_request, init) => {
        signals.push(init.signal);
        return new Promise<Response>(() => undefined);
      },
      randomUUID,
      timeoutMs: 20,
    });
    await silent.restore();
    expect(silent.getSnapshot()).toEqual({ status: 'offline' });
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
    expect(first.store.value).not.toBeNull();
  });

  it('gives the calls that wait for a model or the background service their own long limit (ADR-0199)', () => {
    expect(timeoutFor('/api/v1/sales-rep/products')).toBe(REQUEST_TIMEOUT_MS);
    expect(timeoutFor('/api/v1/product-registrations')).toBe(REQUEST_TIMEOUT_MS);
    expect(timeoutFor('/api/v1/product-registrations/ai')).toBe(REQUEST_TIMEOUT_MS);
    expect(timeoutFor('/api/v1/product-registrations/ai/read')).toBe(SLOW_REQUEST_TIMEOUT_MS);
    expect(timeoutFor('/api/v1/product-registrations/ai/image')).toBe(SLOW_REQUEST_TIMEOUT_MS);
    // A test's short limit does not shorten them: they are long by design.
    expect(timeoutFor('/api/v1/product-registrations/ai/read', 20)).toBe(SLOW_REQUEST_TIMEOUT_MS);
    expect(timeoutFor('/api/v1/auth/me', 20)).toBe(20);
  });

  it('ignores a session stored for another server', async () => {
    const { store, server } = setup();
    store.value = { server: 'http://10.0.0.1:3300', userId: 7, refreshToken: 'rt-1' };
    const session = new StaffSession({ server: SERVER, store, fetch: server.fetch, randomUUID });
    await session.restore();
    expect(session.getSnapshot()).toEqual({ status: 'anonymous' });
  });

  it('hands the live stock stream a fresh token, refreshed near its end or once refused (ADR-0173)', async () => {
    const { server, store, session } = setup();
    expect(await session.streamToken()).toBeNull();
    await session.login('rep', 'secret');
    expect(await session.streamToken()).toBe('at-1');
    expect(server.refreshes).toBe(0);
    server.now += 890_000;
    expect(await session.streamToken()).toBe('at-2');
    expect(server.refreshes).toBe(1);
    // The server refused at-2: one refresh; a token another call already replaced is not refreshed.
    expect(await session.streamToken('at-2')).toBe('at-3');
    expect(await session.streamToken('at-2')).toBe('at-3');
    expect(server.refreshes).toBe(2);

    server.offline = true;
    expect(await session.streamToken('at-3')).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ status: 'signedIn' });
    server.offline = false;
    server.rejectRefresh = true;
    expect(await session.streamToken('at-3')).toBeNull();
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(store.value).toBeNull();
  });

  it('logs out even without a connection: the stored token goes', async () => {
    const { server, store, session } = setup();
    await session.login('rep', 'secret');
    server.offline = true;
    await session.logout();
    expect(store.value).toBeNull();
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', reason: 'logout' });
  });
});

class MemoryIdentity implements IdentityStore {
  values = new Map<string, unknown>();
  load = (server: string, userId: number) =>
    Promise.resolve(this.values.get(`${server}:${userId}`) ?? null);
  save = (server: string, userId: number, me: unknown) => {
    this.values.set(`${server}:${userId}`, me);
    return Promise.resolve();
  };
  clear = (server: string, userId: number) => {
    this.values.delete(`${server}:${userId}`);
    return Promise.resolve();
  };
}

/** Timers the test fires by hand: the delays asked for, and the one waiting. */
class ManualTimers {
  delays: number[] = [];
  waiting: (() => void) | null = null;
  set = (run: () => void, ms: number) => {
    this.delays.push(ms);
    this.waiting = run;
    return this.delays.length;
  };
  clear = () => {
    this.waiting = null;
  };
  async fire() {
    const run = this.waiting;
    this.waiting = null;
    run?.();
    // Let the try again settle.
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe('opening without the server (staff app, owner 2026-11-19)', () => {
  function withIdentity() {
    const base = setup();
    const identity = new MemoryIdentity();
    const timers = new ManualTimers();
    const make = () =>
      new StaffSession({
        server: SERVER,
        store: base.store,
        fetch: base.server.fetch,
        randomUUID,
        now: () => base.server.now,
        identity,
        setTimer: timers.set,
        clearTimer: timers.clear,
      });
    return { ...base, identity, timers, make };
  }

  it('keeps who signed in, opens from it without an answer and goes online once answered', async () => {
    const { server, identity, timers, make } = withIdentity();
    const first = make();
    await first.login('rep', 'secret');
    expect(identity.values.get(`${SERVER}:7`)).toMatchObject({ id: 7 });

    server.offline = true;
    const offline = make();
    await offline.restore();
    expect(offline.getSnapshot()).toMatchObject({
      status: 'signedIn',
      userId: 7,
      offline: true,
      me: { id: 7, permissions: ['sales.orders.rep'] },
    });
    expect(timers.delays).toEqual([30_000]);

    // Still nothing: the waits grow, to two minutes at most.
    await timers.fire();
    await timers.fire();
    await timers.fire();
    expect(timers.delays).toEqual([30_000, 60_000, 120_000, 120_000]);
    expect(offline.getSnapshot()).toMatchObject({ offline: true });

    server.offline = false;
    await timers.fire();
    expect(offline.getSnapshot()).toEqual({ status: 'signedIn', me: expect.anything(), userId: 7 });
    expect(timers.waiting).toBeNull();
  });

  it('shows the offline page without a stored identity, as before', async () => {
    const { server, identity, make } = withIdentity();
    await make().login('rep', 'secret');
    identity.values.clear();
    server.offline = true;
    const offline = make();
    await offline.restore();
    expect(offline.getSnapshot()).toEqual({ status: 'offline' });
  });

  it('goes to the sign-in when the server answers that the session is over', async () => {
    const { server, store, identity, timers, make } = withIdentity();
    await make().login('rep', 'secret');
    server.offline = true;
    const offline = make();
    await offline.restore();
    server.offline = false;
    server.rejectRefresh = true;
    await timers.fire();
    expect(offline.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(store.value).toBeNull();
    expect(identity.values.size).toBe(0);
  });

  it('turns offline when a call finds no connection, and back once any call is answered', async () => {
    const { server, timers, make } = withIdentity();
    const session = make();
    await session.login('rep', 'secret');
    server.offline = true;
    await expect(session.client.GET('/api/v1/auth/me')).rejects.toThrow();
    expect(session.getSnapshot()).toMatchObject({ status: 'signedIn', offline: true });
    expect(timers.delays).toEqual([30_000]);

    server.offline = false;
    await session.client.GET('/api/v1/auth/me');
    await session.reconnect();
    expect(session.getSnapshot()).toEqual({ status: 'signedIn', me: expect.anything(), userId: 7 });
  });

  it('stops trying once disposed (another server chosen)', async () => {
    const { server, timers, make } = withIdentity();
    await make().login('rep', 'secret');
    server.offline = true;
    const offline = make();
    await offline.restore();
    offline.dispose();
    expect(timers.waiting).toBeNull();
  });
});
