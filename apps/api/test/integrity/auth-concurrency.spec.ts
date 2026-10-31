import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { login, refreshCookieOf, SAME_ORIGIN, seedUser, testIp } from '../harness/identity';

/** Session and lockout state stays consistent under concurrent requests (ADR-0027, ADR-0016). */
describe('integrity: authentication under concurrency', () => {
  let app: NestExpressApplication;
  let sql: Client;

  beforeAll(async () => {
    app = await createHttpApp();
    // A listening server so parallel supertest calls share one socket server.
    await app.listen(0, '127.0.0.1');
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('10 concurrent refreshes with one cookie rotate once and keep the session alive', async () => {
    const user = await seedUser(app);
    const { cookie } = await login(app, user);
    const server = app.getHttpServer();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(server).post('/api/v1/auth/refresh').set(SAME_ORIGIN).set('Cookie', cookie),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(200));
    const rotations = responses.map(refreshCookieOf).filter((value) => value !== '');
    expect(rotations).toHaveLength(1);
    const { rows } = await sql.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM auth_sessions WHERE user_id = $1',
      [user.id],
    );
    expect(rows).toEqual([{ revoked_at: null }]);
    await request(server)
      .post('/api/v1/auth/refresh')
      .set(SAME_ORIGIN)
      .set('Cookie', rotations[0] ?? '')
      .expect(200);
  });

  it('concurrent failed logins never lose a counter increment', async () => {
    const user = await seedUser(app);
    const server = app.getHttpServer();
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(server)
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', testIp())
          .send({ login: user.phone, password: 'wrong-password-1' }),
      ),
    );
    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(401));
    const { rows } = await sql.query<{ failed_login_count: number }>(
      'SELECT failed_login_count FROM users WHERE id = $1',
      [user.id],
    );
    expect(rows[0]?.failed_login_count).toBe(10);
  });
});
