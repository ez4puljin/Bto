import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { addDays, businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import request from 'supertest';
import { EBARIMT_HOSTS, EbarimtIntegrationModule } from '../../src/integrations/ebarimt';
import { systemActor } from '../../src/modules/identity';
import { EbarimtPullFlowService } from '../../src/modules/ebarimt-check/services/ebarimt-pull-flow.service';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';

/** Not a real connection: the «e-Barimt» below is a server of this test, on the loopback. */
const USERNAME = 'test-ebarimt-user';
const PASSWORD = 'test-ebarimt-password-not-real';
const API_KEY = 'test-ebarimt-key-not-real';
const PIN = '1234567';

/** A month no other suite gives a file: February 2025, four weeks. */
const PERIOD = 202502;

interface FakeReceipt {
  prPosRno: string | null;
  name: string;
  regNo: string;
  date: string;
  /** Raw JSON numbers, as the service writes them. */
  amountVat: string;
  amountNet: string;
  amountTotal: string;
  receiptType: string | null;
  fromType: string;
}

interface Asked {
  path: string;
  apiKey: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/** e-Barimt as the test needs it: the realm's token and the purchases list, filtered by day. */
function fakeEbarimt() {
  const state = {
    receipts: [] as FakeReceipt[],
    asked: [] as Asked[],
    /** A refusal the list answers with, instead of the receipts. */
    refusal: null as { status: number; msg: string } | null,
  };
  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
  const server = createServer((req, res) => {
    void read(req).then((text) => {
      const send = (status: number, body: string) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(body);
      };
      if (req.url === '/auth/realms/Staging/protocol/openid-connect/token') {
        const form = new URLSearchParams(text);
        if (
          form.get('grant_type') !== 'password' ||
          form.get('client_id') !== 'vatps' ||
          form.get('username') !== USERNAME ||
          form.get('password') !== PASSWORD
        ) {
          send(401, '{"error":"invalid_grant","error_description":"Invalid user credentials"}');
          return;
        }
        send(200, '{"access_token":"fake-token","expires_in":300,"token_type":"Bearer"}');
        return;
      }
      if (req.url === '/api/tpi/receipt/getSaleListERP') {
        const body = JSON.parse(text) as Record<string, unknown>;
        state.asked.push({
          path: req.url,
          apiKey: req.headers['x-api-key'] as string | undefined,
          authorization: req.headers.authorization,
          body,
        });
        if (
          req.headers['x-api-key'] !== API_KEY ||
          req.headers.authorization !== 'Bearer fake-token'
        ) {
          send(403, '{"msg":"Хандах эрхгүй","status":403,"code":"FORBIDDEN","data":null}');
          return;
        }
        if (state.refusal) {
          send(
            200,
            JSON.stringify({ msg: state.refusal.msg, status: state.refusal.status, code: 'E' }),
          );
          return;
        }
        const from = String(body.startDate);
        const to = String(body.endDate);
        const lines = state.receipts
          .filter((receipt) => receipt.date.slice(0, 10) >= from && receipt.date.slice(0, 10) <= to)
          .map(
            (receipt) =>
              `{"prPosRno":${JSON.stringify(receipt.prPosRno)},"name":${JSON.stringify(receipt.name)},` +
              `"regNo":${JSON.stringify(receipt.regNo)},"buyerRegNo":"${PIN}",` +
              `"date":"${receipt.date}","amountVat":${receipt.amountVat},"amountCitytax":0,` +
              `"amountTotal":${receipt.amountTotal},"amountNet":${receipt.amountNet},` +
              `"fromType":"${receipt.fromType}","receiptType":${JSON.stringify(receipt.receiptType)}}`,
          );
        send(
          200,
          `{"msg":"Амжилттай","status":200,"code":null,"data":[{"startDate":"${from} 00:00:00",` +
            `"endDate":"${to} 23:59:59","regNo":"${PIN}","receiptBuyModelList":[${lines.join(',')}]}]}`,
        );
        return;
      }
      send(404, '{}');
    });
  });
  return { server, state };
}

const receipt = (overrides: Partial<FakeReceipt>): FakeReceipt => ({
  prPosRno: 'PULL-1',
  name: 'Татагдах ХХК',
  regNo: '7100001',
  date: '2025-02-03 10:00:00',
  amountVat: '100',
  amountNet: '1000',
  amountTotal: '1100',
  receiptType: 'ТӨЛБӨРИЙН БАРИМТ',
  fromType: 'POS API',
  ...overrides,
});

interface ConnectionJson {
  environment: string;
  username: string | null;
  hasPassword: boolean;
  hasApiKey: boolean;
  companyRegister: string | null;
  nightly: boolean;
  complete: boolean;
  lastPull: {
    ok: boolean;
    reason: string | null;
    message: string | null;
    receipts: number | null;
    masked: number | null;
  } | null;
}

interface PullJson {
  ok: boolean;
  reason: string | null;
  message: string | null;
  receipts: number | null;
  masked: number | null;
  months: { period: number; changed: boolean; fileId: number | null }[];
}

interface MonthFileJson {
  id: number;
  source: string;
  fileName: string;
  rowCount: number;
  vatAmount: string;
  totalAmount: string;
  maskedCount: number;
}

/**
 * e-Barimt's purchases pulled by the API (ADR-0228): the connection typed on the page and sealed,
 * «Одоо татах» writing the month's file as an upload does, an unchanged pull adding nothing, an
 * upload still replacing, and a refusal shown in the service's own words. The service is a fake on
 * the loopback; synthetic data only.
 */
describe('ebarimt pull', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let buyer: string;
  let supplier: number;
  const fake = fakeEbarimt();
  const http = () => request(app.getHttpServer());

  const connection = async () =>
    (await http().get('/api/v1/ebarimt-check/connection').set(bearer(admin)).expect(200))
      .body as ConnectionJson;
  const pull = async (period = PERIOD, token = admin, status = 200) =>
    (
      await http()
        .post('/api/v1/ebarimt-check/pull')
        .set(bearer(token))
        .set(idempotency())
        .send({ period })
        .expect(status)
    ).body as PullJson;
  const monthFile = async (period = PERIOD) => {
    const overview = (
      await http()
        .get('/api/v1/ebarimt-check/files')
        .query({ year: Math.floor(period / 100) })
        .set(bearer(admin))
        .expect(200)
    ).body as { months: { period: number; file: MonthFileJson | null }[] };
    return overview.months.find((month) => month.period === period)?.file ?? null;
  };
  const fileRows = async (period = PERIOD) =>
    (
      await sql.query<{ source: string; status: string; file_id: string | null }>(
        'SELECT source, status, file_id FROM ebarimt_check_files WHERE period = $1 ORDER BY id',
        [period],
      )
    ).rows;
  const historyCount = async (period = PERIOD) =>
    (
      await sql.query<{ n: string }>(
        'SELECT count(*) AS n FROM ebarimt_check_history WHERE period = $1',
        [period],
      )
    ).rows[0]?.n;
  const ebarimtOf = async (period = PERIOD) => {
    const report = (
      await http()
        .get('/api/v1/ebarimt-check/report')
        .query({ periods: String(period) })
        .set(bearer(admin))
        .expect(200)
    ).body as {
      rows: { supplierId: number; ebarimtAmount: string; ebarimtCount: number }[];
      unregistered: { ttd: string; amount: string; count: number }[];
    };
    return {
      row: report.rows.find((row) => row.supplierId === supplier),
      unregistered: report.unregistered,
    };
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    const { port } = fake.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const hosts = { api: base, auth: `${base}/auth/realms/Staging` };
    app = await createHttpApp({
      imports: [EbarimtIntegrationModule],
      override: (builder) =>
        builder.overrideProvider(EBARIMT_HOSTS).useValue({ STAGING: hosts, PRODUCTION: hosts }),
    });
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    buyer = (await login(app, await seedUser(app, { roles: ['PROCUREMENT'] }))).accessToken;
    supplier = (await partnersApi(app, admin).supplier({ name: 'Татагдах ЕБ', regNo: '7100001' }))
      .id;
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
    await new Promise<void>((resolve) => fake.server.close(() => resolve()));
  });

  it('saves the connection with the password and the key sealed, never handing them back', async () => {
    expect(await connection()).toMatchObject({
      environment: 'STAGING',
      hasPassword: false,
      hasApiKey: false,
      nightly: false,
      complete: false,
      lastPull: null,
    });
    // Who chases suppliers pulls, but does not type the connection.
    await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(buyer))
      .send({ username: USERNAME })
      .expect(403);
    const saved = await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(accountant))
      .send({
        environment: 'STAGING',
        username: USERNAME,
        password: PASSWORD,
        apiKey: API_KEY,
        companyRegister: ' 1234567 ',
      })
      .expect(200);
    expect(saved.body).toMatchObject({
      username: USERNAME,
      hasPassword: true,
      hasApiKey: true,
      companyRegister: PIN,
      nightly: false,
      complete: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain(PASSWORD);
    expect(JSON.stringify(saved.body)).not.toContain(API_KEY);
    expect(JSON.stringify(await connection())).not.toContain(PASSWORD);

    const [row] = (
      await sql.query<{ password_sealed: string; api_key_sealed: string }>(
        'SELECT password_sealed, api_key_sealed FROM ebarimt_check_connection',
      )
    ).rows;
    expect(row?.password_sealed).toMatch(/^v1\./);
    expect(row?.api_key_sealed).toMatch(/^v1\./);
    expect(row?.password_sealed).not.toContain(PASSWORD);
    const audit = await sql.query<{ before: unknown; after: unknown }>(
      "SELECT before, after FROM audit_log WHERE entity = 'ebarimt_check_connection'",
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit.rows)).not.toContain(API_KEY);

    // A register that is not one is refused.
    await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(admin))
      .send({ companyRegister: '12' })
      .expect(422);
  });

  it('pulls the month a week at a time and writes its file as an upload would', async () => {
    fake.state.receipts = [
      receipt({}),
      receipt({
        prPosRno: 'PULL-2',
        date: '2025-02-10 09:00:00',
        amountVat: '252.272727',
        amountNet: '2522.727273',
        amountTotal: '2775',
      }),
      // The seller's register hidden by stars, as the service's own example shows it.
      receipt({
        prPosRno: 'PULL-3',
        regNo: '71***01',
        name: 'ТАТ*****ХХК',
        date: '2025-02-27 23:00:00',
      }),
      // Not February's: left out.
      receipt({ prPosRno: 'PULL-4', date: '2025-03-01 00:00:00' }),
    ];
    fake.state.asked = [];
    const result = await pull();
    expect(result).toMatchObject({ ok: true, reason: null, receipts: 3, masked: 1 });
    expect(result.months).toEqual([
      { period: PERIOD, changed: true, fileId: expect.any(Number) as number },
    ]);
    expect(fake.state.asked.map((asked) => [asked.body.startDate, asked.body.endDate])).toEqual([
      ['2025-02-01', '2025-02-07'],
      ['2025-02-08', '2025-02-14'],
      ['2025-02-15', '2025-02-21'],
      ['2025-02-22', '2025-02-28'],
    ]);
    expect(fake.state.asked[0]).toMatchObject({
      apiKey: API_KEY,
      authorization: 'Bearer fake-token',
      body: { pin: PIN, subPin: [] },
    });

    expect(await monthFile()).toMatchObject({
      source: 'API',
      rowCount: 3,
      // 1100 + 2775 + 1100; VAT 100 + 252.27 + 100, each line rounded half up.
      totalAmount: '4975.00',
      vatAmount: '452.27',
      maskedCount: 1,
    });
    expect(await fileRows()).toEqual([{ source: 'API', status: 'ACTIVE', file_id: null }]);
    const { row, unregistered } = await ebarimtOf();
    expect(row).toMatchObject({ ebarimtAmount: '3875.00', ebarimtCount: 2 });
    expect(unregistered).toEqual([
      expect.objectContaining({ ttd: '71***01', amount: '1100.00', count: 1 }),
    ]);
    expect(await connection()).toMatchObject({
      lastPull: { ok: true, reason: null, receipts: 3, masked: 1 },
    });

    // A pull has no file to download.
    const file = await monthFile();
    await http()
      .get(`/api/v1/ebarimt-check/files/${file?.id}/download`)
      .set(bearer(admin))
      .expect(404);
  });

  it('adds nothing when the month is unchanged, and a new file when it changed', async () => {
    const history = await historyCount();
    const again = await pull(PERIOD, buyer);
    expect(again).toMatchObject({ ok: true, receipts: 3 });
    expect(again.months[0]?.changed).toBe(false);
    expect(await fileRows()).toHaveLength(1);
    expect(await historyCount()).toBe(history);

    fake.state.receipts.push(receipt({ prPosRno: 'PULL-5', date: '2025-02-15 12:00:00' }));
    const changed = await pull();
    expect(changed.months[0]?.changed).toBe(true);
    expect((await fileRows()).map((file) => file.status)).toEqual(['REPLACED', 'ACTIVE']);
    expect((await ebarimtOf()).row).toMatchObject({ ebarimtAmount: '4975.00', ebarimtCount: 3 });
    expect(Number.parseInt((await historyCount()) ?? '0', 10)).toBeGreaterThan(
      Number.parseInt(history ?? '0', 10),
    );
  });

  it('lets an upload replace a pull, and a later different pull replace the upload', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    sheet.addRow([
      'Падаан №',
      'ДДТД',
      'Огноо',
      'Харилцагчийн нэр',
      'Харилцагчийн ТТД',
      'НӨАТ',
      'Цэвэр дүн',
      'Нийт дүн',
      'Төрөл',
    ]);
    sheet.addRow([
      '9',
      'PULL-1',
      '2025-02-03',
      'Татагдах ХХК',
      '7100001',
      100,
      1000,
      1100,
      'Энгийн',
    ]);
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    const issued = (
      await http()
        .post('/api/v1/files/presign')
        .set(bearer(admin))
        .send({ kind: 'ebarimt.source', contentType: XLSX_CONTENT_TYPE, sizeBytes: bytes.length })
        .expect(201)
    ).body as { fileId: number; uploadUrl: string };
    await http()
      .put(issued.uploadUrl)
      .set('Content-Type', XLSX_CONTENT_TYPE)
      .send(bytes)
      .expect(204);
    await http()
      .post('/api/v1/ebarimt-check/files')
      .set(bearer(admin))
      .set(idempotency())
      .send({ fileId: issued.fileId, fileName: 'EBARIMT.xlsx' })
      .expect(201);
    expect(await monthFile()).toMatchObject({ source: 'FILE', rowCount: 1 });

    const result = await pull();
    expect(result.months[0]?.changed).toBe(true);
    expect(await monthFile()).toMatchObject({ source: 'API', rowCount: 4 });
  });

  it('shows the service’s own reason on a refusal, and keeps the month as it was', async () => {
    const before = await monthFile();
    fake.state.refusal = { status: 400, msg: 'Зөвхөн 01:00-07:00 цагийн хооронд' };
    const refused = await pull();
    expect(refused).toMatchObject({
      ok: false,
      reason: 'REFUSED',
      message: 'Зөвхөн 01:00-07:00 цагийн хооронд',
      receipts: null,
    });
    expect(await connection()).toMatchObject({
      lastPull: { ok: false, reason: 'REFUSED', message: 'Зөвхөн 01:00-07:00 цагийн хооронд' },
    });
    expect((await monthFile())?.id).toBe(before?.id);
    fake.state.refusal = null;

    // A month not begun asks nothing.
    const future = Number.parseInt(addDays(businessDate(), 62).slice(0, 7).replace('-', ''), 10);
    expect(await pull(future)).toMatchObject({ ok: false, reason: 'NO_DAYS' });

    // A wrong password is the sign-in's refusal, in the realm's words.
    await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(admin))
      .send({ password: 'another-password-not-real' })
      .expect(200);
    expect(await pull()).toMatchObject({
      ok: false,
      reason: 'SIGN_IN_REFUSED',
      message: 'Invalid user credentials',
    });
    // A wrong key: the service's refusal.
    await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(admin))
      .send({ password: PASSWORD, apiKey: 'another-key-not-real' })
      .expect(200);
    expect(await pull()).toMatchObject({ ok: false, reason: 'REFUSED', message: 'Хандах эрхгүй' });
    await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(admin))
      .send({ apiKey: API_KEY })
      .expect(200);
  });

  it('pulls at night only when the switch is on: this month up to yesterday', async () => {
    const flow = app.get(EbarimtPullFlowService);
    const actor = systemActor('job:ebarimtcheck.pull');
    expect(await flow.pullNightly(actor)).toBeNull();

    await http()
      .put('/api/v1/ebarimt-check/connection')
      .set(bearer(admin))
      .send({ nightly: true })
      .expect(200);
    const yesterday = addDays(businessDate(), -1);
    const period = Number.parseInt(yesterday.slice(0, 7).replace('-', ''), 10);
    fake.state.receipts = [receipt({ prPosRno: 'NIGHT-1', date: `${yesterday} 08:00:00` })];
    fake.state.asked = [];
    const night = await flow.pullNightly(actor);
    expect(night).toMatchObject({ ok: true, receipts: 1 });
    expect(night?.months.find((month) => month.period === period)?.changed).toBe(true);
    // Nothing past yesterday is asked for.
    expect(fake.state.asked.every((asked) => String(asked.body.endDate) <= yesterday)).toBe(true);
    // The same night again adds nothing.
    const twice = await flow.pullNightly(actor);
    expect(twice?.months.every((month) => !month.changed)).toBe(true);

    // The month's file is taken away again, so the other suites see the months they expect.
    const file = await monthFile(period);
    await http()
      .delete(`/api/v1/ebarimt-check/files/${period}`)
      .query({ fileId: file?.id })
      .set(bearer(admin))
      .expect(204);
  });

  it('forgets the password and the key when the environment changes', async () => {
    const changed = (
      await http()
        .put('/api/v1/ebarimt-check/connection')
        .set(bearer(admin))
        .send({ environment: 'PRODUCTION' })
        .expect(200)
    ).body as ConnectionJson;
    expect(changed).toMatchObject({
      environment: 'PRODUCTION',
      hasPassword: false,
      hasApiKey: false,
      complete: false,
    });
    expect(await pull()).toMatchObject({ ok: false, reason: 'NOT_CONFIGURED' });
    // A keeper has no right to pull.
    const keeper = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    await pull(PERIOD, keeper, 403);
  });
});
