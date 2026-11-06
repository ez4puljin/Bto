import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

interface AccountJson {
  id: number;
  code: string;
  journal: string;
}
interface EntryJson {
  id: number;
  lines: { accountId: number; debit: string; credit: string; moneyAccountId?: number | null }[];
}

/**
 * Transactions by the account's journal (ADR-0150): an account of the journal against a counter
 * account, always balanced; a cash account's money account made by itself; stock accounts refused;
 * the party a receivable needs; the list by journal; the right. Synthetic data.
 */
describe('finance transactions by journal', () => {
  let app: NestExpressApplication;
  let admin: string;
  let office: string;
  let cash: AccountJson;
  let other: AccountJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const send = (body: object, token = admin) =>
    http()
      .post('/api/v1/journal-entries/by-account')
      .set(bearer(token))
      .set(idempotency())
      .send(body);

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const made = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: '100777', name: 'Шинэ касс', journal: 'CASH' })
      .expect(201);
    cash = made.body as AccountJson;
    const all = (await http().get('/api/v1/gl-accounts').set(bearer(admin)).expect(200))
      .body as AccountJson[];
    const found = all.find((row) => row.code === '730101');
    if (!found) throw new Error('the seeded expense account is missing');
    other = found;
  });
  afterAll(async () => {
    await app.close();
  });

  const base = () => ({
    journal: 'CASH',
    entryDate: today,
    description: 'Туршилтын гүйлгээ',
    accountId: cash.id,
    counterAccountId: other.id,
    side: 'CREDIT',
    amount: '5000',
  });

  it('posts a balanced entry with the cash account’s own money account', async () => {
    const posted = await send(base()).expect(201);
    const entry = posted.body as EntryJson;
    const line = entry.lines.find((row) => row.accountId === cash.id);
    expect(Number(line?.credit)).toBe(5000);
    expect(line?.moneyAccountId).toEqual(expect.any(Number));
    const counter = entry.lines.find((row) => row.accountId === other.id);
    expect(Number(counter?.debit)).toBe(5000);
    const money = (await http().get('/api/v1/money-accounts').set(bearer(admin)).expect(200))
      .body as { code: string; glAccountId: number }[];
    expect(money.filter((row) => row.glAccountId === cash.id)).toHaveLength(1);

    // It lists under its journal, and under a journal it touches on the other side.
    const listed = (
      await http()
        .get('/api/v1/journal-entries')
        .query({ journal: 'CASH', from: today, to: today })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { id: number }[] };
    expect(listed.data.map((row) => row.id)).toContain(entry.id);
    const vat = (
      await http()
        .get('/api/v1/journal-entries')
        .query({ journal: 'VAT', from: today, to: today })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { id: number }[] };
    expect(vat.data.map((row) => row.id)).not.toContain(entry.id);
  });

  it('replays the same key instead of posting twice', async () => {
    const headers = idempotency();
    const first = await http()
      .post('/api/v1/journal-entries/by-account')
      .set(bearer(admin))
      .set(headers)
      .send(base())
      .expect(201);
    const again = await http()
      .post('/api/v1/journal-entries/by-account')
      .set(bearer(admin))
      .set(headers)
      .send(base())
      .expect(201);
    expect((again.body as EntryJson).id).toBe((first.body as EntryJson).id);
  });

  it('refuses what the form must not do', async () => {
    await send(base(), office).expect(403);
    // An account of another journal; the same account twice; no amount; a future date.
    await send({ ...base(), journal: 'BANK' }).expect(422);
    await send({ ...base(), counterAccountId: cash.id }).expect(422);
    await send({ ...base(), amount: '0' }).expect(422);
    await send({ ...base(), entryDate: '2099-01-01' }).expect(422);
    // Stock accounts move through the warehouse's documents.
    await send({ ...base(), journal: 'INVENTORY' }).expect(422);
    const stock = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: '150777', name: 'Агуулах', journal: 'INVENTORY' })
      .expect(201);
    await send({ ...base(), counterAccountId: (stock.body as AccountJson).id }).expect(422);
  });

  it('takes a transfer between accounts and a party on a plain line', async () => {
    const bank = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: '110777', name: 'Шинэ банк', journal: 'BANK' })
      .expect(201);
    const posted = await send({
      ...base(),
      counterAccountId: (bank.body as AccountJson).id,
      description: 'Кассаас банк руу',
    }).expect(201);
    const lines = (posted.body as EntryJson).lines;
    expect(lines.every((row) => row.moneyAccountId)).toBe(true);
    expect(lines).toHaveLength(2);

    // A party named on a plain line is kept, for the entry's reader.
    const customer = await http()
      .post('/api/v1/customers')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        kind: 'COMPANY',
        code: '0777',
        name: 'Туршилтын харилцагч',
        settlementGroup: 'MONTH_END',
      })
      .expect(201);
    await send({
      ...base(),
      party: { customerId: (customer.body as { id: number }).id },
      description: 'Харилцагчтай зарлага',
    }).expect(201);
  });

  it('asks a party for a party account', async () => {
    const debt = await http()
      .post('/api/v1/gl-accounts')
      .set(bearer(admin))
      .send({ code: '122777', name: 'Бусад авлага', journal: 'RECEIVABLE_PAYABLE' })
      .expect(201);
    const response = await send({
      ...base(),
      journal: 'RECEIVABLE_PAYABLE',
      accountId: (debt.body as AccountJson).id,
      side: 'DEBIT',
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });
});
