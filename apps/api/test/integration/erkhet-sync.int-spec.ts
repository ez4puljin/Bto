import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import request from 'supertest';
import { ERKHET_FETCH, type ErkhetFetch } from '../../src/integrations/erkhet';
import { ERXES_FETCH, type ErxesFetch } from '../../src/modules/erxes/erxes.client';
import { ERXES_TILL_POS } from '../../src/modules/erxes/erxes-wire';
import { systemActor } from '../../src/modules/identity';
import { ErkhetRunFlowService } from '../../src/modules/erkhet/services/erkhet-run-flow.service';
import { ErkhetSyncService } from '../../src/modules/erkhet/services/erkhet-sync.service';
import { WorkerModule } from '../../src/worker.module';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

/** Not a real sign-in: no test reaches Erkhet, the «Erkhet» below is scripted. */
const PASSWORD = 'test-erkhet-password-not-real';
const COMPANY = '1234567890';
const EAN_A = '4006381333931';
const EAN_B = '5901234123457';
/** Not a real sign-in either: the «erxes» below is scripted (ADR-0223). */
const ERXES_EMAIL = 'bto@example.test';
const ERXES_PASSWORD = 'test-erxes-password-not-real';

async function workbook(rows: (string | number | null)[][]): Promise<Uint8Array<ArrayBuffer>> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Sheet_0');
  for (const row of rows) sheet.addRow(row);
  // Copied: a Response body wants bytes over a plain ArrayBuffer.
  return Uint8Array.from(Buffer.from(await book.xlsx.writeBuffer()));
}

const itemSheet = (rows: [string, string, string, number][]) =>
  workbook([
    ['Код', 'Нэр', 'Ангилал код', 'Ангилал нэр', 'Гадаад нэр', 'Баркод', 'Нэгж үнэ'],
    ...rows.map(([code, name, barcodes, price]) => [
      code,
      name,
      '101',
      'Ундаа',
      '',
      barcodes,
      price,
    ]),
  ]);

/** An Erkhet item with the columns a product added from Erkhet takes (ADR-0222). */
interface FullItem {
  code: string;
  name: string;
  category: string;
  barcodes: string;
  price: number | null;
  unit?: [string, string];
  ratio?: number | null;
  weight?: number | null;
}

const fullItemSheet = (rows: FullItem[]) =>
  workbook([
    [
      'Код',
      'Нэр',
      'Ангилал код',
      'Ангилал нэр',
      'Баркод',
      'Нэгж үнэ',
      'Хэмжих нэгж код',
      'Хэмжих нэгж нэр',
      'Задрах нэгж нэр',
      'Задрах харьцаа',
      'Жин',
    ],
    ...rows.map((row) => [
      row.code,
      row.name,
      '',
      row.category,
      row.barcodes,
      row.price,
      row.unit?.[0] ?? 'ш',
      row.unit?.[1] ?? 'ширхэг',
      'Хайрцаг',
      row.ratio ?? null,
      row.weight ?? null,
    ]),
  ]);

const customerSheet = (rows: [string, string, string, string, string][]) =>
  workbook([
    ['Код', 'Нэр', 'Бүлэг код', 'Бүлэг нэр', 'мэйл', 'Хаяг', 'Утас'],
    ...rows.map(([code, name, groupCode, groupName, phone]) => [
      code,
      name,
      groupCode,
      groupName,
      '',
      '',
      phone,
    ]),
  ]);

/**
 * «Эрхэт тулгалт» (ADR-0203) over HTTP, with the check itself run as the worker runs it. Erkhet is
 * scripted, so what is checked is ours: rights, the sign-in's secrecy, what a check finds, and
 * that «Bto-д тааруулах» changes customers and prices only through their own rules.
 */
describe('Erkhet sync check', () => {
  let app: NestExpressApplication;
  let worker: INestApplicationContext;
  let flow: ErkhetRunFlowService;
  let sql: Client;
  let admin: string;
  let reader: string;
  let outsider: string;
  let ward: number;
  let agreed: { id: number };
  let renamed: { id: number };
  let cola: { id: number };
  let juice: { id: number };
  let profile: number;
  /** What the scripted Erkhet holds; a test changes it before a check. */
  const erkhet = {
    password: PASSWORD,
    items: new Uint8Array(),
    customers: new Uint8Array(),
    posts: 0,
  };
  const http = () => request(app.getHttpServer());

  /** What the scripted erxes holds (ADR-0223); a test fills it. */
  const erxes = {
    categories: [] as { _id: string; name: string; code: string; parentId: string | null }[],
    tags: [] as { _id: string; name: string; parentId: string | null }[],
    tills: [
      { _id: 'pos-1', name: ERXES_TILL_POS, branchId: 'br-murun', departmentId: 'dp-pos' },
      { _id: 'pos-2', name: 'Хархорин', branchId: 'br-kh', departmentId: 'dp-kh' },
    ],
    plans: [] as Record<string, unknown>[],
    products: [] as Record<string, unknown>[],
    down: false,
    writes: 0,
    reads: 0,
  };
  const scriptedErxes: ErxesFetch = (_url, init) => {
    const answer = (body: unknown, headers: Record<string, string> = {}) =>
      Promise.resolve(new Response(JSON.stringify(body), { headers }));
    if (erxes.down) return Promise.reject(new TypeError('fetch failed'));
    const { query, variables } = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (query.startsWith('mutation login')) {
      return variables.email === ERXES_EMAIL && variables.password === ERXES_PASSWORD
        ? answer({ data: { login: 'loggedIn' } }, { 'set-cookie': 'auth-token=session1; Path=/' })
        : answer({ errors: [{ message: 'Invalid login' }] });
    }
    if (!query.startsWith('query ')) {
      erxes.writes += 1;
      return answer({ errors: [{ message: 'not allowed' }] });
    }
    if ((init.headers as Record<string, string>).cookie !== 'auth-token=session1') {
      return answer({ errors: [{ message: 'Login required' }] });
    }
    erxes.reads += 1;
    const root = /^query bto(?:\([^)]*\))? \{\n(\w+)/.exec(query)?.[1];
    switch (root) {
      case 'productCategories':
        return answer({ data: { productCategories: erxes.categories } });
      case 'tags':
        return answer({ data: { tags: erxes.tags } });
      case 'posList':
        return answer({ data: { posList: erxes.tills } });
      case 'pricingPlans':
        return answer({ data: { pricingPlans: erxes.plans } });
      case 'products': {
        expect(query).toContain('status: "active"');
        const perPage = variables.perPage as number;
        const page = variables.page as number;
        return answer({
          data: { products: erxes.products.slice((page - 1) * perPage, page * perPage) },
        });
      }
      default:
        return answer({
          errors: [{ message: `Cannot query field "${root ?? ''}" on type "Query".` }],
        });
    }
  };

  const scriptedErkhet: ErkhetFetch = (url, init) => {
    const headers = init.headers as Record<string, string>;
    const { pathname, searchParams } = new URL(url);
    const redirect = (location: string, cookie?: string) =>
      new Response(null, {
        status: 302,
        headers: { location, ...(cookie ? { 'set-cookie': cookie } : {}) },
      });
    if (init.method === 'POST') erkhet.posts += 1;
    if (pathname === '/login/' && init.method !== 'POST') {
      return Promise.resolve(
        new Response('<form>', { headers: { 'set-cookie': 'csrftoken=t1; Path=/' } }),
      );
    }
    if (pathname === '/login/') {
      const form = new URLSearchParams(typeof init.body === 'string' ? init.body : '');
      return Promise.resolve(
        form.get('password') === erkhet.password && form.get('login_with') === 'tester'
          ? redirect(`/${COMPANY}/`, 'sessionid=s1; Path=/')
          : new Response('<form>wrong</form>'),
      );
    }
    if (!headers.Cookie?.includes('sessionid=s1')) return Promise.resolve(redirect('/login/'));
    if (pathname === `/${COMPANY}/`) return Promise.resolve(new Response('home'));
    if (pathname === `/${COMPANY}/transactions/trs/to-excel/`) {
      const source = searchParams.get('source');
      const data =
        source === `/${COMPANY}/inventory/item/list/`
          ? erkhet.items
          : source === `/${COMPANY}/customers/list/`
            ? erkhet.customers
            : null;
      return Promise.resolve(data ? new Response(data) : new Response('<html>', { status: 404 }));
    }
    return Promise.resolve(new Response('<html>', { status: 404 }));
  };

  const overview = async (token = admin) =>
    (await http().get('/api/v1/erkhet/sync').set(bearer(token)).expect(200)).body as {
      configured: boolean;
      active: { id: number; status: string } | null;
      latest: {
        id: number;
        status: string;
        trigger: string;
        itemCount: number;
        summary: Record<
          'customers' | 'products',
          { erkhet: number; bto: number; agreed: number; issues: Record<string, number> }
        >;
      } | null;
      failed: { id: number; failure: string } | null;
    };
  const start = (token = admin) => http().post('/api/v1/erkhet/sync/runs').set(bearer(token));
  const items = async (query: Record<string, string>, token = admin) =>
    (await http().get('/api/v1/erkhet/sync/items').query(query).set(bearer(token)).expect(200))
      .body as {
      data: {
        id: number;
        issue: string;
        erkhetCode: string | null;
        erkhetPrice: string | null;
        btoId: number | null;
        btoPrice: string | null;
        resolution: string | null;
        plan: Record<string, unknown> | null;
        productPlan: Record<string, unknown> | null;
      }[];
      nextCursor: string | null;
    };
  const apply = (body: Record<string, unknown>, token = admin) =>
    http().post('/api/v1/erkhet/sync/apply').set(bearer(token)).send(body);
  /** A check from the button to its end, as the worker would run it. */
  const check = async () => {
    const run = (await start().expect(202)).body as { id: number; status: string };
    expect(run.status).toBe('QUEUED');
    return { id: run.id, ...(await flow.execute(run.id)) };
  };
  const priceOf = async (productId: number) =>
    (
      await sql.query<{ price: string }>(
        `SELECT warehouse_price::text AS price FROM product_prices
         WHERE product_id = $1 AND valid_to IS NULL`,
        [productId],
      )
    ).rows[0]?.price;

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) =>
        builder
          .overrideProvider(ERKHET_FETCH)
          .useValue(scriptedErkhet)
          .overrideProvider(ERXES_FETCH)
          .useValue(scriptedErxes),
    });
    // The worker's side without its job polling: the test runs a check itself.
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(ERKHET_FETCH)
      .useValue(scriptedErkhet)
      .overrideProvider(ERXES_FETCH)
      .useValue(scriptedErxes)
      .compile();
    flow = worker.get(ErkhetRunFlowService, { strict: false });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    reader = await customRoleUser(app, admin, ['erkhet.sync.read']);
    outsider = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;

    ward = (
      (
        await http()
          .post('/api/v1/customer-categories')
          .set(bearer(admin))
          .set(idempotency())
          .send({ name: '1-р хороо' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const partners = partnersApi(app, admin);
    agreed = await partners.customer({
      code: '50001',
      name: 'Нэг дэлгүүр',
      categoryId: ward,
      settlementGroup: 'MONTH_END',
    });
    renamed = await partners.customer({
      code: '50002',
      name: 'Хуучин нэр',
      categoryId: ward,
      settlementGroup: 'MONTH_END',
    });

    const catalog = catalogApi(app, admin);
    const drinks = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '100001',
      name: 'Кола 0.5л',
      categoryId: drinks,
      baseUomId: pcs,
      baseBarcodes: [EAN_A],
    });
    juice = await catalog.product({
      sku: '100002',
      name: 'Жүүс 1л',
      categoryId: drinks,
      baseUomId: pcs,
      baseBarcodes: [EAN_B],
    });
    const pricing = pricingApi(app, admin);
    profile = await pricing.profile('Үндсэн');
    await pricing.terms(cola.id, '1500', profile, null);
    await pricing.terms(juice.id, '2000', profile, null);

    erkhet.items = await itemSheet([
      // Erkhet's codes are not Bto's: the barcode is what joins them.
      ['900001', 'Кола 0.5л', EAN_A, 1500],
      ['900002', 'Жүүс 1л', `${EAN_B}, 12345`, 2100],
      ['900003', 'Шинэ бараа', '8690000000005', 990],
    ]);
    erkhet.customers = await customerSheet([
      ['50001', 'Нэг дэлгүүр', '501', '1-р хороо', ''],
      ['50002', 'Шинэ нэр', '501', '1-р хороо', ''],
      ['50009', 'Гурав дэлгүүр', '501', '1-р хороо', '99112233'],
      ['80001', 'Хархорин дэлгүүр', '82', 'Хархорин', ''],
    ]);
  });

  afterAll(async () => {
    await sql.end();
    await worker.close();
    await app.close();
  });

  it('keeps the routes to their rights', async () => {
    for (const token of [reader, outsider]) {
      await http().get('/api/v1/erkhet/settings').set(bearer(token)).expect(403);
      await http().patch('/api/v1/erkhet/settings').set(bearer(token)).send({}).expect(403);
      await http().post('/api/v1/erkhet/settings/test').set(bearer(token)).send({}).expect(403);
      await start(token).expect(403);
      await apply({ kind: 'PRODUCT', issue: 'PRICE_DIFFERS' }, token).expect(403);
    }
    await http().get('/api/v1/erkhet/sync').set(bearer(outsider)).expect(403);
    await http()
      .get('/api/v1/erkhet/sync/items')
      .query({ kind: 'PRODUCT' })
      .set(bearer(outsider))
      .expect(403);
    await overview(reader);
  });

  it('starts no check before a sign-in is saved', async () => {
    expect((await overview()).configured).toBe(false);
    const refused = await start().expect(409);
    expect(refused.body).toMatchObject({ code: 'ERKHET_NOT_CONFIGURED' });
  });

  it('saves the sign-in sealed and never gives the password back', async () => {
    const saved = await http()
      .patch('/api/v1/erkhet/settings')
      .set(bearer(admin))
      .send({
        baseUrl: 'https://erkhet.test/login/?next=/',
        companyId: COMPANY,
        username: ' tester ',
        password: PASSWORD,
      })
      .expect(200);
    expect(saved.body).toMatchObject({
      baseUrl: 'https://erkhet.test',
      companyId: COMPANY,
      username: 'tester',
      hasPassword: true,
      passwordUnreadable: false,
      secretReady: true,
      nightly: true,
      complete: true,
    });
    expect(JSON.stringify(saved.body)).not.toContain(PASSWORD);
    const stored = await sql.query<{ sealed: string }>(
      'SELECT password_sealed AS sealed FROM erkhet_settings WHERE id = 1',
    );
    expect(stored.rows[0]?.sealed).toMatch(/^v1\./);
    expect(stored.rows[0]?.sealed).not.toContain(PASSWORD);
    const audit = await sql.query<{ row: string }>(
      `SELECT row_to_json(a)::text AS row FROM audit_log a WHERE entity = 'erkhet_settings'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.row).not.toContain(PASSWORD);
    expect(audit.rows[0]?.row).not.toContain(stored.rows[0]?.sealed);

    await http()
      .patch('/api/v1/erkhet/settings')
      .set(bearer(admin))
      .send({ baseUrl: 'http://erkhet.test' })
      .expect(422);
    const ok = await http()
      .post('/api/v1/erkhet/settings/test')
      .set(bearer(admin))
      .send({})
      .expect(200);
    expect(ok.body).toEqual({ ok: true, reason: null, status: null });
    const wrong = await http()
      .post('/api/v1/erkhet/settings/test')
      .set(bearer(admin))
      .send({ password: 'another-password' })
      .expect(200);
    expect(wrong.body).toMatchObject({ ok: false, reason: 'LOGIN_FAILED' });
    // The saved password is never tried against an address that is only typed.
    const elsewhere = await http()
      .post('/api/v1/erkhet/settings/test')
      .set(bearer(admin))
      .send({ baseUrl: 'https://elsewhere.test' })
      .expect(200);
    expect(elsewhere.body).toMatchObject({ ok: false, reason: 'NOT_CONFIGURED' });
  });

  it('runs one check at a time and stores what differs', async () => {
    const run = (await start().expect(202)).body as { id: number };
    expect((await start().expect(409)).body).toMatchObject({ code: 'ERKHET_SYNC_RUNNING' });
    expect((await overview()).active).toMatchObject({ id: run.id, status: 'QUEUED' });
    expect(await flow.execute(run.id)).toEqual({ status: 'DONE' });
    // A second delivery of the job leaves a finished check alone.
    expect(await flow.execute(run.id)).toEqual({ status: 'SKIPPED' });

    const seen = await overview(reader);
    expect(seen.active).toBeNull();
    expect(seen.latest).toMatchObject({ id: run.id, status: 'DONE', trigger: 'MANUAL' });
    expect(seen.latest?.summary.customers).toEqual({
      erkhet: 4,
      bto: 2,
      agreed: 1,
      issues: { NAME_DIFFERS: 1, MISSING_IN_BTO: 1, GROUP_NOT_TAKEN: 1 },
    });
    expect(seen.latest?.summary.products).toEqual({
      erkhet: 3,
      bto: 2,
      agreed: 1,
      issues: { PRICE_DIFFERS: 1, MISSING_IN_BTO: 1 },
    });
    expect(seen.latest?.itemCount).toBe(5);

    const prices = await items({ kind: 'PRODUCT', issue: 'PRICE_DIFFERS' }, reader);
    expect(prices.data).toHaveLength(1);
    expect(prices.data[0]).toMatchObject({
      erkhetCode: '900002',
      erkhetPrice: '2100.00',
      btoId: juice.id,
      btoPrice: '2000.00',
      resolution: null,
    });
    expect((await items({ kind: 'PRODUCT', q: 'шинэ бар' })).data.map((row) => row.issue)).toEqual([
      'MISSING_IN_BTO',
    ]);
    const paged = await items({ kind: 'CUSTOMER', limit: '2' });
    expect(paged.data).toHaveLength(2);
    const rest = await items({ kind: 'CUSTOMER', limit: '2', cursor: paged.nextCursor ?? '' });
    expect(rest.data).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
    // Reading Erkhet never posts anything but the sign-in form.
    expect(erkhet.posts).toBeGreaterThan(0);
  });

  it('brings Bto to Erkhet through the customers and prices own rules', async () => {
    const before = (await overview()).latest;
    const priced = await apply({ kind: 'PRODUCT', issue: 'PRICE_DIFFERS' }).expect(200);
    expect(priced.body).toMatchObject({ applied: 1, stale: 0, refused: 0, skipped: 0 });
    expect(await priceOf(juice.id)).toBe('2100.00');
    expect(await priceOf(cola.id)).toBe('1500.00');
    // Again: the row is settled, nothing is written twice.
    expect((await apply({ kind: 'PRODUCT', issue: 'PRICE_DIFFERS' }).expect(200)).body).toEqual({
      applied: 0,
      stale: 0,
      refused: 0,
      skipped: 0,
      fallback: 0,
      erxesFailure: null,
    });

    const customers = await items({ kind: 'CUSTOMER' });
    const missing = customers.data.find((row) => row.issue === 'MISSING_IN_BTO');
    const outside = customers.data.find((row) => row.issue === 'GROUP_NOT_TAKEN');
    const differs = customers.data.find((row) => row.issue === 'NAME_DIFFERS');
    expect(missing?.plan).toEqual({
      categoryId: ward,
      settlementGroup: 'MONTH_END',
      kind: 'COMPANY',
      phone: '+97699112233',
    });
    const done = await apply({
      itemIds: [missing?.id, outside?.id, differs?.id],
    }).expect(200);
    // A group Bto never took is shown, never created.
    expect(done.body).toEqual({
      applied: 2,
      stale: 0,
      refused: 0,
      skipped: 1,
      fallback: 0,
      erxesFailure: null,
    });
    const created = await sql.query<{
      name: string;
      phone: string;
      category_id: string;
      settlement_group: string;
    }>(`SELECT name, phone, category_id, settlement_group FROM customers WHERE code = '50009'`);
    expect(created.rows[0]).toEqual({
      name: 'Гурав дэлгүүр',
      phone: '+97699112233',
      category_id: String(ward),
      settlement_group: 'MONTH_END',
    });
    expect(await partnersApi(app, admin).getCustomer(renamed.id)).toMatchObject({
      name: 'Шинэ нэр',
    });
    expect(await partnersApi(app, admin).getCustomer(agreed.id)).toMatchObject({
      name: 'Нэг дэлгүүр',
    });
    expect((await sql.query(`SELECT 1 FROM customers WHERE code = '80001'`)).rowCount).toBe(0);
    // Every change is the acting person's, in the audit of the table it changed.
    const audited = await sql.query<{ entity: string; action: string }>(
      `SELECT entity, action FROM audit_log
       WHERE (entity = 'customers'
              AND entity_id::text IN (SELECT id::text FROM customers WHERE code IN ('50002', '50009')))
          OR entity = 'product_prices'
       ORDER BY id`,
    );
    expect(
      audited.rows
        .filter((row) => row.entity === 'customers')
        .map((row) => row.action)
        .sort(),
    ).toEqual(['CREATE', 'CREATE', 'UPDATE']);
    expect(audited.rows.some((row) => row.entity === 'product_prices')).toBe(true);
    expect(before?.id).toBe((await overview()).latest?.id);
    expect((await items({ kind: 'CUSTOMER', open: 'true' })).data.map((row) => row.issue)).toEqual([
      'GROUP_NOT_TAKEN',
    ]);
  });

  it('leaves alone what changed in Bto since the check, and rows of an older check', async () => {
    const first = (await overview()).latest;
    const old = (await items({ kind: 'CUSTOMER', issue: 'GROUP_NOT_TAKEN' })).data[0];
    erkhet.items = await itemSheet([
      ['900001', 'Кола 0.5л', EAN_A, 1600],
      ['900002', 'Жүүс 1л', EAN_B, 2100],
    ]);
    expect(await check()).toMatchObject({ status: 'DONE' });
    const second = (await overview()).latest;
    expect(second?.id).toBeGreaterThan(first?.id ?? 0);
    expect(second?.summary.customers.issues).toEqual({ GROUP_NOT_TAKEN: 1 });
    expect(second?.summary.products.issues).toEqual({ PRICE_DIFFERS: 1 });

    // Someone sets another price by hand after the check.
    await pricingApi(app, admin).terms(cola.id, '1700', profile, null);
    const stale = await apply({ kind: 'PRODUCT', issue: 'PRICE_DIFFERS' }).expect(200);
    expect(stale.body).toMatchObject({ applied: 0, stale: 1, refused: 0, skipped: 0 });
    expect(await priceOf(cola.id)).toBe('1700.00');
    expect((await items({ kind: 'PRODUCT' })).data[0]).toMatchObject({ resolution: 'STALE' });

    const superseded = await apply({ itemIds: [old?.id] }).expect(409);
    expect(superseded.body).toMatchObject({ code: 'ERKHET_RUN_SUPERSEDED' });
    await apply({ itemIds: [999_999_999] }).expect(422);
    await apply({}).expect(422);
  });

  it('adds products missing in Bto from what Erkhet says, in the chosen category (ADR-0222)', async () => {
    const catalog = catalogApi(app, admin);
    const chinese = (
      (
        await http()
          .post('/api/v1/categories')
          .set(bearer(admin))
          .send({ name: 'Хятад бараа', skuFrom: '300000', skuTo: '399999' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const kharkhorin = 'Хархорин Боломж';
    erkhet.items = await fullItemSheet([
      { code: '900001', name: 'Кола 0.5л', category: 'Ундаа', barcodes: EAN_A, price: 1700 },
      { code: '900002', name: 'Жүүс 1л', category: 'Ундаа', barcodes: EAN_B, price: 2100 },
      {
        code: '700001',
        name: 'Хятад аяга',
        category: 'Хятад бараа',
        barcodes: '8690000000012, 8690000000029',
        price: 990,
        ratio: 1 / 12,
        weight: 0.25,
      },
      // A code Bto cannot take and a price with a fraction: the next code, no price.
      {
        code: 'A-77',
        name: 'Хятад сав',
        category: 'Хятад бараа',
        barcodes: '8690000000036',
        price: 1200.5,
        unit: ['кг', 'Килограмм'],
      },
      {
        code: '700003',
        name: 'Боломжийн бараа',
        category: kharkhorin,
        barcodes: '8690000000043',
        price: 500,
      },
      {
        code: '700004',
        name: 'Дараа бүртгэсэн',
        category: 'Хятад бараа',
        barcodes: '8690000000050',
        price: 700,
      },
      {
        code: '700005',
        name: 'Хуучин мөр',
        category: 'Хятад бараа',
        barcodes: '8690000000067',
        price: 800,
      },
    ]);
    expect(await check()).toMatchObject({ status: 'DONE' });
    const missing = (await items({ kind: 'PRODUCT', issue: 'MISSING_IN_BTO' })).data;
    const row = (code: string) => missing.find((one) => one.erkhetCode === code);
    expect(missing).toHaveLength(5);
    // Erkhet's unit, box and weight are kept with the row for «Bto-д нэмэх».
    expect(row('700001')?.plan).toBeNull();
    expect(row('700001')?.productPlan).toMatchObject({
      unitCode: 'ш',
      unitName: 'ширхэг',
      weight: '0.25',
    });
    expect(row('700001')?.productPlan?.packRatio).toMatch(/^0\.08333/);
    // Erkhet's category is searched too: the owner leaves «Хархорин Боломж» out by it.
    expect(
      (await items({ kind: 'PRODUCT', q: 'хархорин' })).data.map((one) => one.erkhetCode),
    ).toEqual(['700003']);

    // Someone registers one of them by hand after the check; another row is of an older check.
    const pcs = await catalog.uomId('PCS');
    await catalog.product({
      sku: '100090',
      name: 'Гараар бүртгэсэн',
      categoryId: await catalog.category('Гараар'),
      baseUomId: pcs,
      baseBarcodes: ['8690000000050'],
    });
    await sql.query('UPDATE erkhet_sync_items SET plan = NULL WHERE id = $1', [row('700005')?.id]);

    const ticked = ['700001', 'A-77', '700004', '700005'].map((code) => row(code)?.id);
    for (const token of [reader, outsider]) {
      await apply({ itemIds: ticked, categoryId: chinese, profileId: profile }, token).expect(403);
    }
    // A choice that is given must be usable (ADR-0223: either may be left out).
    await apply({ itemIds: ticked, categoryId: 999_999, profileId: profile }).expect(422);
    await apply({ itemIds: ticked, categoryId: chinese, profileId: 999_999 }).expect(422);
    expect(
      (await items({ kind: 'PRODUCT', issue: 'MISSING_IN_BTO', open: 'true' })).data,
    ).toHaveLength(5);

    const added = await apply({ itemIds: ticked, categoryId: chinese, profileId: profile }).expect(
      200,
    );
    // No erxes sign-in is saved yet: every product takes the dialog's choices (ADR-0223).
    expect(added.body).toEqual({
      applied: 2,
      stale: 1,
      refused: 1,
      skipped: 0,
      fallback: 2,
      erxesFailure: 'NOT_CONFIGURED',
    });

    const products = await sql.query<{
      id: string;
      sku: string;
      name: string;
      category_id: string;
      weight_kg: string | null;
      ready: boolean;
    }>(
      `SELECT id, sku, name, category_id, weight_kg::text, sale_ready_at IS NOT NULL AS ready
       FROM products WHERE name IN ('Хятад аяга', 'Хятад сав') ORDER BY name`,
    );
    const [cup, jar] = products.rows;
    expect(cup).toMatchObject({
      sku: '700001',
      name: 'Хятад аяга',
      category_id: String(chinese),
      weight_kg: '0.2500',
      ready: true,
    });
    expect(jar).toMatchObject({ sku: '300000', name: 'Хятад сав', weight_kg: null, ready: false });
    const units = await sql.query<{ product: string; uom: string; factor: string; codes: string }>(
      `SELECT u.product_id::text AS product, m.code AS uom, u.factor_to_base::text AS factor,
              coalesce(string_agg(b.code, ',' ORDER BY b.code), '') AS codes
       FROM product_units u JOIN uoms m ON m.id = u.uom_id
       LEFT JOIN product_barcodes b ON b.product_unit_id = u.id
       WHERE u.product_id IN ($1, $2)
       GROUP BY u.product_id, m.code, u.factor_to_base ORDER BY u.product_id, u.factor_to_base`,
      [cup?.id, jar?.id],
    );
    expect(units.rows).toEqual([
      { product: cup?.id, uom: 'PCS', factor: '1.000000', codes: '8690000000012,8690000000029' },
      { product: cup?.id, uom: 'BOX', factor: '12.000000', codes: '' },
      { product: jar?.id, uom: 'KG', factor: '1.000000', codes: '8690000000036' },
    ]);
    // Erkhet's price from today with the chosen profile, the box counted whole.
    const terms = await sql.query<{ price: string; profile: string; whole: string | null }>(
      `SELECT p.warehouse_price::text AS price, p.profile_id::text AS profile, m.code AS whole
       FROM product_prices p LEFT JOIN uoms m ON m.id = p.whole_uom_id
       WHERE p.product_id = $1 AND p.valid_to IS NULL`,
      [cup?.id],
    );
    expect(terms.rows).toEqual([{ price: '990.00', profile: String(profile), whole: 'BOX' }]);
    expect(await priceOf(Number(jar?.id))).toBeUndefined();

    const settled = (await items({ kind: 'PRODUCT', issue: 'MISSING_IN_BTO' })).data;
    expect(Object.fromEntries(settled.map((one) => [one.erkhetCode, one.resolution]))).toEqual({
      '700001': 'APPLIED',
      'A-77': 'APPLIED',
      '700003': null,
      '700004': 'STALE',
      '700005': 'REFUSED',
    });
    // Audited as the person's: the products, the price and the completion.
    const audited = await sql.query<{ entity: string; action: string }>(
      `SELECT entity, action FROM audit_log
       WHERE entity_id::text = $1 AND entity IN ('products', 'product_prices') ORDER BY id`,
      [cup?.id],
    );
    expect(audited.rows.map((one) => `${one.entity}:${one.action}`)).toEqual([
      'products:CREATE',
      'product_prices:UPDATE',
      'products:COMPLETE',
    ]);
  });

  it("prices products Bto has without a price from Erkhet's price, and completes them (ADR-0222)", async () => {
    const catalog = catalogApi(app, admin);
    const drinks = await catalog.category('Ундаа 2');
    const pcs = await catalog.uomId('PCS');
    const boxUom = await catalog.uomId('BOX');
    const blockUom = await catalog.uomId('BLOCK');
    const unpriced = await catalog.product({
      sku: '100101',
      name: 'Үнэгүй ус',
      categoryId: drinks,
      baseUomId: pcs,
      baseBarcodes: ['8690000000074'],
      units: [
        { uomId: blockUom, factorToBase: '6' },
        { uomId: boxUom, factorToBase: '24' },
      ],
    });
    const noErkhetPrice = await catalog.product({
      sku: '100102',
      name: 'Эрхэтэд үнэгүй',
      categoryId: drinks,
      baseUomId: pcs,
      baseBarcodes: ['4600000000008'],
    });
    const pricedSince = await catalog.product({
      sku: '100103',
      name: 'Дараа үнэлсэн',
      categoryId: drinks,
      baseUomId: pcs,
      baseBarcodes: ['4600000000015'],
    });
    erkhet.items = await fullItemSheet([
      { code: '900001', name: 'Кола 0.5л', category: 'Ундаа', barcodes: EAN_A, price: 1700 },
      { code: '900002', name: 'Жүүс 1л', category: 'Ундаа', barcodes: EAN_B, price: 2100 },
      {
        code: '900010',
        name: 'Үнэгүй ус',
        category: 'Ундаа',
        barcodes: '8690000000074',
        price: 3000,
      },
      {
        code: '900011',
        name: 'Эрхэтэд үнэгүй',
        category: 'Ундаа',
        barcodes: '4600000000008',
        price: null,
      },
      {
        code: '900012',
        name: 'Дараа үнэлсэн',
        category: 'Ундаа',
        barcodes: '4600000000015',
        price: 800,
      },
    ]);
    expect(await check()).toMatchObject({ status: 'DONE' });
    expect((await overview()).latest?.summary.products.issues).toMatchObject({ NO_BTO_PRICE: 3 });

    await pricingApi(app, admin).terms(pricedSince.id, '750', profile, null);
    await apply({ kind: 'PRODUCT', issue: 'NO_BTO_PRICE', profileId: profile }, reader).expect(403);
    const priced = await apply({
      kind: 'PRODUCT',
      issue: 'NO_BTO_PRICE',
      profileId: profile,
    }).expect(200);
    expect(priced.body).toEqual({
      applied: 1,
      stale: 1,
      refused: 1,
      skipped: 0,
      fallback: 1,
      erxesFailure: 'NOT_CONFIGURED',
    });

    // The largest pack is counted whole; the product is complete.
    const terms = await sql.query<{ price: string; whole: string | null; ready: boolean }>(
      `SELECT p.warehouse_price::text AS price, m.code AS whole, d.sale_ready_at IS NOT NULL AS ready
       FROM product_prices p LEFT JOIN uoms m ON m.id = p.whole_uom_id
       JOIN products d ON d.id = p.product_id
       WHERE p.product_id = $1 AND p.valid_to IS NULL`,
      [unpriced.id],
    );
    expect(terms.rows).toEqual([{ price: '3000.00', whole: 'BOX', ready: true }]);
    expect(await priceOf(noErkhetPrice.id)).toBeUndefined();
    expect(await priceOf(pricedSince.id)).toBe('750.00');
    const rows = (await items({ kind: 'PRODUCT', issue: 'NO_BTO_PRICE' })).data;
    expect(Object.fromEntries(rows.map((one) => [one.erkhetCode, one.resolution]))).toEqual({
      '900010': 'APPLIED',
      '900011': 'REFUSED',
      '900012': 'STALE',
    });
  });

  it('files added and priced products as erxes files them, else as chosen (ADR-0223)', async () => {
    const catalog = catalogApi(app, admin);
    const pricing = pricingApi(app, admin);
    const pcs = await catalog.uomId('PCS');
    const category = async (name: string, skuFrom?: string, skuTo?: string) =>
      (
        (
          await http()
            .post('/api/v1/categories')
            .set(bearer(admin))
            .send({ name, ...(skuFrom ? { skuFrom, skuTo } : {}) })
            .expect(201)
        ).body as { id: number }
      ).id;
    // Bto's categories as the product master made them from erxes's (ADR-0098).
    const liquor = await category('861 Тест архи', '861000', '861999');
    const whisky = await category('862 Тест виски', '862000', '862999');
    const group = await category('Тест групп');
    const fallbackCategory = await category('Нөөц ангилал');
    // Bto's profiles as the copy of erxes's plans made them (ADR-0207): «Архи» for the plans of
    // the tag «Архи», the main one for none.
    const liquorProfile = await pricing.profile('Тест Архи');
    const mainProfile = await pricing.profile('Тест үндсэн');
    // Bto's products of erxes's price group «Архи» carry «Тест Архи» but one.
    const sibling = async (sku: string, profileId: number) => {
      const product = await catalog.product({
        sku,
        name: `Архи ${sku}`,
        categoryId: liquor,
        baseUomId: pcs,
        baseBarcodes: [],
      });
      await pricing.terms(product.id, '10000', profileId, null);
    };
    await sibling('861001', liquorProfile);
    await sibling('861002', liquorProfile);
    await sibling('861003', mainProfile);
    // A product Bto has without a price: erxes prices it as «Архи».
    const unpriced = await catalog.product({
      sku: '861004',
      name: 'Үнэгүй архи',
      categoryId: liquor,
      baseUomId: pcs,
      baseBarcodes: ['8690000000203'],
    });

    erxes.categories = [
      { _id: 'c-861', name: '861 Тест архи', code: '861', parentId: 'c-root' },
      { _id: 'c-862', name: '862 Тест виски', code: '862', parentId: 'c-root' },
      { _id: 'c-plus', name: '+Тест групп', code: '920', parentId: 'c-root' },
      { _id: 'c-kh', name: 'Хархорин Боломж', code: '990', parentId: 'c-root' },
    ];
    erxes.tags = [
      { _id: 't-liquor', name: '110 - Архи', parentId: null },
      { _id: 't-liquor-kid', name: 'Архи 0.5', parentId: 't-liquor' },
    ];
    const plan = (id: string, fields: Record<string, unknown>) => ({
      _id: id,
      name: id,
      status: 'active',
      isPriority: true,
      applyType: 'tag',
      products: [],
      productsExcluded: [],
      tags: [],
      tagsExcluded: [],
      branchIds: ['br-murun'],
      departmentIds: ['dp-pos'],
      pipelineId: null,
      ...fields,
    });
    erxes.plans = [
      plan('pl-liquor', { tags: ['t-liquor'] }),
      plan('pl-liquor-bulk', { tags: ['t-liquor'], isPriority: false }),
      // Kharkhorin's till prices elsewhere: its plan is no part of a group here.
      plan('pl-kh', { tags: ['t-liquor'], branchIds: ['br-kh'], departmentIds: ['dp-kh'] }),
      // A plan naming one product: that product does not vote.
      plan('pl-one', { applyType: 'product', products: ['e-861003'] }),
    ];
    const product = (
      id: string,
      code: string,
      categoryId: string,
      tagIds: string[],
      barcodes: string[] = [],
    ) => ({
      _id: id,
      code,
      barcodes,
      categoryId,
      tagIds,
    });
    erxes.products = [
      product('e-861001', '861001', 'c-861', ['t-liquor']),
      product('e-861002', '861002', 'c-861', ['t-liquor-kid']),
      product('e-861003', '861003', 'c-861', ['t-liquor']),
      product('e-861004', '861004', 'c-861', ['t-liquor']),
      product('e-whisky', '862010', 'c-862', ['t-liquor']),
      // Erkhet's code is not erxes's here: found by its barcode.
      product('e-group', '920001', 'c-plus', [], ['8690000000210']),
      product('e-kh', '990001', 'c-kh', ['t-liquor']),
    ];

    erkhet.items = await fullItemSheet([
      {
        code: '862010',
        name: 'Тест виски',
        category: 'Архи',
        barcodes: '8690000000227',
        price: 25000,
      },
      {
        code: '862011',
        name: 'Тест бүлэг',
        category: 'Бусад',
        barcodes: '8690000000210',
        price: 3000,
      },
      {
        code: '862012',
        name: 'Erxes-д байхгүй',
        category: 'Бусад',
        barcodes: '8690000000234',
        price: 4000,
      },
      {
        code: '990001',
        name: 'Боломж бараа',
        category: 'Хархорин Боломж',
        barcodes: '8690000000241',
        price: 5000,
      },
      {
        code: '861004',
        name: 'Үнэгүй архи',
        category: 'Архи',
        barcodes: '8690000000203',
        price: 12000,
      },
    ]);
    expect(await check()).toMatchObject({ status: 'DONE' });
    const missing = (await items({ kind: 'PRODUCT', issue: 'MISSING_IN_BTO', open: 'true' })).data;
    const rowOf = (code: string) => missing.find((one) => one.erkhetCode === code)?.id;

    // erxes is not reached: nothing is known of it, nothing taken from it.
    await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ email: ERXES_EMAIL, password: ERXES_PASSWORD })
      .expect(200);
    erxes.down = true;
    const unreachable = await apply({ itemIds: [rowOf('862012')], profileId: mainProfile }).expect(
      200,
    );
    // Without a category to fall back on, an item erxes does not settle is refused.
    expect(unreachable.body).toEqual({
      applied: 0,
      stale: 0,
      refused: 1,
      skipped: 0,
      fallback: 0,
      erxesFailure: 'UNREACHABLE',
    });
    erxes.down = false;

    const added = await apply({
      itemIds: ['862010', '862011', '990001'].map(rowOf),
      categoryId: fallbackCategory,
      profileId: mainProfile,
    }).expect(200);
    // The group's product found by its barcode takes the chosen profile (its group has no Bto
    // product), Kharkhorin's the chosen category (Bto has none of it).
    expect(added.body).toEqual({
      applied: 3,
      stale: 0,
      refused: 0,
      skipped: 0,
      fallback: 2,
      erxesFailure: null,
    });
    const filed = await sql.query<{ sku: string; category: string; profile: string | null }>(
      `SELECT p.sku, p.category_id::text AS category, t.profile_id::text AS profile
       FROM products p LEFT JOIN product_prices t ON t.product_id = p.id AND t.valid_to IS NULL
       WHERE p.sku IN ('862010', '862011', '990001') ORDER BY p.sku`,
    );
    expect(filed.rows).toEqual([
      { sku: '862010', category: String(whisky), profile: String(liquorProfile) },
      { sku: '862011', category: String(group), profile: String(mainProfile) },
      { sku: '990001', category: String(fallbackCategory), profile: String(liquorProfile) },
    ]);

    // «Үнийг тааруулах» takes the group's profile too, over the chosen one.
    const priced = await apply({
      kind: 'PRODUCT',
      issue: 'NO_BTO_PRICE',
      profileId: mainProfile,
    }).expect(200);
    expect(priced.body).toMatchObject({ applied: 1, fallback: 0, erxesFailure: null });
    const terms = await sql.query<{ price: string; profile: string }>(
      `SELECT warehouse_price::text AS price, profile_id::text AS profile FROM product_prices
       WHERE product_id = $1 AND valid_to IS NULL`,
      [unpriced.id],
    );
    expect(terms.rows).toEqual([{ price: '12000.00', profile: String(liquorProfile) }]);
    // Only queries reached erxes.
    expect(erxes.reads).toBeGreaterThan(0);
    expect(erxes.writes).toBe(0);
  });

  it('says why a check failed and keeps the last good one on the page', async () => {
    const good = (await overview()).latest;
    erkhet.password = 'changed-in-erkhet';
    expect(await check()).toMatchObject({ status: 'FAILED', failure: 'LOGIN_FAILED' });
    erkhet.password = PASSWORD;
    const seen = await overview();
    expect(seen.failed).toMatchObject({ failure: 'LOGIN_FAILED' });
    expect(seen.latest?.id).toBe(good?.id);
    expect(seen.active).toBeNull();

    // A file that is not the list is refused whole.
    const customers = erkhet.customers;
    erkhet.customers = erkhet.items;
    expect(await check()).toMatchObject({ status: 'FAILED', failure: 'UNEXPECTED_FILE' });
    erkhet.customers = customers;
    expect((await overview()).latest?.id).toBe(good?.id);
  });

  it("starts the night's check once a day, and not when it is switched off", async () => {
    // The same service the worker's schedule calls; the api's copy has pg-boss started.
    const sync = app.get(ErkhetSyncService, { strict: false });
    const actor = systemActor('job:erkhet.nightly');
    const night = await sync.startNightly(actor);
    expect(night.started).toBe(true);
    expect(await sync.startNightly(actor)).toEqual({
      started: false,
      reason: 'ERKHET_SYNC_RUNNING',
    });
    expect(await flow.execute(night.runId ?? 0)).toEqual({ status: 'DONE' });
    expect((await overview()).latest).toMatchObject({ id: night.runId, trigger: 'NIGHTLY' });
    expect(await sync.startNightly(actor)).toEqual({ started: false, reason: 'ALREADY_TODAY' });

    await http()
      .patch('/api/v1/erkhet/settings')
      .set(bearer(admin))
      .send({ nightly: false })
      .expect(200);
    expect(await sync.startNightly(actor)).toEqual({ started: false, reason: 'SWITCHED_OFF' });
    // A new address takes the saved password away: it was typed for the old one.
    const moved = await http()
      .patch('/api/v1/erkhet/settings')
      .set(bearer(admin))
      .send({ baseUrl: 'https://erkhet2.test' })
      .expect(200);
    expect(moved.body).toMatchObject({ hasPassword: false, complete: false });
    expect(await sync.startNightly(actor)).toEqual({ started: false, reason: 'NOT_CONFIGURED' });
  });
});
