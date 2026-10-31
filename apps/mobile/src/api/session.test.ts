import { describe, expect, it } from 'vitest';
import { StaffSession, type StoredSession, type TokenStore } from './session';

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

  it('ignores a session stored for another server', async () => {
    const { store, server } = setup();
    store.value = { server: 'http://10.0.0.1:3300', userId: 7, refreshToken: 'rt-1' };
    const session = new StaffSession({ server: SERVER, store, fetch: server.fetch, randomUUID });
    await session.restore();
    expect(session.getSnapshot()).toEqual({ status: 'anonymous' });
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
