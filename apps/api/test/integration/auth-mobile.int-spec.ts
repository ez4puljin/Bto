import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { bearer, DEFAULT_PASSWORD, seedUser, testIp } from '../harness/identity';
import { mobileLogin } from '../harness/mobile';

interface TokensJson {
  accessToken: string;
  accessTokenExpiresAt: string;
  sessionExpiresAt: string;
  refreshToken: string | null;
}

/** The staff app's token routes (ADR-0061 #4): the refresh token in the body, never a cookie. */
describe('native-client authentication (ADR-0061)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  const http = () => request(app.getHttpServer());
  const refresh = (refreshToken: string) =>
    http().post('/api/v1/auth/mobile/refresh').send({ refreshToken });

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('signs in with the refresh token in the body and no cookie', async () => {
    const user = await seedUser(app, { roles: ['SALES_REP'] });
    const { response, refreshToken, accessToken } = await mobileLogin(app, user);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(response.body).toMatchObject({ me: { id: user.id, username: user.username } });
    await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
  });

  it('rotates the token, keeps the session end and answers a racing retry without a new token', async () => {
    const user = await seedUser(app);
    const first = await mobileLogin(app, user);
    const rotated = await refresh(first.refreshToken).expect(200);
    const body = rotated.body as TokensJson;
    expect(rotated.headers['set-cookie']).toBeUndefined();
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.refreshToken).not.toBe(first.refreshToken);
    expect(body.sessionExpiresAt).toBe(
      (first.response.body as { sessionExpiresAt: string }).sessionExpiresAt,
    );
    // A lost answer retried within 20 s: a new access token, the stored refresh token stays.
    const racing = await refresh(first.refreshToken).expect(200);
    expect((racing.body as TokensJson).refreshToken).toBeNull();
    expect((racing.body as TokensJson).accessToken).toEqual(expect.any(String));
    await refresh(body.refreshToken ?? '').expect(200);
    // The profile tells when the session signed in (ADR-0066): a rotation never moves it.
    const signedIn = (first.response.body as { me: { sessionStartedAt: string } }).me
      .sessionStartedAt;
    expect(Date.parse(signedIn)).toBeLessThan(Date.parse(body.sessionExpiresAt));
    const me = (await http().get('/api/v1/auth/me').set(bearer(body.accessToken)).expect(200))
      .body as { sessionStartedAt: string; sessionExpiresAt: string };
    expect(me).toEqual(
      expect.objectContaining({
        sessionStartedAt: signedIn,
        sessionExpiresAt: body.sessionExpiresAt,
      }),
    );
  });

  it('revokes the session when an old token comes back after the grace window', async () => {
    const user = await seedUser(app);
    const first = await mobileLogin(app, user);
    const rotated = (await refresh(first.refreshToken).expect(200)).body as TokensJson;
    await sql.query(
      `UPDATE auth_sessions SET rotated_at = now() - interval '30 seconds' WHERE user_id = $1`,
      [user.id],
    );
    const reused = await refresh(first.refreshToken).expect(401);
    expect(reused.body).toMatchObject({ code: 'UNAUTHORIZED', params: { reason: 'REFRESH' } });
    await refresh(rotated.refreshToken ?? '').expect(401);
    const { rows } = await sql.query<{ revoked_reason: string }>(
      'SELECT revoked_reason FROM auth_sessions WHERE user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ revoked_reason: 'TOKEN_REUSE' }]);
  });

  it('logs out the one device: the token and the access token stop working', async () => {
    const user = await seedUser(app);
    const phone = await mobileLogin(app, user);
    const other = await mobileLogin(app, user);
    await http()
      .post('/api/v1/auth/mobile/logout')
      .send({ refreshToken: phone.refreshToken })
      .expect(204);
    await refresh(phone.refreshToken).expect(401);
    await http().get('/api/v1/auth/me').set(bearer(phone.accessToken)).expect(401);
    await refresh(other.refreshToken).expect(200);
    // Logging out an unknown or already revoked token changes nothing and still answers 204.
    await http()
      .post('/api/v1/auth/mobile/logout')
      .send({ refreshToken: phone.refreshToken })
      .expect(204);
  });

  it('ends with SESSION_EXPIRED after the session lifetime', async () => {
    const user = await seedUser(app);
    const { refreshToken } = await mobileLogin(app, user);
    await sql.query(
      `UPDATE auth_sessions SET created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
        WHERE user_id = $1`,
      [user.id],
    );
    const response = await refresh(refreshToken).expect(401);
    expect(response.body).toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('refuses every native route to a browser (any Origin)', async () => {
    const user = await seedUser(app);
    const { refreshToken } = await mobileLogin(app, user);
    const origin = 'http://tugeel.test';
    const calls = [
      () =>
        http()
          .post('/api/v1/auth/mobile/login')
          .set('X-Forwarded-For', testIp())
          .send({ username: user.username, password: DEFAULT_PASSWORD }),
      () => http().post('/api/v1/auth/mobile/refresh').send({ refreshToken }),
      () => http().post('/api/v1/auth/mobile/logout').send({ refreshToken }),
    ];
    for (const call of calls) {
      const response = await call().set('Origin', origin).set('Host', 'tugeel.test').expect(403);
      expect(response.body).toMatchObject({ params: { reason: 'ORIGIN' } });
    }
    await refresh(refreshToken).expect(200);
  });

  it('takes the token from the body only: a cookie alone or an unknown field is refused', async () => {
    const user = await seedUser(app);
    const { refreshToken } = await mobileLogin(app, user);
    const noBody = await http()
      .post('/api/v1/auth/mobile/refresh')
      .set('Cookie', `tugeel_rt=${refreshToken}`)
      .send({});
    expect(noBody.status).toBe(422);
    await http()
      .post('/api/v1/auth/mobile/refresh')
      .send({ refreshToken, client: 'android' })
      .expect(422);
    await http()
      .post('/api/v1/auth/mobile/login')
      .set('X-Forwarded-For', testIp())
      .send({ username: user.username, password: DEFAULT_PASSWORD, device: 'phone' })
      .expect(422);
    await refresh('not-a-token').expect(401);
  });

  it('applies the login limiter: one address waits after 5 failures for a username', async () => {
    const user = await seedUser(app);
    const ip = testIp();
    for (let i = 0; i < 5; i += 1) {
      await http()
        .post('/api/v1/auth/mobile/login')
        .set('X-Forwarded-For', ip)
        .send({ username: user.username, password: 'wrong-password-1' })
        .expect(401);
    }
    const blocked = await http()
      .post('/api/v1/auth/mobile/login')
      .set('X-Forwarded-For', ip)
      .send({ username: user.username, password: DEFAULT_PASSWORD })
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });
});
