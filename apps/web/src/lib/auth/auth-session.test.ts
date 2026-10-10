import { describe, expect, it } from 'vitest';
import { ADMIN_ME, json, mockApi, problem, TOKENS } from '@/test/render-app';
import { AuthSession } from './auth-session';
import { safeNext } from './next';

const session = (fetchMock: (request: Request) => Promise<Response>) =>
  new AuthSession({
    baseUrl: 'http://tugeel.test',
    fetch: fetchMock,
    randomUUID: () => 'id-1234-5678',
  });

describe('AuthSession', () => {
  it('restores from the refresh cookie and sends the access token', async () => {
    const fetchMock = mockApi({
      'POST /api/v1/auth/refresh': () => json(TOKENS),
      'GET /api/v1/auth/me': () => json(ADMIN_ME),
    });
    const auth = session(fetchMock);
    await auth.restore();
    expect(auth.getSnapshot()).toEqual({ status: 'authenticated', me: ADMIN_ME });
    const me = fetchMock.mock.calls.find(([request]) => request.url.endsWith('/auth/me'));
    expect(me?.[0].headers.get('authorization')).toBe(`Bearer ${TOKENS.accessToken}`);
    expect(auth.hasPermission('identity.users.manage')).toBe(true);
  });

  it('becomes anonymous without a cookie, and restore() runs once', async () => {
    const fetchMock = mockApi({ 'POST /api/v1/auth/refresh': () => problem('UNAUTHORIZED', 401) });
    const auth = session(fetchMock);
    await Promise.all([auth.restore(), auth.restore()]);
    expect(auth.getSnapshot()).toEqual({ status: 'anonymous' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refreshes once for concurrent 401s and retries each call with the new token', async () => {
    let refreshes = 0;
    const fetchMock = mockApi({
      'POST /api/v1/auth/login': () => json({ ...TOKENS, me: ADMIN_ME }),
      'POST /api/v1/auth/refresh': () => {
        refreshes += 1;
        return json({ ...TOKENS, accessToken: 'access-token-2' });
      },
      'GET /api/v1/users': (request) =>
        request.headers.get('authorization') === 'Bearer access-token-2'
          ? json({ data: [], nextCursor: null })
          : problem('UNAUTHORIZED', 401),
    });
    const auth = session(fetchMock);
    await auth.login('admin', 'pw');
    const results = await Promise.all([
      auth.client.GET('/api/v1/users'),
      auth.client.GET('/api/v1/users'),
    ]);
    expect(results.map((result) => result.response.status)).toEqual([200, 200]);
    expect(refreshes).toBe(1);
  });

  it('signs out as expired when the refresh fails during work', async () => {
    const fetchMock = mockApi({
      'POST /api/v1/auth/login': () => json({ ...TOKENS, me: ADMIN_ME }),
      'POST /api/v1/auth/refresh': () => problem('SESSION_EXPIRED', 401),
      'GET /api/v1/users': () => problem('UNAUTHORIZED', 401),
    });
    const auth = session(fetchMock);
    await auth.login('admin', 'pw');
    const result = await auth.client.GET('/api/v1/users');
    expect(result.response.status).toBe(401);
    expect(auth.getSnapshot()).toEqual({ status: 'anonymous', reason: 'expired' });
  });

  it('never retries the auth routes themselves', async () => {
    const fetchMock = mockApi({
      'POST /api/v1/auth/login': () => problem('INVALID_CREDENTIALS', 401),
    });
    const auth = session(fetchMock);
    const result = await auth.login('admin', 'wrong');
    expect(result).toMatchObject({ ok: false, problem: { code: 'INVALID_CREDENTIALS' } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('safeNext', () => {
  it('keeps same-site paths and drops anything else', () => {
    expect(safeNext('/users?q=a')).toBe('/users?q=a');
    for (const bad of ['//evil.test', '/\\evil.test', 'https://evil.test', '', null, undefined]) {
      expect(safeNext(bad)).toBe('/');
    }
  });
});
