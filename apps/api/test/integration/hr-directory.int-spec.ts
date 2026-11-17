import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { appStore } from '../harness/customer-app';
import { bearer, login, seedUser } from '../harness/identity';

interface EntryJson {
  userId: number;
  displayName: string;
  fullName: string;
  position: string | null;
  divisionName: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
}

/**
 * «Манайхан» on the staff app: every signed-in staff member reads the employed colleagues with
 * their position, division and phone, finds them by name, position, division or phone, and never
 * sees one who left nor anything private; a customer token and nobody signed in are refused.
 * Synthetic data.
 */
describe('hr directory', () => {
  let app: NestExpressApplication;
  let hr: string;
  let admin: string;
  let plain: string;
  let enkhtuya: number;
  let gone: number;
  const http = () => request(app.getHttpServer());
  const today = businessDate();

  const register = async (body: {
    firstName: string;
    lastName: string;
    phone: string;
    position: string | null;
    divisionId: number | null;
  }): Promise<number> => {
    const created = await http()
      .post('/api/v1/hr/staff')
      .set(bearer(hr))
      .set(idempotency())
      .send({
        ...body,
        employmentType: 'PERMANENT',
        gender: 'FEMALE',
        employedOn: null,
        scheduleId: null,
        password: 'Tsagaan-2026',
      })
      .expect(201);
    return (created.body as { userId: number }).userId;
  };

  const directory = async (token: string, q?: string): Promise<EntryJson[]> =>
    (
      await http()
        .get('/api/v1/hr/directory')
        .query(q === undefined ? {} : { q })
        .set(bearer(token))
        .expect(200)
    ).body as EntryJson[];

  beforeAll(async () => {
    app = await createHttpApp();
    hr = (await login(app, await seedUser(app, { roles: ['HR'] }))).accessToken;
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    // A staff member without any role: the directory is open to every signed-in employee.
    plain = (await login(app, await seedUser(app))).accessToken;
    const division = await http()
      .post('/api/v1/hr/divisions')
      .set(bearer(hr))
      .send({ name: 'Борлуулалт', sort: 1 })
      .expect(201);
    const divisionId = (division.body as { id: number }).id;
    enkhtuya = await register({
      firstName: 'Энхтуяа',
      lastName: 'Ганбат',
      phone: '89383719',
      position: 'Борлуулалтын менежер',
      divisionId,
    });
    gone = await register({
      firstName: 'Сарнай',
      lastName: 'Дорж',
      phone: '89383720',
      position: 'Нярав',
      divisionId: null,
    });
    await http()
      .put(`/api/v1/hr/staff/${gone}/left`)
      .set(bearer(hr))
      .send({ leftOn: today, reason: null })
      .expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists the employed colleagues to a staff member without roles, nothing private', async () => {
    const rows = await directory(plain);
    const found = rows.find((row) => row.userId === enkhtuya);
    expect(found).toEqual({
      userId: enkhtuya,
      displayName: 'Г. Энхтуяа',
      fullName: 'Ганбат Энхтуяа',
      position: 'Борлуулалтын менежер',
      divisionName: 'Борлуулалт',
      phone: '+97689383719',
      email: null,
      photoUrl: null,
    });
    // One who left is not a colleague any more.
    expect(rows.map((row) => row.userId)).not.toContain(gone);
    for (const key of ['birthDate', 'roles', 'district', 'status', 'leftOn', 'children']) {
      expect(rows[0]).not.toHaveProperty(key);
    }
  });

  it('finds a colleague by name, position, division or phone', async () => {
    const ids = async (q: string) => (await directory(plain, q)).map((row) => row.userId);
    expect(await ids('энхтуяа')).toEqual([enkhtuya]);
    expect(await ids('enkhtuya')).toEqual([enkhtuya]);
    expect(await ids('менежер')).toEqual([enkhtuya]);
    expect(await ids('борлуулалт')).toEqual([enkhtuya]);
    expect(await ids('8938')).toEqual([enkhtuya]);
    // The one who left stays out of a search for her too.
    expect(await ids('сарнай')).toEqual([]);
  });

  it('refuses a customer token and a caller not signed in', async () => {
    const store = await appStore(app, admin);
    await http().get('/api/v1/hr/directory').set(bearer(store.token)).expect(403);
    await http().get('/api/v1/hr/directory').expect(401);
  });
});
