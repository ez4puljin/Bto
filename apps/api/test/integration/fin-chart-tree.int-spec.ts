import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { FinChartService } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { codeOf } from '../harness/fin-intake';
import { bearer, login, seedUser } from '../harness/identity';
import { createFinanceCoreOnly, StaticCaller, TEST_COMPANY } from '../harness/static-caller';

interface GroupJson {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
  sort: number;
  status: string;
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
  balance: string;
}
interface ProblemJson {
  code: string;
  errors?: { path: string; constraint: string }[];
}

/**
 * A chart with its tree in one call (ADR-0148): the groups under their parents, the accounts in
 * them, a posting key re-pointed, the old chart's account inactive, and the right. Synthetic data.
 */
describe('finance chart tree', () => {
  let app: NestExpressApplication;
  let admin: string;
  let office: string;
  let accountant: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
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
  // ---------------------------------------------------------------- groups by hand (ADR-0239)

  /** A code no earlier run of this suite used. */
  const run = Date.now().toString(36).slice(-5).toUpperCase();
  /** Six digits for an account code no earlier run used. */
  let stamps = 0;
  const stamp = () => ((Date.now() + (stamps += 1)) % 1_000_000).toString().padStart(6, '0');
  const groupsNow = async () =>
    (await http().get('/api/v1/gl-accounts/groups').set(bearer(admin)).expect(200))
      .body as GroupJson[];
  const accountsNow = async () =>
    (await http().get('/api/v1/gl-accounts').set(bearer(admin)).expect(200)).body as AccountJson[];
  const makeGroup = async (code: string, name: string, parentId: number | null) =>
    (
      await http()
        .post('/api/v1/gl-accounts/groups')
        .set(bearer(admin))
        .send({ code, name, parentId })
        .expect(201)
    ).body as GroupJson;
  const refusal = (body: unknown) => {
    const problem = body as ProblemJson;
    return `${problem.code} ${problem.errors?.[0]?.path ?? ''} ${problem.errors?.[0]?.constraint ?? ''}`;
  };

  it('makes, renames, moves and deletes a group, with each refusal and the audit', async () => {
    const top = await makeGroup(`H${run}`, 'Ерөнхий удирдлагын зардал', null);
    expect(top).toMatchObject({ parentId: null, status: 'ACTIVE' });
    const power = await makeGroup(`H${run}1`, 'Тог', top.id);
    const water = await makeGroup(`H${run}2`, 'Ус', top.id);
    // Each new group goes after its siblings.
    expect(power).toMatchObject({ parentId: top.id, sort: 0 });
    expect(water).toMatchObject({ parentId: top.id, sort: 1 });

    const twice = await http()
      .post('/api/v1/gl-accounts/groups')
      .set(bearer(admin))
      .send({ code: `H${run}1`, name: 'Давхар', parentId: null })
      .expect(422);
    expect(refusal(twice.body)).toBe('FIN_PAYLOAD_INVALID group.code taken');
    await http()
      .post('/api/v1/gl-accounts/groups')
      .set(bearer(admin))
      .send({ code: `H${run}9`, name: 'Эцэггүй', parentId: 999_999_999 })
      .expect(422);
    await http()
      .post('/api/v1/gl-accounts/groups')
      .set(bearer(admin))
      .send({ code: 'муу код', name: 'Код буруу', parentId: null })
      .expect(422);

    const renamed = await http()
      .put(`/api/v1/gl-accounts/groups/${power.id}`)
      .set(bearer(admin))
      .send({ name: 'Цахилгаан' })
      .expect(200);
    expect(renamed.body).toMatchObject({ code: `H${run}1`, name: 'Цахилгаан', parentId: top.id });

    // Never under itself or its own descendant.
    for (const [id, parentId] of [
      [power.id, power.id],
      [top.id, power.id],
    ]) {
      const cycle = await http()
        .put(`/api/v1/gl-accounts/groups/${id}`)
        .set(bearer(admin))
        .send({ parentId })
        .expect(422);
      expect(refusal(cycle.body)).toBe('FIN_PAYLOAD_INVALID group.parentId cycle');
    }
    const moved = await http()
      .put(`/api/v1/gl-accounts/groups/${water.id}`)
      .set(bearer(admin))
      .send({ parentId: power.id })
      .expect(200);
    expect(moved.body).toMatchObject({ parentId: power.id, sort: 0 });
    await http()
      .put(`/api/v1/gl-accounts/groups/${water.id}`)
      .set(bearer(admin))
      .send({ parentId: null })
      .expect(200);
    expect((await groupsNow()).find((row) => row.id === water.id)?.parentId).toBeNull();

    // An account made in a group, moved to another and out of any.
    const made = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: `79${stamp()}`, name: 'Цахилгааны зардал', groupId: power.id })
      .expect(201);
    const account = made.body as AccountJson;
    expect(account).toMatchObject({ kind: 'EXPENSE', groupId: power.id });

    const notEmpty = await http()
      .delete(`/api/v1/gl-accounts/groups/${power.id}`)
      .set(bearer(admin))
      .expect(422);
    expect(refusal(notEmpty.body)).toBe('FIN_PAYLOAD_INVALID group notEmpty');
    const withChild = await http()
      .delete(`/api/v1/gl-accounts/groups/${top.id}`)
      .set(bearer(admin))
      .expect(422);
    expect(refusal(withChild.body)).toBe('FIN_PAYLOAD_INVALID group notEmpty');

    await http()
      .put(`/api/v1/gl-accounts/${account.id}`)
      .set(bearer(admin))
      .send({ groupId: water.id })
      .expect(200);
    expect((await accountsNow()).find((row) => row.id === account.id)?.groupId).toBe(water.id);
    await http().delete(`/api/v1/gl-accounts/groups/${power.id}`).set(bearer(admin)).expect(204);
    await http().delete(`/api/v1/gl-accounts/groups/${power.id}`).set(bearer(admin)).expect(404);
    await http()
      .put(`/api/v1/gl-accounts/groups/${power.id}`)
      .set(bearer(admin))
      .send({ name: 'Устсан' })
      .expect(404);
    expect((await groupsNow()).find((row) => row.id === power.id)?.status).toBe('INACTIVE');
    // A deleted group takes no account and no child.
    const gone = await http()
      .put(`/api/v1/gl-accounts/${account.id}`)
      .set(bearer(admin))
      .send({ groupId: power.id })
      .expect(422);
    expect(refusal(gone.body)).toBe('FIN_PAYLOAD_INVALID groupId exists');
    await http()
      .put(`/api/v1/gl-accounts/groups/${water.id}`)
      .set(bearer(admin))
      .send({ parentId: power.id })
      .expect(422);
    // Its code made again brings it back, under the new parent.
    const back = await makeGroup(`H${run}1`, 'Цахилгаан, дулаан', top.id);
    expect(back).toMatchObject({ id: power.id, status: 'ACTIVE', parentId: top.id });

    const loose = await http()
      .put(`/api/v1/gl-accounts/${account.id}`)
      .set(bearer(admin))
      .send({ groupId: null })
      .expect(200);
    expect((loose.body as AccountJson).groupId).toBeNull();

    const db = await connectAs('migrator');
    try {
      const audit = await db.query<{ action: string }>(
        `SELECT action FROM fin.audit_log WHERE entity = 'account_group' AND entity_id = $1 ORDER BY id`,
        [String(power.id)],
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        'CREATE',
        'UPDATE',
        'DEACTIVATE',
        'CREATE',
      ]);
      const moves = await db.query<{ after: { groupId?: number | null } }>(
        `SELECT after FROM fin.audit_log WHERE entity = 'account' AND entity_id = $1 ORDER BY id`,
        [String(account.id)],
      );
      expect(moves.rows.map((row) => row.after.groupId)).toEqual([power.id, water.id, null]);
    } finally {
      await db.end();
    }
  });

  it('moves an account with lines into a group without touching its balance', async () => {
    const group = await makeGroup(`B${run}`, 'Үлдэгдэлтэй данс', null);
    const before = await accountsNow();
    const target = before.find((row) => row.code === '120101');
    if (!target) throw new Error('the seeded receivable account is missing');
    await http()
      .put(`/api/v1/gl-accounts/${target.id}`)
      .set(bearer(admin))
      .send({ groupId: group.id })
      .expect(200);
    const after = await accountsNow();
    expect(after.find((row) => row.id === target.id)).toMatchObject({
      groupId: group.id,
      balance: target.balance,
    });
    expect(after.map((row) => [row.id, row.balance])).toEqual(
      before.map((row) => [row.id, row.balance]),
    );
    await http()
      .put(`/api/v1/gl-accounts/${target.id}`)
      .set(bearer(admin))
      .send({ groupId: target.groupId })
      .expect(200);
  });

  it('keeps a hand-made group through the whole-chart upsert', async () => {
    const groups = await groupsNow();
    const leaf = groups.find((row) => row.code === 'T15');
    if (!leaf) throw new Error('the tree of the first test is missing');
    const hand = await makeGroup(`K${run}`, 'Гараар нэмсэн', leaf.id);
    const made = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: `15${stamp()}`, name: 'Гарын данс', groupId: hand.id })
      .expect(201);
    await http().post('/api/v1/gl-accounts/chart').set(bearer(admin)).send(body).expect(200);
    const after = await groupsNow();
    expect(after.find((row) => row.id === hand.id)).toMatchObject({
      code: `K${run}`,
      name: 'Гараар нэмсэн',
      parentId: leaf.id,
      status: 'ACTIVE',
    });
    // The groups the payload carries are still its own.
    expect(after.find((row) => row.code === 'T15')).toMatchObject({ id: leaf.id, sort: 1 });
    expect(
      (await accountsNow()).find((row) => row.id === (made.body as AccountJson).id)?.groupId,
    ).toBe(hand.id);
  });

  it('asks finance.settings.manage for a group and finance.journal.manage for an account’s', async () => {
    const group = await makeGroup(`R${run}`, 'Эрх', null);
    for (const token of [office, accountant]) {
      await http()
        .post('/api/v1/gl-accounts/groups')
        .set(bearer(token))
        .send({ code: `R${run}X`, name: 'Эрхгүй', parentId: null })
        .expect(403);
      await http()
        .put(`/api/v1/gl-accounts/groups/${group.id}`)
        .set(bearer(token))
        .send({ name: 'Эрхгүй' })
        .expect(403);
      await http().delete(`/api/v1/gl-accounts/groups/${group.id}`).set(bearer(token)).expect(403);
    }
    const account = (await accountsNow()).find((row) => row.code === 'T150101');
    if (!account) throw new Error('the imported account is missing');
    await http()
      .put(`/api/v1/gl-accounts/${account.id}`)
      .set(bearer(office))
      .send({ groupId: group.id })
      .expect(403);
    await http()
      .put(`/api/v1/gl-accounts/${account.id}`)
      .set(bearer(accountant))
      .send({ groupId: group.id })
      .expect(200);
    await http()
      .put(`/api/v1/gl-accounts/${account.id}`)
      .set(bearer(accountant))
      .send({ groupId: account.groupId })
      .expect(200);
  });

  it('never shows or writes another company’s group', async () => {
    const core = await createFinanceCoreOnly();
    try {
      await StaticCaller.ensureWithChart(core.db);
      const chart = core.module.get(FinChartService);
      const other = await core.db.transaction((tx) =>
        chart.createGroupInTx(
          tx,
          StaticCaller.user({ [TEST_COMPANY]: ['finance.settings.manage'] }),
          { company: TEST_COMPANY, code: `O${run}`, name: 'Өөр компани', parentId: null },
        ),
      );
      expect((await groupsNow()).some((row) => row.id === other.id)).toBe(false);
      await http()
        .put(`/api/v1/gl-accounts/groups/${other.id}`)
        .set(bearer(admin))
        .send({ name: 'Булаасан' })
        .expect(404);
      await http().delete(`/api/v1/gl-accounts/groups/${other.id}`).set(bearer(admin)).expect(404);
      const mine = await makeGroup(`M${run}`, 'Манай', null);
      await http()
        .put(`/api/v1/gl-accounts/groups/${mine.id}`)
        .set(bearer(admin))
        .send({ parentId: other.id })
        .expect(422);
      await http()
        .post('/api/v1/gl-accounts')
        .set(bearer(admin))
        .send({ code: `79${stamp()}`, name: 'Өөр бүлэгт', groupId: other.id })
        .expect(422);
      // In the core: a right elsewhere, or the account right alone, writes no group there.
      expect(
        await codeOf(
          core.db.transaction((tx) =>
            chart.createGroupInTx(tx, StaticCaller.user({ OTHER: ['finance.settings.manage'] }), {
              company: TEST_COMPANY,
              code: `P${run}`,
              name: 'Эрхгүй',
              parentId: null,
            }),
          ),
        ),
      ).toBe('FIN_COMPANY_FORBIDDEN');
      expect(
        await codeOf(
          core.db.transaction((tx) =>
            chart.deleteGroupInTx(
              tx,
              StaticCaller.user({ [TEST_COMPANY]: ['finance.journal.manage'] }),
              { company: TEST_COMPANY, id: other.id },
            ),
          ),
        ),
      ).toBe('FIN_COMPANY_FORBIDDEN');
    } finally {
      await core.close();
    }
  });
});
