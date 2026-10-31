import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { createAdmin } from '../../src/modules/identity/cli/create-admin';
import { connectAs, createHttpApp } from '../harness/apps';
import { TEST_PEPPER, testIp } from '../harness/identity';

/** `pnpm user:create-admin` bootstraps or recovers an admin without anyone knowing a password. */
describe('create-admin CLI', () => {
  let app: NestExpressApplication;
  let sql: Client;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('creates an ADMIN whose password is set with the printed one-time code', async () => {
    const db = app.get<Db>(DB);
    const first = await createAdmin(db, {
      phone: '9900 0099',
      fullName: 'Эзэн',
      pepper: TEST_PEPPER,
    });
    expect(first.created).toBe(true);
    expect(first.code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    const done = await request(app.getHttpServer())
      .post('/api/v1/auth/password/setup')
      .set('X-Forwarded-For', testIp())
      .send({ login: '99000099', code: first.code, newPassword: 'owner-password-1' })
      .expect(200);
    expect((done.body as { me: { roles: { code: string }[] } }).me.roles).toEqual([
      expect.objectContaining({ code: 'ADMIN' }),
    ]);
  });

  it('recovers an existing admin: active, unlocked, a fresh code', async () => {
    const db = app.get<Db>(DB);
    await sql.query(
      `UPDATE users SET status = 'DISABLED', locked_until = now() + interval '1 hour' WHERE phone = '+97699000099'`,
    );
    const again = await createAdmin(db, {
      phone: '99000099',
      fullName: 'Эзэн',
      pepper: TEST_PEPPER,
    });
    expect(again.created).toBe(false);
    const { rows } = await sql.query<{ status: string; locked_until: Date | null }>(
      `SELECT status, locked_until FROM users WHERE username = 'p99000099'`,
    );
    expect(rows).toEqual([{ status: 'ACTIVE', locked_until: null }]);
    const audit = await sql.query<{ action: string; actor_label: string }>(
      `SELECT action, actor_label FROM audit_log WHERE entity = 'users' ORDER BY id`,
    );
    expect(audit.rows).toContainEqual({
      action: 'ADMIN_RECOVERED',
      actor_label: 'cli:create-admin',
    });
    await expect(
      createAdmin(db, { username: 'Нэр', fullName: 'x', pepper: TEST_PEPPER }),
    ).rejects.toThrow('invalid username');
    await expect(
      createAdmin(db, { phone: '12', fullName: 'x', pepper: TEST_PEPPER }),
    ).rejects.toThrow('invalid phone');
    // An admin registered before ADR-0128 is still recovered by login name.
    const legacy = await createAdmin(db, {
      username: 'owner',
      fullName: 'Эзэн',
      pepper: TEST_PEPPER,
    });
    expect(legacy.created).toBe(true);
    expect(
      (await createAdmin(db, { username: 'Owner', fullName: 'Эзэн', pepper: TEST_PEPPER })).created,
    ).toBe(false);
  });
});
