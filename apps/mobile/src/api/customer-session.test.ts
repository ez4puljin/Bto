import { describe, expect, it } from 'vitest';
import { CustomerSession, type StoredSession, type TokenStore } from './session';

const SERVER = 'http://192.168.0.100:3301';
let uuids = 0;
const randomUUID = () => `00000000-0000-4000-8000-${String((uuids += 1)).padStart(12, '0')}`;
const ACCOUNT = {
  id: 12,
  customerId: 40,
  phone: '+97699112233',
  sessionStartedAt: '2026-10-19T02:00:00.000Z',
  sessionExpiresAt: '2027-01-17T02:00:00.000Z',
};
const STORE = {
  customerId: 40,
  code: '1',
  name: 'Номин дэлгүүр',
  phone: '+97699112233',
  centre: { branchName: 'Оргил Бөөний төв', warehouses: ['Төв агуулах'] },
  defaultAddress: { id: 3, label: null, address: 'Мөрөн, 5-р баг' },
  paymentTermDays: 30,
  ordersOpen: true,
  today: '2026-10-19',
};

class MemoryStore implements TokenStore {
  value: StoredSession | null = null;
  load = () => Promise.resolve(this.value);
  save = (value: StoredSession) => {
    this.value = value;
    return Promise.resolve();
  };
  clear = () => {
    this.value = null;
    return Promise.resolve();
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The customer routes of CA2 (ADR-0082) as far as the session uses them. */
class FakeServer {
  refreshToken = 'rt-1';
  access = 'at-1';
  refreshes = 0;
  offline = false;
  /** «Аппыг хаах»: the office closed the app; refresh and the store's routes answer 403. */
  disabled = false;
  grace = false;
  code = '7KQ2M-X9D4F';
  password = 'delguur-nuuts-9';
  now = 1_000_000;
  calls: string[] = [];

  fetch = async (request: Request): Promise<Response> => {
    const path = request.url.replace(SERVER, '');
    this.calls.push(path);
    if (this.offline) throw new TypeError('Network request failed');
    const tokens = () => ({
      accessToken: this.access,
      accessTokenExpiresAt: new Date(this.now + 900_000).toISOString(),
      sessionExpiresAt: ACCOUNT.sessionExpiresAt,
    });
    if (path === '/api/v1/auth/customer/login') {
      const body = (await request.json()) as { phone: string; password: string };
      if (body.password !== this.password) return json(401, { code: 'INVALID_CREDENTIALS' });
      if (this.disabled) return json(403, { code: 'ACCOUNT_DISABLED' });
      return json(200, { ...tokens(), refreshToken: this.refreshToken, account: ACCOUNT });
    }
    if (path === '/api/v1/auth/customer/password/setup') {
      const body = (await request.json()) as { code: string; newPassword: string };
      if (body.newPassword.length < 8) {
        return json(422, { code: 'PASSWORD_TOO_WEAK', params: { problem: 'TOO_SHORT' } });
      }
      if (body.code !== this.code) return json(400, { code: 'PASSWORD_CODE_INVALID' });
      this.password = body.newPassword;
      return json(200, { ...tokens(), refreshToken: this.refreshToken, account: ACCOUNT });
    }
    if (path === '/api/v1/auth/customer/refresh') {
      this.refreshes += 1;
      const body = (await request.json()) as { refreshToken: string };
      if (this.disabled) return json(403, { code: 'ACCOUNT_DISABLED' });
      if (body.refreshToken !== this.refreshToken) return json(401, { code: 'UNAUTHORIZED' });
      this.access = `at-${this.refreshes + 1}`;
      if (this.grace) return json(200, { ...tokens(), refreshToken: null });
      this.refreshToken = `rt-${this.refreshes + 1}`;
      return json(200, { ...tokens(), refreshToken: this.refreshToken });
    }
    if (path === '/api/v1/auth/customer/logout') return new Response(null, { status: 204 });
    if (request.headers.get('authorization') !== `Bearer ${this.access}`) {
      return json(401, { code: 'UNAUTHORIZED' });
    }
    if (this.disabled) return json(403, { code: 'ACCOUNT_DISABLED' });
    if (path === '/api/v1/customer-app/me') return json(200, STORE);
    return json(200, { ok: true });
  };
}

function setup() {
  const server = new FakeServer();
  const store = new MemoryStore();
  const session = new CustomerSession({
    server: SERVER,
    store,
    fetch: server.fetch,
    randomUUID,
    now: () => server.now,
  });
  return { server, store, session };
}

describe('the store’s session in «Bto300» (ADR-0079 #3, ADR-0082)', () => {
  it('signs in with the phone, keys the stored session on the app account and reads the store', async () => {
    const { server, store, session } = setup();
    expect(await session.login('99112233', 'wrong')).toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(await session.login('99112233', 'delguur-nuuts-9')).toBeNull();
    expect(store.value).toEqual({ server: SERVER, userId: 12, refreshToken: 'rt-1' });
    expect(session.getSnapshot()).toEqual({
      status: 'signedIn',
      userId: 12,
      me: { accountId: 12, store: STORE },
    });
    expect(server.calls).toContain('/api/v1/customer-app/me');
  });

  it('sets the password with the office’s code and is signed in', async () => {
    const { store, session } = setup();
    expect(await session.setupPassword('99112233', '7KQ2M-X9D4F', 'short')).toMatchObject({
      code: 'PASSWORD_TOO_WEAK',
    });
    expect(await session.setupPassword('99112233', 'AAAAA-BBBBB', 'shine-nuuts-1')).toMatchObject({
      code: 'PASSWORD_CODE_INVALID',
    });
    expect(store.value).toBeNull();
    expect(await session.setupPassword('99112233', '7KQ2M-X9D4F', 'shine-nuuts-1')).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ status: 'signedIn', userId: 12 });
    expect(await session.login('99112233', 'shine-nuuts-1')).toBeNull();
  });

  it('refreshes once for a dead access token and keeps the stored token in the grace window', async () => {
    const { server, store, session } = setup();
    await session.login('99112233', 'delguur-nuuts-9');
    server.access = 'at-revoked';
    const results = await Promise.all([
      session.client.GET('/api/v1/customer-app/me'),
      session.client.GET('/api/v1/customer-app/me'),
    ]);
    expect(results.every((result) => result.data !== undefined)).toBe(true);
    expect(server.refreshes).toBe(1);
    expect(store.value?.refreshToken).toBe('rt-2');
    server.grace = true;
    server.access = 'at-revoked-again';
    await session.client.GET('/api/v1/customer-app/me');
    expect(store.value?.refreshToken).toBe('rt-2');
  });

  it('restores a stored session, offline without a connection, anonymous once the office closed the app', async () => {
    const first = setup();
    await first.session.login('99112233', 'delguur-nuuts-9');
    const make = () =>
      new CustomerSession({
        server: SERVER,
        store: first.store,
        fetch: first.server.fetch,
        randomUUID,
        now: () => first.server.now,
      });
    const again = make();
    await again.restore();
    expect(again.getSnapshot()).toMatchObject({ status: 'signedIn', me: { accountId: 12 } });

    first.server.offline = true;
    const offline = make();
    await offline.restore();
    expect(offline.getSnapshot()).toEqual({ status: 'offline' });
    expect(first.store.value).not.toBeNull();

    first.server.offline = false;
    first.server.disabled = true;
    const closed = make();
    await closed.restore();
    expect(closed.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
    expect(first.store.value).toBeNull();
  });

  it('never refreshes on a 403 and logs out without a connection', async () => {
    const { server, store, session } = setup();
    await session.login('99112233', 'delguur-nuuts-9');
    server.disabled = true;
    const result = await session.client.GET('/api/v1/customer-app/me');
    expect(result.response.status).toBe(403);
    expect(server.refreshes).toBe(0);
    server.offline = true;
    await session.logout();
    expect(store.value).toBeNull();
    expect(session.getSnapshot()).toEqual({ status: 'anonymous', reason: 'logout' });
  });

  it('is offline, not signed out, when the store could not be read right after signing in', async () => {
    const { server, store } = setup();
    const original = server.fetch;
    server.fetch = async (request) => {
      if (request.url.endsWith('/api/v1/customer-app/me')) throw new TypeError('dropped');
      return original(request);
    };
    const flaky = new CustomerSession({
      server: SERVER,
      store,
      fetch: (request) => server.fetch(request),
      randomUUID,
      now: () => server.now,
    });
    expect(await flaky.login('99112233', 'delguur-nuuts-9')).toBeNull();
    expect(flaky.getSnapshot()).toEqual({ status: 'offline' });
    expect(store.value).toMatchObject({ userId: 12 });
  });
});
