import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { appAccountApi, appStore, STORE_PASSWORD, uniquePhone } from '../harness/customer-app';
import { login, seedUser, testIp } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/**
 * The customer app's races (ADR-0079 #3): one office code redeemed once however many phones try
 * it at the same moment; parallel refreshes of one token; and the database guards of the new
 * tables (migration 0031).
 */
describe('customer app concurrency and guards', () => {
  let app: NestExpressApplication;
  let asApp: Client;
  let office: string;

  beforeAll(async () => {
    app = await createHttpApp();
    // A listening server, so parallel supertest calls share one socket server.
    await app.listen(0, '127.0.0.1');
    asApp = await connectAs('app');
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
  });
  afterAll(async () => {
    await asApp.end();
    await app.close();
  });

  it('redeems one code once when ten phones send it together', async () => {
    const customer = await partnersApi(app, office).customer({ name: 'Зэрэг код' });
    const phone = uniquePhone();
    const accounts = appAccountApi(app, office);
    await accounts.link(customer.id, phone).expect(200);
    const code = await accounts.issueCode(customer.id);
    const server = app.getHttpServer();
    const answers = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        request(server)
          .post('/api/v1/auth/customer/password/setup')
          .set('X-Forwarded-For', testIp())
          .send({ phone, code, newPassword: `${STORE_PASSWORD}-${index}` }),
      ),
    );
    const statuses = answers.map((answer) => answer.status).sort();
    expect(statuses).toEqual([200, ...Array(9).fill(400)]);
    const sessions = await asApp.query<{ live: string }>(
      `SELECT count(*) FILTER (WHERE s.revoked_at IS NULL) AS live
         FROM auth_sessions s JOIN customer_users cu ON cu.id = s.customer_user_id
        WHERE cu.customer_id = $1`,
      [customer.id],
    );
    expect(sessions.rows[0]?.live).toBe('1');
    const codes = await asApp.query<{ used: string }>(
      `SELECT count(*) FILTER (WHERE c.used_at IS NOT NULL) AS used
         FROM customer_password_codes c JOIN customer_users cu ON cu.id = c.customer_user_id
        WHERE cu.customer_id = $1`,
      [customer.id],
    );
    expect(codes.rows[0]?.used).toBe('1');
  });

  it('answers ten parallel refreshes of one token without ending the session', async () => {
    const store = await appStore(app, office);
    const server = app.getHttpServer();
    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(server)
          .post('/api/v1/auth/customer/refresh')
          .send({ refreshToken: store.session.refreshToken }),
      ),
    );
    expect(answers.map((answer) => answer.status)).toEqual(Array(10).fill(200));
    const rotated = answers.filter(
      (answer) => (answer.body as { refreshToken: string | null }).refreshToken !== null,
    );
    expect(rotated).toHaveLength(1);
    const session = await asApp.query<{ revoked_at: Date | null }>(
      'SELECT revoked_at FROM auth_sessions WHERE customer_user_id = $1',
      [store.session.account.id],
    );
    expect(session.rows.map((row) => row.revoked_at)).toEqual([null]);
  });

  it('keeps accounts, notifications and reads as the migration guards them', async () => {
    const store = await appStore(app, office);
    const id = store.session.account.id;
    expect(await sqlStateOf(asApp.query('DELETE FROM customer_users WHERE id = $1', [id]))).toBe(
      '42501',
    );
    for (const table of [
      'customer_users',
      'customer_password_codes',
      'customer_favourites',
      'company_contacts',
      'customer_notifications',
      'app_notice_customer_reads',
    ]) {
      expect(await sqlStateOf(asApp.query(`TRUNCATE ${table}`))).toBe('42501');
    }
    expect(
      await sqlStateOf(asApp.query("UPDATE customer_notifications SET kind = 'ORDER_SOLD'")),
    ).toBe('42501');
    expect(await sqlStateOf(asApp.query('DELETE FROM customer_notifications'))).toBe('42501');
    expect(await sqlStateOf(asApp.query('UPDATE customer_notifications SET read_at = now()'))).toBe(
      undefined,
    );
    expect(await sqlStateOf(asApp.query('DELETE FROM app_notice_customer_reads'))).toBe('42501');
    expect(await sqlStateOf(asApp.query('UPDATE customer_favourites SET created_at = now()'))).toBe(
      '42501',
    );
    // The principal of a session matches its kind; an app order names the store's account.
    expect(
      await sqlStateOf(
        asApp.query(
          `INSERT INTO auth_sessions (kind, customer_user_id, user_id, token_hash, expires_at)
           VALUES ('CUSTOMER', $1, NULL, 'x', now() + interval '1 day'),
                  ('STAFF', $1, NULL, 'y', now() + interval '1 day')`,
          [id],
        ),
      ),
    ).toBe('23514');
  });
});
