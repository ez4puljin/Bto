import { Controller, Get } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PERMISSIONS } from '@tugeel/shared/auth';
import type { Client } from 'pg';
import request from 'supertest';
import { RequirePermission } from '../../src/modules/identity';
import { connectAs, createHttpApp } from '../harness/apps';
import {
  bearer,
  DEFAULT_PASSWORD,
  issueCode,
  login,
  refreshCookieOf,
  SAME_ORIGIN,
  seedUser,
  testIp,
} from '../harness/identity';

@Controller('probe')
class ProbeController {
  /** No access decorator at all: the guard must refuse it (fail closed). */
  @Get('undeclared')
  undeclared() {
    return { ok: true };
  }

  @Get('users-manage')
  @RequirePermission('identity.users.manage')
  manage() {
    return { ok: true };
  }
}

describe('authentication (ADR-0027)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp({ controllers: [ProbeController] });
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  describe('login', () => {
    it('returns an access token and the caller, and sets a strict httpOnly refresh cookie', async () => {
      const admin = await seedUser(app, { roles: ['ADMIN'] });
      const { response } = await login(app, admin);
      expect(response.headers['cache-control']).toBe('no-store');
      const body = response.body as Record<string, unknown> & { me: Record<string, unknown> };
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.me).toMatchObject({ id: admin.id, username: admin.username });
      expect([...(body.me.permissions as string[])].sort()).toEqual([...PERMISSIONS].sort());
      expect(body.me.writableWarehouseIds).toBeNull();
      const cookie = (response.headers['set-cookie'] as unknown as string[])[0] ?? '';
      expect(cookie).toMatch(/^tugeel_rt=[0-9a-f-]{36}\.[A-Za-z0-9_-]{43};/);
      expect(cookie).toContain('Path=/api/v1/auth');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).not.toContain('Secure');
      const maxAge = Number.parseInt(/Max-Age=(\d+)/.exec(cookie)?.[1] ?? '0', 10);
      expect(maxAge).toBeGreaterThan(12 * 3600 - 60);
      expect(maxAge).toBeLessThanOrEqual(12 * 3600);
    });

    it('answers wrong password, unknown user and a user without password identically', async () => {
      const user = await seedUser(app);
      const noPassword = await seedUser(app, { password: null });
      const attempts = [
        { username: user.username, password: 'wrong-password-1' },
        { username: 'nobody.here', password: 'whatever-123' },
        { username: noPassword.username, password: 'whatever-123' },
      ];
      for (const body of attempts) {
        const response = await http()
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', testIp())
          .send(body)
          .expect(401);
        expect(response.body).toMatchObject({ code: 'INVALID_CREDENTIALS', status: 401 });
        expect(response.body).not.toHaveProperty('params');
      }
    });

    it('reveals a disabled account only to a caller with the right password', async () => {
      const user = await seedUser(app, { status: 'DISABLED' });
      await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, password: 'wrong-password-1' })
        .expect(401);
      const response = await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, password: DEFAULT_PASSWORD })
        .expect(403);
      expect(response.body).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    });

    it('makes one IP wait after 5 failures for a username, without affecting other IPs', async () => {
      const user = await seedUser(app);
      const ip = testIp();
      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ username: user.username, password: 'wrong-password-1' })
          .expect(401);
      }
      const blocked = await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ username: user.username, password: DEFAULT_PASSWORD })
        .expect(429);
      expect(blocked.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
      expect(
        (blocked.body as { params: { retryAfterSeconds: number } }).params.retryAfterSeconds,
      ).toBeGreaterThan(0);
      await login(app, user);
    });

    it('locks the account after 20 consecutive failures until it expires or an admin unlocks', async () => {
      const user = await seedUser(app);
      await sql.query('UPDATE users SET failed_login_count = 19 WHERE id = $1', [user.id]);
      await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, password: 'wrong-password-1' })
        .expect(401);
      const locked = await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, password: DEFAULT_PASSWORD })
        .expect(423);
      expect(locked.body).toMatchObject({ code: 'ACCOUNT_LOCKED' });
      await sql.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [
        user.id,
      ]);
      await login(app, user);
      const { rows } = await sql.query<{ failed_login_count: number }>(
        'SELECT failed_login_count FROM users WHERE id = $1',
        [user.id],
      );
      expect(rows[0]?.failed_login_count).toBe(0);
    });

    it('accepts JSON bodies only, so a cross-site form cannot log anyone in', async () => {
      const user = await seedUser(app);
      await http()
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', testIp())
        .type('form')
        .send({ username: user.username, password: DEFAULT_PASSWORD })
        .expect(422);
    });
  });

  describe('access control on every request', () => {
    it('requires a valid bearer token and refuses routes without an access rule', async () => {
      const admin = await seedUser(app, { roles: ['ADMIN'] });
      const { accessToken } = await login(app, admin);
      await http().get('/api/v1/auth/me').expect(401);
      await http().get('/api/v1/auth/me').set(bearer('not-a-jwt')).expect(401);
      await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(200);
      const undeclared = await http()
        .get('/api/v1/probe/undeclared')
        .set(bearer(accessToken))
        .expect(403);
      expect(undeclared.body).toMatchObject({
        code: 'FORBIDDEN',
        params: { reason: 'NO_ACCESS_RULE' },
      });
      await http().get('/health').expect(200);
    });

    it('checks permissions: a warehouse worker is refused, an admin passes', async () => {
      const worker = await seedUser(app, { roles: ['WAREHOUSE'] });
      const admin = await seedUser(app, { roles: ['ADMIN'] });
      const workerToken = (await login(app, worker)).accessToken;
      const refused = await http()
        .get('/api/v1/probe/users-manage')
        .set(bearer(workerToken))
        .expect(403);
      expect(refused.body).toMatchObject({
        code: 'FORBIDDEN',
        params: { reason: 'PERMISSION', permission: 'identity.users.manage' },
      });
      const adminToken = (await login(app, admin)).accessToken;
      await http().get('/api/v1/probe/users-manage').set(bearer(adminToken)).expect(200);
    });

    it('applies revocation and role changes on the very next request', async () => {
      const user = await seedUser(app, { roles: ['ADMIN'] });
      const { accessToken } = await login(app, user);
      await http().get('/api/v1/probe/users-manage').set(bearer(accessToken)).expect(200);
      await sql.query('DELETE FROM user_roles WHERE user_id = $1', [user.id]);
      await http().get('/api/v1/probe/users-manage').set(bearer(accessToken)).expect(403);
      await sql.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [user.id]);
      await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(401);
    });

    it('reports scopes as writable warehouses including TRANSIT', async () => {
      const { rows } = await sql.query<{ id: string }>(
        `INSERT INTO branches (code, name) VALUES ('AUTH-B', 'Салбар') RETURNING id`,
      );
      const branchId = Number.parseInt(rows[0]?.id ?? '0', 10);
      const wh = await sql.query<{ id: string }>(
        `INSERT INTO warehouses (code, name, kind, branch_id) VALUES ('AUTH-W', 'Агуулах', 'STORE', $1) RETURNING id`,
        [branchId],
      );
      const warehouseId = Number.parseInt(wh.rows[0]?.id ?? '0', 10);
      const transit = await sql.query<{ id: string }>(
        `SELECT id FROM warehouses WHERE kind = 'TRANSIT'`,
      );
      const scoped = await seedUser(app, { roles: ['WAREHOUSE'], branchIds: [branchId] });
      const scopedToken = (await login(app, scoped)).accessToken;
      const me = await http().get('/api/v1/auth/me').set(bearer(scopedToken)).expect(200);
      expect((me.body as { writableWarehouseIds: number[] }).writableWarehouseIds).toEqual(
        [warehouseId, Number.parseInt(transit.rows[0]?.id ?? '0', 10)].sort((a, b) => a - b),
      );
    });
  });

  describe('refresh', () => {
    it('rotates the token, keeps the session end fixed and tolerates a racing tab for 20 s', async () => {
      const user = await seedUser(app);
      const first = await login(app, user);
      const before = await sql.query<{ expires_at: Date }>(
        'SELECT expires_at FROM auth_sessions WHERE user_id = $1',
        [user.id],
      );
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .set(SAME_ORIGIN)
        .set('Cookie', first.cookie)
        .expect(200);
      const second = refreshCookieOf(rotated);
      expect(second).not.toBe('');
      expect(second).not.toBe(first.cookie);
      expect((rotated.body as { accessToken: string }).accessToken).toEqual(expect.any(String));
      const racing = await http()
        .post('/api/v1/auth/refresh')
        .set(SAME_ORIGIN)
        .set('Cookie', first.cookie)
        .expect(200);
      expect(racing.headers['set-cookie']).toBeUndefined();
      const after = await sql.query<{ expires_at: Date }>(
        'SELECT expires_at FROM auth_sessions WHERE user_id = $1',
        [user.id],
      );
      expect(after.rows[0]?.expires_at.getTime()).toBe(before.rows[0]?.expires_at.getTime());
      await http().post('/api/v1/auth/refresh').set(SAME_ORIGIN).set('Cookie', second).expect(200);
    });

    it('revokes the session when an old token is replayed after the grace window', async () => {
      const user = await seedUser(app);
      const first = await login(app, user);
      const rotated = await http()
        .post('/api/v1/auth/refresh')
        .set(SAME_ORIGIN)
        .set('Cookie', first.cookie)
        .expect(200);
      await sql.query(
        `UPDATE auth_sessions SET rotated_at = now() - interval '30 seconds' WHERE user_id = $1`,
        [user.id],
      );
      await http()
        .post('/api/v1/auth/refresh')
        .set(SAME_ORIGIN)
        .set('Cookie', first.cookie)
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .set(SAME_ORIGIN)
        .set('Cookie', refreshCookieOf(rotated))
        .expect(401);
      const { rows } = await sql.query<{ revoked_reason: string }>(
        'SELECT revoked_reason FROM auth_sessions WHERE user_id = $1',
        [user.id],
      );
      expect(rows).toEqual([{ revoked_reason: 'TOKEN_REUSE' }]);
      const audit = await sql.query(
        `SELECT 1 FROM audit_log WHERE action = 'TOKEN_REUSE' AND entity = 'auth_sessions'`,
      );
      expect(audit.rows.length).toBeGreaterThan(0);
    });

    it('ends with SESSION_EXPIRED after the session lifetime', async () => {
      const user = await seedUser(app);
      const { cookie } = await login(app, user);
      await sql.query(
        `UPDATE auth_sessions SET expires_at = created_at + interval '1 millisecond' WHERE user_id = $1`,
        [user.id],
      );
      const response = await http()
        .post('/api/v1/auth/refresh')
        .set(SAME_ORIGIN)
        .set('Cookie', cookie)
        .expect(401);
      expect(response.body).toMatchObject({ code: 'SESSION_EXPIRED' });
    });

    it('refuses cookie routes from a foreign or missing Origin', async () => {
      const user = await seedUser(app);
      const { cookie } = await login(app, user);
      for (const origin of ['http://evil.test', undefined]) {
        const call = http()
          .post('/api/v1/auth/refresh')
          .set('Host', 'tugeel.test')
          .set('Cookie', cookie);
        const response = await (origin ? call.set('Origin', origin) : call).expect(403);
        expect(response.body).toMatchObject({ params: { reason: 'ORIGIN' } });
      }
    });
  });

  describe('logout', () => {
    it('revokes the session at once and clears the cookie', async () => {
      const user = await seedUser(app);
      const { accessToken, cookie } = await login(app, user);
      const response = await http()
        .post('/api/v1/auth/logout')
        .set(SAME_ORIGIN)
        .set('Cookie', cookie)
        .expect(204);
      expect(String(response.headers['set-cookie'])).toContain('tugeel_rt=;');
      await http().get('/api/v1/auth/me').set(bearer(accessToken)).expect(401);
    });

    it('signs out every device with logout-all', async () => {
      const user = await seedUser(app);
      const phone = await login(app, user);
      const desk = await login(app, user);
      await http().post('/api/v1/auth/logout-all').set(bearer(desk.accessToken)).expect(204);
      await http().get('/api/v1/auth/me').set(bearer(phone.accessToken)).expect(401);
      await http().get('/api/v1/auth/me').set(bearer(desk.accessToken)).expect(401);
    });
  });

  describe('passwords', () => {
    it('changes the password, keeping this session and ending the others', async () => {
      const user = await seedUser(app);
      const phone = await login(app, user);
      const desk = await login(app, user);
      const wrong = await http()
        .post('/api/v1/auth/password')
        .set(bearer(desk.accessToken))
        .send({ currentPassword: 'not-it-123', newPassword: 'brand-new-pass-1' })
        .expect(400);
      expect(wrong.body).toMatchObject({ code: 'CURRENT_PASSWORD_INCORRECT' });
      const weak = await http()
        .post('/api/v1/auth/password')
        .set(bearer(desk.accessToken))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'short' })
        .expect(422);
      expect(weak.body).toMatchObject({ code: 'PASSWORD_TOO_WEAK', params: { minLength: 8 } });
      await http()
        .post('/api/v1/auth/password')
        .set(bearer(desk.accessToken))
        .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'brand-new-pass-1' })
        .expect(204);
      await http().get('/api/v1/auth/me').set(bearer(desk.accessToken)).expect(200);
      await http().get('/api/v1/auth/me').set(bearer(phone.accessToken)).expect(401);
      await login(app, { username: user.username, password: 'brand-new-pass-1' });
    });

    it('lets a user set a password with a one-time code, once', async () => {
      const user = await seedUser(app, { password: null });
      const code = await issueCode(app, user.id);
      const setup = (body: Record<string, string>) =>
        http().post('/api/v1/auth/password/setup').set('X-Forwarded-For', testIp()).send(body);
      const weak = await setup({
        username: user.username,
        code,
        newPassword: user.username,
      }).expect(422);
      expect(weak.body).toMatchObject({ code: 'PASSWORD_TOO_WEAK' });
      const done = await setup({
        username: user.username,
        code: code.toLowerCase(),
        newPassword: 'my-own-password-1',
      }).expect(200);
      expect((done.body as { me: { id: number } }).me.id).toBe(user.id);
      expect(refreshCookieOf(done)).not.toBe('');
      const { rows } = await sql.query<{ signed_in: boolean }>(
        'SELECT last_login_at IS NOT NULL AS signed_in FROM users WHERE id = $1',
        [user.id],
      );
      expect(rows[0]?.signed_in).toBe(true);
      const again = await setup({
        username: user.username,
        code,
        newPassword: 'another-pass-2',
      }).expect(400);
      expect(again.body).toMatchObject({ code: 'PASSWORD_CODE_INVALID' });
      await login(app, { username: user.username, password: 'my-own-password-1' });
    });

    it('burns a code after 5 wrong attempts, expires it, and replaces it on re-issue', async () => {
      const user = await seedUser(app, { password: null });
      const code = await issueCode(app, user.id);
      for (let i = 0; i < 5; i += 1) {
        await http()
          .post('/api/v1/auth/password/setup')
          .set('X-Forwarded-For', testIp())
          .send({ username: user.username, code: 'AAAAA-AAAAA', newPassword: 'my-own-password-1' })
          .expect(400);
      }
      await http()
        .post('/api/v1/auth/password/setup')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, code, newPassword: 'my-own-password-1' })
        .expect(400);
      const replaced = await issueCode(app, user.id);
      const fresh = await issueCode(app, user.id);
      await http()
        .post('/api/v1/auth/password/setup')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, code: replaced, newPassword: 'my-own-password-1' })
        .expect(400);
      await sql.query(
        `UPDATE password_resets SET expires_at = created_at + interval '1 millisecond'
          WHERE user_id = $1 AND used_at IS NULL AND revoked_at IS NULL`,
        [user.id],
      );
      await http()
        .post('/api/v1/auth/password/setup')
        .set('X-Forwarded-For', testIp())
        .send({ username: user.username, code: fresh, newPassword: 'my-own-password-1' })
        .expect(400);
    });
  });
});
