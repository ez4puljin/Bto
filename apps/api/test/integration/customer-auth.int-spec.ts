import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import {
  appAccountApi,
  appStore,
  sessionOf,
  STORE_PASSWORD,
  storeApi,
  storeAuth,
  uniquePhone,
} from '../harness/customer-app';
import { bearer, login, seedUser, testIp } from '../harness/identity';
import { partnersApi } from '../harness/partners';

interface AccountJson {
  id: number;
  phone: string;
  status: string;
  passwordSet: boolean;
  codeExpiresAt: string | null;
  lastSignInAt: string | null;
}

/** Customer app accounts, codes, sign-in and sessions (ADR-0079 #2, #3, #11; ADR-0082). */
describe('customer app sign-in (ADR-0079)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let office: string;
  let warehouse: string;
  const http = () => request(app.getHttpServer());
  const auth = () => storeAuth(app);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    warehouse = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  const newCustomer = (name: string) =>
    partnersApi(app, office).customer({ name, address: { address: 'Мөрөн' } });

  it('links one phone to one store, and only the office may', async () => {
    const accounts = appAccountApi(app, office);
    const first = await newCustomer('Нэг утас');
    const second = await newCustomer('Хоёр дахь дэлгүүр');
    expect((await accounts.get(first.id).expect(200)).body).toEqual({ account: null });
    const phone = uniquePhone();
    const linked = (await accounts.link(first.id, phone.slice(4)).expect(200)).body as AccountJson;
    expect(linked).toMatchObject({ phone, status: 'ACTIVE', passwordSet: false });
    // The same phone again changes nothing; another store cannot take it.
    expect(((await accounts.link(first.id, phone).expect(200)).body as AccountJson).id).toBe(
      linked.id,
    );
    const taken = await accounts.link(second.id, phone).expect(409);
    expect(taken.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'customer_users_phone_key' },
    });
    await accounts.link(second.id, '12345').expect(422);
    await appAccountApi(app, warehouse).link(second.id, uniquePhone()).expect(403);
    await appAccountApi(app, warehouse).get(second.id).expect(403);
    await accounts.get(999_999).expect(404);
  });

  it('redeems the office code once, signs in and answers like the native routes', async () => {
    const customer = await newCustomer('Кодтой дэлгүүр');
    const phone = uniquePhone();
    const accounts = appAccountApi(app, office);
    await accounts.link(customer.id, phone).expect(200);
    const issued = await accounts.code(customer.id).expect(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    const code = (issued.body as { code: string }).code;
    expect(code).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);
    expect(
      ((await accounts.get(customer.id)).body as { account: AccountJson }).account,
    ).toMatchObject({ codeExpiresAt: expect.any(String) });
    // A wrong code, a weak password and a browser are refused.
    await auth().setup(phone, 'AAAAA-AAAAA', STORE_PASSWORD).expect(400);
    await auth().setup(phone, code, 'short').expect(422);
    await http()
      .post('/api/v1/auth/customer/password/setup')
      .set('Origin', 'http://tugeel.test')
      .send({ phone, code, newPassword: STORE_PASSWORD })
      .expect(403);
    const response = await auth().setup(phone.slice(4), code, STORE_PASSWORD).expect(200);
    expect(response.headers['set-cookie']).toBeUndefined();
    const session = sessionOf(response);
    expect(session.refreshToken).toMatch(/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
    expect(session.account).toMatchObject({ customerId: customer.id, phone });
    // Used once only.
    await auth().setup(phone, code, 'another-pass-9').expect(400);
    const signedIn = await auth().login(phone, STORE_PASSWORD).expect(200);
    expect(sessionOf(signedIn).account.id).toBe(session.account.id);
    await storeApi(app, session.accessToken).get('/me').expect(200);
    const rows = await sql.query<{ actor_kind: string; actor_id: string }>(
      `SELECT actor_kind, actor_id::text FROM audit_log
        WHERE action = 'LOGIN' AND entity = 'auth_sessions' AND actor_kind = 'CUSTOMER'`,
    );
    expect(rows.rows.map((row) => row.actor_id)).toContain(String(session.account.id));
  });

  it('keeps a code to five attempts', async () => {
    const customer = await newCustomer('Таван оролдлого');
    const phone = uniquePhone();
    const accounts = appAccountApi(app, office);
    await accounts.link(customer.id, phone).expect(200);
    const code = await accounts.issueCode(customer.id);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth().setup(phone, 'ZZZZZ-ZZZZZ', STORE_PASSWORD).expect(400);
    }
    await auth().setup(phone, code, STORE_PASSWORD).expect(400);
    const fresh = await accounts.issueCode(customer.id);
    await auth().setup(phone, fresh, STORE_PASSWORD).expect(200);
  });

  it('rotates the refresh token and moves the session end with every use', async () => {
    const store = await appStore(app, office);
    await sql.query(
      `UPDATE auth_sessions SET expires_at = now() + interval '1 day' WHERE customer_user_id = $1`,
      [store.session.account.id],
    );
    const rotated = await auth().refresh(store.session.refreshToken).expect(200);
    const body = rotated.body as { refreshToken: string; sessionExpiresAt: string };
    expect(body.refreshToken).not.toBe(store.session.refreshToken);
    expect(new Date(body.sessionExpiresAt).getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    // A retry within 20 s keeps the stored token; a later replay is theft.
    const racing = await auth().refresh(store.session.refreshToken).expect(200);
    expect((racing.body as { refreshToken: string | null }).refreshToken).toBeNull();
    await sql.query(
      `UPDATE auth_sessions SET rotated_at = now() - interval '1 minute' WHERE customer_user_id = $1`,
      [store.session.account.id],
    );
    await auth().refresh(store.session.refreshToken).expect(401);
    const revoked = await sql.query<{ revoked_reason: string }>(
      'SELECT revoked_reason FROM auth_sessions WHERE customer_user_id = $1',
      [store.session.account.id],
    );
    expect(revoked.rows.map((row) => row.revoked_reason)).toContain('TOKEN_REUSE');
  });

  it('ends a session after 90 days without use and at sign-out', async () => {
    const store = await appStore(app, office);
    await auth().logout(store.session.refreshToken).expect(204);
    await auth().refresh(store.session.refreshToken).expect(401);
    await store.api.get('/me').expect(401);
    const again = sessionOf(await auth().login(store.phone, STORE_PASSWORD).expect(200));
    await sql.query(
      `UPDATE auth_sessions SET created_at = now() - interval '100 days',
              expires_at = now() - interval '1 second' WHERE id = $1`,
      [again.refreshToken.split('.')[0]],
    );
    const expired = await auth().refresh(again.refreshToken).expect(401);
    expect(expired.body).toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('keeps the two kinds of token on their own routes', async () => {
    const store = await appStore(app, office);
    const staff = await http().get('/api/v1/auth/me').set(bearer(store.token)).expect(403);
    expect(staff.body).toMatchObject({ code: 'FORBIDDEN', params: { reason: 'CUSTOMER_TOKEN' } });
    await http().get('/api/v1/customers').set(bearer(store.token)).expect(403);
    const customerRoute = await storeApi(app, office).get('/me').expect(403);
    expect(customerRoute.body).toMatchObject({ params: { reason: 'STAFF_TOKEN' } });
    // A customer refresh token never refreshes a staff session, nor the other way round.
    await http()
      .post('/api/v1/auth/mobile/refresh')
      .send({ refreshToken: store.session.refreshToken })
      .expect(401);
    const user = await seedUser(app, { roles: ['SALES_REP'] });
    const staffLogin = await http()
      .post('/api/v1/auth/mobile/login')
      .set('X-Forwarded-For', testIp())
      .send({ username: user.username, password: user.password })
      .expect(200);
    await auth()
      .refresh((staffLogin.body as { refreshToken: string }).refreshToken)
      .expect(401);
    // A staff logout with a customer token is ignored; the customer session lives on.
    await http()
      .post('/api/v1/auth/mobile/logout')
      .send({ refreshToken: store.session.refreshToken })
      .expect(204);
    await store.api.get('/me').expect(200);
  });

  it('closes and reopens the app, and an inactive customer cannot sign in', async () => {
    const store = await appStore(app, office);
    const accounts = appAccountApi(app, office);
    const closed = (await accounts.disable(store.customerId).expect(200)).body as AccountJson;
    expect(closed.status).toBe('DISABLED');
    await store.api.get('/me').expect(401);
    expect((await auth().login(store.phone, STORE_PASSWORD).expect(403)).body).toMatchObject({
      code: 'ACCOUNT_DISABLED',
    });
    await accounts.code(store.customerId).expect(403);
    await accounts.enable(store.customerId).expect(200);
    const session = sessionOf(await auth().login(store.phone, STORE_PASSWORD).expect(200));
    await partnersApi(app, office)
      .http()
      .patch(`/api/v1/customers/${store.customerId}`)
      .set(bearer(office))
      .send({ status: 'INACTIVE' })
      .expect(200);
    await storeApi(app, session.accessToken).get('/me').expect(401);
    await auth().refresh(session.refreshToken).expect(401);
    expect((await auth().login(store.phone, STORE_PASSWORD).expect(403)).body).toMatchObject({
      code: 'ACCOUNT_DISABLED',
    });
    expect((await accounts.code(store.customerId).expect(409)).body).toMatchObject({
      code: 'CUSTOMER_INACTIVE',
    });
    await accounts.enable(store.customerId).expect(409);
    const reasons = await sql.query<{ revoked_reason: string }>(
      `SELECT DISTINCT revoked_reason FROM auth_sessions
        WHERE customer_user_id = $1 AND revoked_reason IS NOT NULL`,
      [store.session.account.id],
    );
    expect(reasons.rows.map((row) => row.revoked_reason).sort()).toEqual([
      'ACCOUNT_DISABLED',
      'CUSTOMER_INACTIVE',
    ]);
  });

  it('a new phone signs every phone out and needs a new code', async () => {
    const store = await appStore(app, office);
    const accounts = appAccountApi(app, office);
    const next = uniquePhone();
    const changed = (await accounts.link(store.customerId, next).expect(200)).body as AccountJson;
    expect(changed).toMatchObject({ phone: next, passwordSet: false });
    await store.api.get('/me').expect(401);
    await auth().login(store.phone, STORE_PASSWORD).expect(401);
    await auth().login(next, STORE_PASSWORD).expect(401);
    const code = await accounts.issueCode(store.customerId);
    await auth().setup(next, code, STORE_PASSWORD).expect(200);
  });

  it('changes the password with the current one and signs the other phones out', async () => {
    const store = await appStore(app, office);
    const other = sessionOf(await auth().login(store.phone, STORE_PASSWORD).expect(200));
    await http()
      .post('/api/v1/auth/customer/password')
      .set(bearer(store.token))
      .send({ currentPassword: 'wrong-pass-1', newPassword: 'shine-nuuts-9' })
      .expect(400);
    await http()
      .post('/api/v1/auth/customer/password')
      .set(bearer(store.token))
      .send({ currentPassword: STORE_PASSWORD, newPassword: 'shine-nuuts-9' })
      .expect(204);
    await store.api.get('/me').expect(200);
    await storeApi(app, other.accessToken).get('/me').expect(401);
    await auth().login(store.phone, 'shine-nuuts-9').expect(200);
  });

  it('counts failed sign-ins per address and phone, apart from staff', async () => {
    const store = await appStore(app, office);
    const ip = testIp();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth().login(store.phone, 'bad-password-1', ip).expect(401);
    }
    const blocked = await auth().login(store.phone, STORE_PASSWORD, ip).expect(429);
    expect(blocked.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // Staff behind the same address are not affected.
    const user = await seedUser(app);
    await login(app, user, ip);
    await auth().login(uniquePhone(), STORE_PASSWORD).expect(401);
  });

  it('lists and filters customers by their app account', async () => {
    const store = await appStore(app, office, { name: 'Апптай дэлгүүр' });
    const plain = await newCustomer('Аппгүй дэлгүүр');
    const list = async (query: Record<string, string>) =>
      (
        (await http().get('/api/v1/customers').query(query).set(bearer(office)).expect(200))
          .body as { data: { id: number; appAccount: string | null }[] }
      ).data;
    const withApp = await list({ app: 'ACTIVE' });
    expect(withApp.map((row) => row.id)).toContain(store.customerId);
    expect(withApp.map((row) => row.id)).not.toContain(plain.id);
    const without = await list({ app: 'NONE' });
    expect(without.map((row) => row.id)).toContain(plain.id);
    expect(without.map((row) => row.id)).not.toContain(store.customerId);
    const all = await list({ q: 'дэлгүүр' });
    expect(all.find((row) => row.id === store.customerId)?.appAccount).toBe('ACTIVE');
    expect(all.find((row) => row.id === plain.id)?.appAccount).toBeNull();
    await http().get('/api/v1/customers').query({ app: 'MAYBE' }).set(bearer(office)).expect(422);
  });
});
