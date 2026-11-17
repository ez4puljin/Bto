import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SMS_DEFAULT_TEMPLATE } from '@tugeel/shared/notifications';
import type { Client } from 'pg';
import request from 'supertest';
import { SMS_FETCH, type SmsFetch } from '../../src/integrations/sms';
import { SmsSendFlowService } from '../../src/modules/notifications/services/sms-send-flow.service';
import { WorkerModule } from '../../src/worker.module';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { financeApi, salesFlow } from '../harness/finance';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/** Not a real key: no test reaches WeSend, the «WeSend» below is scripted. */
const KEY = 'test-wesend-key-not-real-1234';

interface Sent {
  to: string;
  text: string;
  idempotencyKey: string;
}

interface BatchJson {
  id: number;
  status: string;
  totalCount: number;
  queuedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  creditsUsed: number;
  stoppedCode: string | null;
}

interface MessageJson {
  customerId: number;
  phone: string | null;
  text: string;
  balance: string;
  status: string;
  errorCode: string | null;
}

/**
 * Settlement SMS (ADR-0216) over HTTP, with the sending run as the worker runs it. WeSend is
 * scripted: what is checked is ours — rights, the frozen texts with each customer's own balance,
 * SENT / FAILED / SKIPPED, a stop on an account refusal, and that a job run twice never sends twice.
 */
describe('Settlement SMS', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let flow: SmsSendFlowService;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let reader: string;
  let outsider: string;
  let big: { id: number };
  let small: { id: number };
  let refused: { id: number };
  let phoneless: { id: number };
  let settled: { id: number };
  /** What the scripted WeSend received and how it answers. */
  const wesend = {
    sent: [] as Sent[],
    answered: new Map<string, unknown>(),
    /** Local numbers WeSend refuses as unsupported. */
    unsupported: new Set<string>(),
    /** An account refusal for every text, when set. */
    accountRefusal: null as null | { status: number; code: string },
    balance: 5000,
  };
  const http = () => request(app.getHttpServer());

  const scriptedWesend: SmsFetch = (url, init) => {
    const headers = init.headers as Record<string, string>;
    const json = (status: number, body: unknown) =>
      Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    if (headers.Authorization !== `Bearer ${KEY}`) {
      return json(401, { error: { code: 'invalid_api_key', message: 'bad key' } });
    }
    const { pathname } = new URL(url);
    if (pathname === '/v1/balance' && init.method === 'GET') {
      return json(200, { balance: wesend.balance, currency: 'MNT' });
    }
    if (pathname !== '/v1/sms' || init.method !== 'POST') return json(404, {});
    const key = headers['Idempotency-Key'] ?? '';
    // A repeated key gets the first answer, as WeSend promises, and sends nothing.
    const replay = wesend.answered.get(key);
    if (replay) return json(200, replay);
    if (wesend.accountRefusal) {
      return json(wesend.accountRefusal.status, {
        error: { code: wesend.accountRefusal.code, message: 'refused' },
      });
    }
    const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      to: string;
      text: string;
    };
    if (wesend.unsupported.has(body.to)) {
      return json(422, { error: { code: 'unsupported_number', message: 'no' } });
    }
    wesend.sent.push({ to: body.to, text: body.text, idempotencyKey: key });
    const answer = {
      id: `ws-${wesend.sent.length}`,
      status: 'sent',
      channel: 'sms',
      to: body.to,
      parts: 2,
      credits: 160,
      encoding: 'unicode',
      balance: 4840,
      error: null,
      sandbox: false,
    };
    wesend.answered.set(key, answer);
    return json(200, answer);
  };

  const list = (query: Record<string, string>, token = accountant) =>
    http().get('/api/v1/settlement-sms/customers').query(query).set(bearer(token));
  const create = (body: Record<string, unknown>, token = accountant) =>
    http()
      .post('/api/v1/settlement-sms/batches')
      .set(bearer(token))
      .set(idempotency())
      .send({ group: 'DAY_20', template: SMS_DEFAULT_TEMPLATE, ...body });
  const detail = async (id: number) =>
    (await http().get(`/api/v1/settlement-sms/batches/${id}`).set(bearer(accountant)).expect(200))
      .body as { batch: BatchJson; messages: MessageJson[] };
  const saveKey = (body: Record<string, unknown>, token = admin) =>
    http().patch('/api/v1/sms/settings').set(bearer(token)).send(body);

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) => builder.overrideProvider(SMS_FETCH).useValue(scriptedWesend),
    });
    // The worker's side without its job polling: the test sends a batch itself.
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(SMS_FETCH)
      .useValue(scriptedWesend)
      .compile();
    flow = worker.get(SmsSendFlowService, { strict: false });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    reader = await customRoleUser(app, admin, ['finance.read']);
    outsider = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;

    const partners = partnersApi(app, admin);
    big = await partners.customer({ name: 'Том дэлгүүр', phone: '99110001' });
    small = await partners.customer({ name: 'Жижиг дэлгүүр', phone: '99110002' });
    refused = await partners.customer({ name: 'Хүрэхгүй дугаар', phone: '99110003' });
    phoneless = await partners.customer({ name: 'Утасгүй дэлгүүр' });
    settled = await partners.customer({ name: 'Тооцоо хийсэн', phone: '99110005' });
    wesend.unsupported.add('99110003');

    // Receivables through real sales: 1,250 and 3 pieces at 1,000₮.
    const sales = await salesFlow(app, admin, 'SMS');
    const juice = await sales.product('8901', 'Жүүс', '1000', '5000');
    for (const [customer, qty] of [
      [big, '1250'],
      [small, '3'],
      [refused, '2'],
      [phoneless, '1'],
    ] as const) {
      const draft = await sales.draft(customer.id, [{ productUnitId: sales.pcs(juice), qty }], {
        paymentMethod: 'CREDIT',
      });
      await sales.sell(draft.id);
    }
  });
  afterAll(async () => {
    await sql.end();
    await worker.close();
    await app.close();
  });

  it('lists a group with phones and the balances «Харилцагчийн үлдэгдэл» shows', async () => {
    const all = (await list({ group: 'DAY_20', withBalance: 'false' }).expect(200)).body as {
      period: { from: string; to: string; dueDate: string };
      data: { customerId: number; phone: string | null; balance: string; lastSentAt: null }[];
    };
    const row = (id: number) => all.data.find((entry) => entry.customerId === id);
    expect(row(big.id)).toMatchObject({ phone: '+97699110001', balance: '1250000.00' });
    expect(row(phoneless.id)).toMatchObject({ phone: null, balance: '1000.00' });
    expect(row(settled.id)).toMatchObject({ balance: '0.00', lastSentAt: null });
    expect(all.period.dueDate).toMatch(/^\d{4}-\d{2}-20$/);
    const finance = financeApi(app, admin);
    expect((await finance.balance(big.id)).balance).toBe(row(big.id)?.balance);

    const owing = (await list({ group: 'DAY_20', withBalance: 'true' }).expect(200)).body as {
      data: { customerId: number }[];
    };
    expect(owing.data.map((entry) => entry.customerId)).not.toContain(settled.id);
    const other = (await list({ group: 'MONTH_END' }).expect(200)).body as {
      data: { customerId: number }[];
    };
    expect(other.data.map((entry) => entry.customerId)).not.toContain(big.id);
    await list({ group: 'DAY_20' }, reader).expect(200);
    await list({ group: 'DAY_20' }, outsider).expect(403);
  });

  it('keeps the key write-only and refuses a batch without one', async () => {
    expect(
      (await http().get('/api/v1/settlement-sms/status').set(bearer(reader)).expect(200)).body,
    ).toEqual({ ready: false, reason: 'not_configured' });
    expect((await create({ customerIds: [big.id] }).expect(409)).body).toMatchObject({
      code: 'SMS_NOT_CONFIGURED',
    });
    await saveKey({ apiKey: KEY }, accountant).expect(403);
    const saved = (await saveKey({ apiKey: KEY }).expect(200)).body as Record<string, unknown>;
    expect(saved).toMatchObject({ hasKey: true, keyLast4: '1234', enabled: true });
    expect(JSON.stringify(saved)).not.toContain(KEY);
    const stored = await sql.query<{ sealed: string }>(
      'SELECT api_key_sealed AS sealed FROM sms_settings',
    );
    expect(stored.rows[0]?.sealed).not.toContain(KEY);
    const audit = await sql.query<{ after: unknown }>(
      "SELECT after FROM audit_log WHERE entity = 'sms_settings'",
    );
    expect(JSON.stringify(audit.rows)).not.toContain(KEY);
    expect(
      (await http().post('/api/v1/sms/settings/test').set(bearer(admin)).send({}).expect(200)).body,
    ).toEqual({ ok: true, balance: 5000, reason: null });
    expect(
      (
        await http()
          .post('/api/v1/sms/settings/test')
          .set(bearer(admin))
          .send({ apiKey: 'another-key-that-fails' })
          .expect(200)
      ).body,
    ).toMatchObject({ ok: false, reason: 'invalid_api_key' });
    expect(
      (await http().get('/api/v1/settlement-sms/balance').set(bearer(accountant)).expect(200)).body,
    ).toMatchObject({ ok: true, balance: 5000 });
    await http().get('/api/v1/settlement-sms/balance').set(bearer(reader)).expect(403);
  });

  it('refuses an unknown placeholder and a sender without the right', async () => {
    expect(
      (
        await create({ customerIds: [big.id], template: 'Сайн уу {Утас} {Харилцагч_нэр}' }).expect(
          422,
        )
      ).body,
    ).toMatchObject({ code: 'SMS_TEMPLATE_INVALID', params: { placeholders: '{Утас}' } });
    expect(
      (await create({ customerIds: [big.id], template: '{Харилцагч_нэр}'.repeat(40) }).expect(422))
        .body,
    ).toMatchObject({ code: 'SMS_TOO_LONG' });
    await create({ customerIds: [big.id] }, reader).expect(403);
  });

  it('freezes each text with its own balance, sends, fails and skips, and never sends twice', async () => {
    const batch = (
      await create({
        customerIds: [big.id, small.id, refused.id, phoneless.id, settled.id],
        onlyWithBalance: true,
      }).expect(201)
    ).body as BatchJson;
    expect(batch).toMatchObject({
      status: 'QUEUED',
      totalCount: 5,
      queuedCount: 3,
      skippedCount: 2,
    });
    const jobs = await sql.query(
      `SELECT 1 FROM pgboss.job WHERE name = 'notifications.sendSms' AND data->>'batchId' = $1`,
      [String(batch.id)],
    );
    expect(jobs.rowCount).toBe(1);

    const before = await detail(batch.id);
    const message = (id: number) => before.messages.find((entry) => entry.customerId === id);
    expect(message(big.id)).toMatchObject({
      status: 'QUEUED',
      balance: '1250000.00',
      text: 'Сайн байна уу, Том дэлгүүр. Таны тооцооны үлдэгдэл 1,250,000 төг байна. Бүтэн-Оргил ХХК',
    });
    expect(message(small.id)?.text).toContain('үлдэгдэл 3,000 төг');
    expect(message(phoneless.id)).toMatchObject({ status: 'SKIPPED', errorCode: 'no_phone' });
    expect(message(settled.id)).toMatchObject({ status: 'SKIPPED', errorCode: 'no_balance' });
    // The text is frozen: the app role cannot rewrite it.
    const asApp = await connectAs('app');
    await expect(
      asApp.query("UPDATE sms_messages SET text = 'x' WHERE batch_id = $1", [batch.id]),
    ).rejects.toThrow(/permission denied/);
    await asApp.end();

    expect(await flow.execute(batch.id)).toEqual({ sent: 2, failed: 1, stoppedCode: null });
    expect(wesend.sent.map((entry) => entry.to).sort()).toEqual(['99110001', '99110002']);
    expect(wesend.sent[0]?.text).toBe(message(big.id)?.text);
    const after = await detail(batch.id);
    expect(after.batch).toMatchObject({
      status: 'DONE',
      sentCount: 2,
      failedCount: 1,
      skippedCount: 2,
      queuedCount: 0,
      creditsUsed: 320,
    });
    expect(after.messages.find((entry) => entry.customerId === refused.id)).toMatchObject({
      status: 'FAILED',
      errorCode: 'unsupported_number',
    });
    const listed = (await list({ group: 'DAY_20' }).expect(200)).body as {
      data: { customerId: number; lastSentAt: string | null }[];
    };
    expect(listed.data.find((entry) => entry.customerId === big.id)?.lastSentAt).not.toBeNull();

    // The job again: nothing is sent.
    expect(await flow.execute(batch.id)).toEqual({ sent: 0, failed: 0, stoppedCode: null });
    expect(wesend.sent).toHaveLength(2);
    // A worker that died after WeSend sent but before marking: the retry carries the same key, so
    // WeSend answers with the first answer and sends nothing.
    const firstKey = wesend.sent.find((entry) => entry.to === '99110001')?.idempotencyKey;
    await sql.query(
      `UPDATE sms_messages SET status = 'QUEUED', sent_at = NULL, provider_message_id = NULL
        WHERE batch_id = $1 AND customer_id = $2`,
      [batch.id, big.id],
    );
    await sql.query(`UPDATE sms_batches SET status = 'SENDING' WHERE id = $1`, [batch.id]);
    expect(await flow.execute(batch.id)).toMatchObject({ sent: 2 });
    expect(wesend.sent).toHaveLength(2);
    expect(firstKey).toMatch(/^bto-sms-[0-9a-f-]{36}$/);
  });

  it('stops a batch on an account refusal and fails the rest with its code', async () => {
    const batch = (await create({ customerIds: [big.id, small.id] }).expect(201)).body as BatchJson;
    wesend.accountRefusal = { status: 402, code: 'insufficient_credits' };
    try {
      expect(await flow.execute(batch.id)).toEqual({
        sent: 0,
        failed: 2,
        stoppedCode: 'insufficient_credits',
      });
    } finally {
      wesend.accountRefusal = null;
    }
    const after = await detail(batch.id);
    expect(after.batch).toMatchObject({ failedCount: 2, stoppedCode: 'insufficient_credits' });
    expect(after.messages.every((entry) => entry.errorCode === 'insufficient_credits')).toBe(true);
    expect(wesend.sent).toHaveLength(2);
  });

  it('shows the history and a customer statement totals strip to finance readers', async () => {
    const page = (
      await http().get('/api/v1/settlement-sms/batches').set(bearer(reader)).expect(200)
    ).body as { data: BatchJson[] };
    expect(page.data.length).toBeGreaterThanOrEqual(2);
    await http().get('/api/v1/settlement-sms/batches').set(bearer(outsider)).expect(403);
    const audit = await sql.query("SELECT 1 FROM audit_log WHERE entity = 'sms_batches'");
    expect(audit.rowCount).toBeGreaterThanOrEqual(2);

    const totals = (
      await http()
        .get(`/api/v1/customer-balances/${big.id}/statement-totals`)
        .query({ from: '2020-01-01', to: '2099-12-31' })
        .set(bearer(reader))
        .expect(200)
    ).body as Record<string, string>;
    expect(totals).toMatchObject({
      from: '2020-01-01',
      opening: '0.00',
      totalDebit: '1250000.00',
      totalCredit: '0.00',
      closing: '1250000.00',
    });
    expect(totals.to).not.toBe('2099-12-31');
  });
});
