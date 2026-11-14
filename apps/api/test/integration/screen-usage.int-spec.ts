import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import { USAGE } from '@tugeel/shared/usage';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { appStore } from '../harness/customer-app';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';

interface UsageJson {
  app: string;
  screen: string;
  opens: number;
  seconds: number;
  people: number;
}

/**
 * Which screens are used (ADR-0197): every client's counts are added up per day, client and
 * screen, «how many people» is answered beside «how many times», and only the audit's reader sees
 * the figures.
 */
describe('screen usage', () => {
  let app: NestExpressApplication;
  let admin: string;
  let dulam: string;
  let bold: string;
  const http = () => request(app.getHttpServer());
  const today = businessDate();
  const send = (token: string, body: object) =>
    http().post('/api/v1/usage/screens').set(bearer(token)).send(body);
  const summary = async (token = admin) =>
    (
      await http()
        .get('/api/v1/usage/screens')
        .query({ from: today, to: today })
        .set(bearer(token))
        .expect(200)
    ).body.data as UsageJson[];
  const row = (rows: UsageJson[], appName: string, screen: string) =>
    rows.find((entry) => entry.app === appName && entry.screen === screen);

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    dulam = await customRoleUser(app, admin, ['reports.view']);
    bold = await customRoleUser(app, admin, ['reports.view']);
  });

  afterAll(async () => {
    await app.close();
  });

  it('adds up what the clients send, and counts the people apart from the opens', async () => {
    const work = { screen: '/sales/work', opens: 3, seconds: 90 };
    await send(dulam, { app: 'web', events: [work, { screen: '/', opens: 1, seconds: 5 }] }).expect(
      204,
    );
    await send(dulam, { app: 'web', events: [work] }).expect(204);
    await send(bold, { app: 'web', events: [{ ...work, opens: 1, seconds: 10 }] }).expect(204);
    await send(bold, {
      app: 'staff',
      events: [{ screen: '/order/:id', opens: 2, seconds: 40 }],
    }).expect(204);

    const rows = await summary();
    expect(row(rows, 'web', '/sales/work')).toEqual({
      app: 'web',
      screen: '/sales/work',
      opens: 7,
      seconds: 190,
      people: 2,
    });
    expect(row(rows, 'web', '/')).toMatchObject({ opens: 1, people: 1 });
    expect(row(rows, 'staff', '/order/:id')).toMatchObject({ opens: 2, seconds: 40, people: 1 });
    // The busiest first.
    expect(rows[0]?.screen).toBe('/sales/work');
  });

  it('cuts a tab left open back to the time a screen can be used', async () => {
    await send(dulam, {
      app: 'web',
      events: [{ screen: '/forgotten', opens: 1, seconds: 30_000 }],
    }).expect(204);
    expect(row(await summary(), 'web', '/forgotten')?.seconds).toBe(USAGE.maxSecondsPerOpen);
  });

  it('refuses a name that is not a screen, and too many at once', async () => {
    const bad = (screen: string) =>
      send(dulam, { app: 'web', events: [{ screen, opens: 1, seconds: 1 }] });
    await bad('/catalog/products?q=1').expect(422);
    await bad('catalog').expect(422);
    await bad(`/${'a'.repeat(USAGE.screenMax)}`).expect(422);
    await send(dulam, { app: 'pos', events: [{ screen: '/x', opens: 1, seconds: 1 }] }).expect(422);
    await send(dulam, { app: 'web', events: [] }).expect(422);
    const many = Array.from({ length: USAGE.maxEvents + 1 }, (_, i) => ({
      screen: `/s-${i}`,
      opens: 1,
      seconds: 1,
    }));
    await send(dulam, { app: 'web', events: many }).expect(422);
  });

  it('counts the stores app under its own routes, and never from a staff token', async () => {
    const store = await appStore(app, admin);
    await store.api
      .post('/usage/screens', {
        // Whatever the body names, a customer token counts for «Bto300».
        app: 'web',
        events: [{ screen: '/cart', opens: 4, seconds: 60 }],
      })
      .expect(204);
    await send(dulam, {
      app: 'customer',
      events: [{ screen: '/cart', opens: 50, seconds: 60 }],
    }).expect(204);
    const rows = await summary();
    expect(row(rows, 'customer', '/cart')).toMatchObject({ opens: 4, seconds: 60, people: 1 });
    expect(row(rows, 'web', '/cart')).toBeUndefined();
    // A customer token does not reach the staff route, nor a staff token the app's.
    await http()
      .post('/api/v1/usage/screens')
      .set(bearer(store.token))
      .send({ app: 'web', events: [{ screen: '/x', opens: 1, seconds: 1 }] })
      .expect(403);
    await http()
      .post('/api/v1/customer-app/usage/screens')
      .set(bearer(dulam))
      .send({ app: 'customer', events: [{ screen: '/x', opens: 1, seconds: 1 }] })
      .expect(403);
  });

  it('shows the figures to the audit reader only, and to nobody signed out', async () => {
    await http()
      .get('/api/v1/usage/screens')
      .query({ from: today, to: today })
      .set(bearer(dulam))
      .expect(403);
    await http().get('/api/v1/usage/screens').query({ from: today, to: today }).expect(401);
    await http()
      .post('/api/v1/usage/screens')
      .send({ app: 'web', events: [{ screen: '/x', opens: 1, seconds: 1 }] })
      .expect(401);
    await http()
      .get('/api/v1/usage/screens')
      .query({ from: 'yesterday', to: today })
      .set(bearer(admin))
      .expect(422);
  });
});
