import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { bearer, login, seedUser } from '../harness/identity';

interface GroupJson {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  sort: number;
}
interface AccountJson {
  code: string;
  name: string;
  id: number;
  kind: string;
  journal: string;
  currency: string;
  status: string;
  groupId: number | null;
}

/**
 * A chart with its tree in one call (ADR-0148): the groups under their parents, the accounts in
 * them, a posting key re-pointed, the old chart's account inactive, and the right. Synthetic data.
 */
describe('finance chart tree', () => {
  let app: NestExpressApplication;
  let admin: string;
  let office: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    await http().get('/api/v1/gl-accounts').set(bearer(admin)).expect(200);
  });
  afterAll(async () => {
    await app.close();
  });

  const body = {
    groups: [
      { code: 'T0', name: 'Төлөвлөгөө', parentCode: null, sort: 0 },
      { code: 'T5', name: 'Хөрөнгө', parentCode: 'T0', sort: 0 },
      { code: 'T15', name: 'Бараа', parentCode: 'T5', sort: 1 },
    ],
    accounts: [
      {
        code: 'T150101',
        name: 'Бараа материал',
        kind: 'ASSET',
        normalSide: 'DEBIT',
        control: 'NONE',
        groupCode: 'T15',
        key: 'OTHER_EXPENSE',
      },
    ],
    inactiveCodes: [] as string[],
  };

  it('saves the tree and the accounts, and moves the key', async () => {
    await http().post('/api/v1/gl-accounts/chart').set(bearer(office)).send(body).expect(403);
    const before = (await http().get('/api/v1/gl-accounts').set(bearer(admin)).expect(200))
      .body as AccountJson[];
    const old = before.find((row) => row.code === '730101');
    const result = await http()
      .post('/api/v1/gl-accounts/chart')
      .set(bearer(admin))
      .send({ ...body, inactiveCodes: old ? ['511030'] : [] })
      .expect(200);
    expect(result.body).toMatchObject({ created: 1, rulesMoved: ['OTHER_EXPENSE'] });

    const groups = (await http().get('/api/v1/gl-accounts/groups').set(bearer(admin)).expect(200))
      .body as GroupJson[];
    const top = groups.find((row) => row.code === 'T0');
    const middle = groups.find((row) => row.code === 'T5');
    const leaf = groups.find((row) => row.code === 'T15');
    expect(top?.parentId).toBeNull();
    expect(middle?.parentId).toBe(top?.id);
    expect(leaf).toMatchObject({ parentId: middle?.id, sort: 1 });

    const accounts = (await http().get('/api/v1/gl-accounts').set(bearer(admin)).expect(200))
      .body as AccountJson[];
    expect(accounts.find((row) => row.code === 'T150101')?.groupId).toBe(leaf?.id);
    expect(accounts.find((row) => row.code === '511030')?.status).toBe('INACTIVE');
  });

  it('keeps an account’s journal and currency, with the kind from its code (ADR-0149)', async () => {
    const made = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: '110999', name: 'Долларын данс', journal: 'BANK', currency: 'USD' })
      .expect(201);
    expect(made.body).toMatchObject({ kind: 'ASSET', journal: 'BANK', currency: 'USD' });
    const id = (made.body as AccountJson).id;
    const changed = await http()
      .put(`/api/v1/gl-accounts/${id}`)
      .set(bearer(admin))
      .send({ journal: 'GENERAL', currency: 'EUR' })
      .expect(200);
    expect(changed.body).toMatchObject({ journal: 'GENERAL', currency: 'EUR' });
    await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: 'ABC', name: 'Код буруу' })
      .expect(422);
    await http()
      .put(`/api/v1/gl-accounts/${id}`)
      .set(bearer(admin))
      .send({ currency: 'XXX' })
      .expect(422);
    // An automatic posting needs the receivable account to stay one.
    const all = (await http().get('/api/v1/gl-accounts').set(bearer(admin)).expect(200))
      .body as AccountJson[];
    const receivable = all.find((row) => row.code === '120101');
    if (!receivable) throw new Error('the seeded receivable account is missing');
    await http()
      .put(`/api/v1/gl-accounts/${receivable.id}`)
      .set(bearer(admin))
      .send({ journal: 'GENERAL' })
      .expect(422);
  });

  it('refuses a group whose parent is not above it', async () => {
    await http()
      .post('/api/v1/gl-accounts/chart')
      .set(bearer(admin))
      .send({
        groups: [{ code: 'TX', name: 'Буруу', parentCode: 'NONE-SUCH', sort: 0 }],
        accounts: [],
        inactiveCodes: [],
      })
      .expect(422);
  });
});
