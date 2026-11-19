import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { ERXES_FETCH, type ErxesFetch } from '../../src/modules/erxes/erxes.client';
import { FIXTURE_DEAL, FIXTURE_FIELDS } from '../../src/modules/erxes/erxes-wire.fixture';
import { ErxesPullFlowService } from '../../src/modules/erxes/services/erxes-pull-flow.service';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

/** Not a real sign-in: no test reaches erxes, the «erxes» below is scripted. */
const EMAIL = 'bto@example.test';
const PASSWORD = 'test-erxes-password-not-real';
const EAN_JUICE = '5901234123457';
const PIPELINE = 'pl-murun';
const NO_ROLES = { VIEW: [], MANAGE: [], ALL_ORDERS: [] };
const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
});

type Deal = Record<string, unknown> & { _id: string; createdAt: string };

interface PipelineJson {
  id: number;
  erxesId: string;
  name: string;
  boardName: string | null;
  blocked: boolean;
  enabled: boolean;
  btoPipelineId: number | null;
  btoStageId: number | null;
  btoPipelineName: string | null;
  btoStageName: string | null;
  placeOk: boolean;
}
interface DealJson {
  id: number;
  erxesId: string;
  status: string;
  name: string | null;
  number: string | null;
  orderId: number | null;
  creatorName: string | null;
  creatorUserId: number | null;
  creatorUserName: string | null;
  url: string;
  issues: { reason: string; code?: string; name?: string; errorCode?: string }[];
  assigned: string[];
  labels: { name: string }[];
  customFields: { label: string; value: string }[];
  lines: {
    code: string | null;
    quantity: string | null;
    unitPrice: string | null;
    discount: string | null;
    amount: string | null;
    unit: { sku: string; unitName: string } | null;
  }[];
  attachments: { name: string | null; url: string }[];
  customer: { id: number; code: string } | null;
  raw: Record<string, unknown>;
}
interface PullJson {
  ok: boolean;
  failure: string | null;
  pipelines: number;
  seen: number;
  copied: number;
  waiting: number;
}

/**
 * erxes's deals copied as draft orders (ADR-0218) over HTTP, with erxes scripted. What is checked
 * is ours: rights, the sign-in's secrecy, that only queries are sent, a new deal of a ticked
 * pipeline becoming exactly one draft with its customer, lines, note and creator, a deal that
 * cannot be matched waiting with its reason until it can, and the whole deal kept for the panel.
 */
describe('erxes deal copy', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let reader: string;
  let outsider: string;
  let seller: { id: number };
  let mapped: { id: number };
  let cola: ProductJson;
  let juice: ProductJson;
  let warehouseId: number;
  let profile: number;
  let category: number;
  let pcs: number;
  let shop: { id: number };
  let other: { id: number };
  let btoPipeline: { id: number; stages: { id: number; name: string }[] };
  let murun: PipelineJson;
  /** What the scripted erxes holds; a test adds deals before a pull. */
  const erxes = {
    deals: [] as Deal[],
    products: [
      { _id: 'p-cola', name: 'Кола 0.5л', code: '7801', barcodes: [], uom: 'ш', unitPrice: 1500 },
      {
        _id: 'p-old',
        name: 'Жүүс 1л',
        code: '900123',
        barcodes: [EAN_JUICE],
        uom: 'ш',
        unitPrice: 800,
      },
      { _id: 'p-new', name: 'Шинэ бараа', code: '7899', barcodes: [], uom: 'ш', unitPrice: 500 },
    ] as Record<string, unknown>[],
    logins: 0,
    writes: 0,
    details: 0,
    /** Every query of a root erxes refuses, as the real one refuses a missing argument. */
    refuse: new Set<string>(),
  };
  const http = () => request(app.getHttpServer());

  const scriptedErxes: ErxesFetch = (url, init) => {
    const answer = (body: unknown, headers: Record<string, string> = {}) =>
      Promise.resolve(new Response(JSON.stringify(body), { headers }));
    expect(url).toBe('https://erxes.bto.mn/gateway/graphql');
    const { query, variables } = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
      query: string;
      variables: Record<string, unknown>;
    };
    if (query.startsWith('mutation login')) {
      erxes.logins += 1;
      return variables.email === EMAIL && variables.password === PASSWORD
        ? answer({ data: { login: 'loggedIn' } }, { 'set-cookie': 'auth-token=session1; Path=/' })
        : answer({ errors: [{ message: 'Invalid login' }] });
    }
    // Anything that is not a query would change erxes: counted, and refused.
    if (!query.startsWith('query ')) {
      erxes.writes += 1;
      return answer({ errors: [{ message: 'not allowed' }] });
    }
    if ((init.headers as Record<string, string>).cookie !== 'auth-token=session1') {
      return answer({ errors: [{ message: 'Login required' }] });
    }
    const root = /^query bto(?:\([^)]*\))? \{\n(\w+)/.exec(query)?.[1];
    if (root && erxes.refuse.has(root)) {
      return answer({
        errors: [{ message: `Field "${root}" argument "x" of type "String!" is required` }],
      });
    }
    switch (root) {
      case 'salesBoards':
        // The real erxes answers nothing without the type (ADR-0220).
        if (!query.includes('salesBoards(type: "deal")')) {
          return answer({
            errors: [
              {
                message:
                  'Field "salesBoards" argument "type" of type "String!" is required, but it was not provided.',
              },
            ],
          });
        }
        return answer({
          data: {
            salesBoards: [
              {
                _id: 'b-khuvsgul',
                name: 'Хөвсгөл',
                pipelines: [
                  { _id: PIPELINE, name: 'Мөрөн Борлуулалт' },
                  { _id: 'pl-cash', name: 'Бэлэн борлуулалт' },
                ],
              },
              {
                _id: 'b-kharkhorin',
                name: 'Хархорин',
                pipelines: [{ _id: 'pl-kh', name: 'Хархорин борлуулалт' }],
              },
            ],
          },
        });
      case 'users':
        return answer({
          data: {
            users: [
              FIXTURE_DEAL.createdUser,
              {
                _id: 'u-stranger',
                email: 'stranger@example.test',
                username: 'stranger',
                details: { fullName: 'Гадны Хүн' },
              },
            ],
          },
        });
      case 'deals': {
        const skip = typeof variables.skip === 'number' ? variables.skip : 0;
        const limit = typeof variables.limit === 'number' ? variables.limit : 50;
        // erxes leaves archived deals out unless it is told not to.
        const archivedToo = query.includes('noSkipArchive: true');
        const rows = erxes.deals
          .filter((deal) => (deal.pipeline as { _id: string })._id === variables.pipelineId)
          .filter((deal) => archivedToo || deal.status !== 'archived')
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(skip, skip + limit)
          .map(({ _id, name, createdAt }) => ({ _id, name, createdAt }));
        return answer({ data: { deals: rows } });
      }
      case 'dealDetail':
        erxes.details += 1;
        return answer({
          data: { dealDetail: erxes.deals.find((deal) => deal._id === variables.id) ?? null },
        });
      case 'products':
        return answer({
          data: {
            products: erxes.products.filter((product) =>
              (variables.ids as string[]).includes(String(product._id)),
            ),
          },
        });
      case 'fields':
        return answer({ data: { fields: FIXTURE_FIELDS } });
      default:
        return answer({
          errors: [{ message: `Cannot query field "${root ?? ''}" on type "Query".` }],
        });
    }
  };

  /** A deal of the scripted erxes, the fixture with what a test changes. */
  const addDeal = (id: string, fields: Record<string, unknown> = {}, at = Date.now() + 2_000) => {
    const deal: Deal = {
      ...FIXTURE_DEAL,
      _id: id,
      number: `MB-${id}`,
      createdAt: new Date(at + erxes.deals.length).toISOString(),
      ...fields,
    };
    erxes.deals.push(deal);
    return deal;
  };
  const line = (productId: string, quantity: number, unitPrice: number) => ({
    _id: `pd-${productId}`,
    productId,
    uom: 'ш',
    currency: 'MNT',
    quantity,
    unitPrice,
    discount: 0,
    discountPercent: 0,
    tax: 0,
    amount: quantity * unitPrice,
  });
  const pull = async (token = admin) =>
    (await http().post('/api/v1/erxes/pull').set(bearer(token)).expect(200)).body as PullJson;
  const dealOf = async (id: number) =>
    (await http().get(`/api/v1/erxes/deals/${id}`).set(bearer(admin)).expect(200)).body as DealJson;
  const waiting = async () =>
    (
      (await http().get('/api/v1/erxes/deals').set(bearer(admin)).expect(200)).body as {
        data: DealJson[];
      }
    ).data;
  const rowOf = async (erxesId: string) => {
    const { rows } = await sql.query<{ id: string; status: string; order_id: string | null }>(
      'SELECT id::text, status, order_id::text FROM erxes_deals WHERE erxes_id = $1',
      [erxesId],
    );
    if (rows.length !== 1 || !rows[0]) throw new Error(`${rows.length} rows of deal ${erxesId}`);
    return {
      id: Number.parseInt(rows[0].id, 10),
      status: rows[0].status,
      orderId: rows[0].order_id === null ? null : Number.parseInt(rows[0].order_id, 10),
    };
  };
  const orderCount = async () =>
    (await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM sales_orders')).rows[0]?.n;
  const sellable = async (sku: string, name: string, fields: Record<string, unknown> = {}) => {
    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku,
      name,
      categoryId: category,
      baseUomId: pcs,
      ...fields,
    });
    await inventoryApi(app, admin).setHome(product.id, warehouseId);
    await pricingApi(app, admin).terms(product.id, '1500', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [product.id] })
      .expect(200);
    return product;
  };

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) => builder.overrideProvider(ERXES_FETCH).useValue(scriptedErxes),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    reader = await customRoleUser(app, admin, ['sales.orders.read']);
    outsider = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    // The seller writes her name the other way round in erxes («Туяа Бат»).
    seller = await seedUser(app, { roles: ['OFFICE'] });
    await sql.query(`UPDATE users SET full_name = 'Бат Туяа' WHERE id = $1`, [seller.id]);
    mapped = await seedUser(app, { roles: ['OFFICE'] });
    await sql.query(`UPDATE users SET full_name = 'Дулмаа' WHERE id = $1`, [mapped.id]);

    warehouseId = (await inventoryApi(app, admin).warehouse('EX1')).id;
    const catalog = catalogApi(app, admin);
    category = await catalog.category('Erxes-ийн бараа');
    pcs = await catalog.uomId('PCS');
    profile = await pricingApi(app, admin).profile('Erxes: Ундаа');
    cola = await sellable('7801', 'Кола 0.5л');
    juice = await sellable('7802', 'Жүүс 1л', { baseBarcodes: [EAN_JUICE] });
    const partners = partnersApi(app, admin);
    shop = await partners.customer({ code: '50001', name: 'Нэг дэлгүүр' });
    other = await partners.customer({ code: '50002', name: 'Хоёр дэлгүүр' });

    const boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Хөвсгөл' })
          .expect(201)
      ).body as { id: number }
    ).id;
    btoPipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({
          boardId,
          name: 'Мөрөн Борлуулалт',
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          roles: NO_ROLES,
          stages: [
            stageBody('ХТ Захиалга', 'NONE'),
            stageBody('Нярав Хяналт', 'CONFIRM'),
            stageBody('Хүлээлгэ', 'NONE'),
          ],
        })
        .expect(201)
    ).body as typeof btoPipeline;
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('keeps the routes to their rights', async () => {
    for (const token of [reader, outsider]) {
      await http().get('/api/v1/erxes/settings').set(bearer(token)).expect(403);
      await http().patch('/api/v1/erxes/settings').set(bearer(token)).send({}).expect(403);
      await http().post('/api/v1/erxes/pipelines/refresh').set(bearer(token)).expect(403);
      await http().get('/api/v1/erxes/users').set(bearer(token)).expect(403);
      await http().post('/api/v1/erxes/pull').set(bearer(token)).expect(403);
      await http().get('/api/v1/erxes/deals').set(bearer(token)).expect(403);
    }
    // The order panel's section needs the right to read orders.
    const stranger = await customRoleUser(app, admin, ['erkhet.sync.read']);
    await http().get('/api/v1/erxes/orders/1/deal').set(bearer(stranger)).expect(403);
  });

  it('saves the sign-in sealed and never gives the password back', async () => {
    const before = (await http().get('/api/v1/erxes/settings').set(bearer(admin)).expect(200))
      .body as { baseUrl: string; complete: boolean; enabled: boolean };
    expect(before).toMatchObject({
      baseUrl: 'https://erxes.bto.mn',
      complete: false,
      enabled: false,
    });
    // Nothing is pulled without a sign-in, and the page is told why.
    expect(await pull()).toMatchObject({ ok: false, failure: 'NOT_CONFIGURED' });

    const wrong = await http()
      .post('/api/v1/erxes/settings/test')
      .set(bearer(admin))
      .send({ email: EMAIL, password: 'wrong' })
      .expect(200);
    expect(wrong.body).toMatchObject({ ok: false, reason: 'LOGIN_FAILED' });

    const saved = await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ email: EMAIL, password: PASSWORD, enabled: true })
      .expect(200);
    expect(saved.body).toMatchObject({ email: EMAIL, hasPassword: true, complete: true });
    expect(JSON.stringify(saved.body)).not.toContain(PASSWORD);
    const { rows } = await sql.query<{ password_sealed: string }>(
      'SELECT password_sealed FROM erxes_settings',
    );
    expect(rows[0]?.password_sealed).toMatch(/^v1\./);
    expect(rows[0]?.password_sealed).not.toContain(PASSWORD);
    const audit = await sql.query<{ text: string }>(
      `SELECT coalesce(before::text, '') || coalesce(after::text, '') AS text
         FROM audit_log WHERE entity = 'erxes_settings'`,
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    for (const row of audit.rows) expect(row.text).not.toContain(PASSWORD);

    const ok = await http()
      .post('/api/v1/erxes/settings/test')
      .set(bearer(admin))
      .send({})
      .expect(200);
    expect(ok.body).toEqual({ ok: true, reason: null, status: null, detail: null });
  });

  it('lists the pipelines of erxes, pairs them by name and never ticks Kharkhorin', async () => {
    const refreshed = await http()
      .post('/api/v1/erxes/pipelines/refresh')
      .set(bearer(admin))
      .expect(200);
    expect(refreshed.body).toMatchObject({ ok: true });
    const list = (await http().get('/api/v1/erxes/pipelines').set(bearer(admin)).expect(200))
      .body as PipelineJson[];
    expect(list.map((row) => `${row.boardName}/${row.name}`).sort()).toEqual([
      'Хархорин/Хархорин борлуулалт',
      'Хөвсгөл/Бэлэн борлуулалт',
      'Хөвсгөл/Мөрөн Борлуулалт',
    ]);
    const found = list.find((row) => row.erxesId === PIPELINE);
    if (!found) throw new Error('no pipeline');
    // The Bto pipeline of the same name and its first stage; nothing is ticked by a refresh.
    expect(found).toMatchObject({
      enabled: false,
      blocked: false,
      btoPipelineId: btoPipeline.id,
      btoStageId: btoPipeline.stages[0]?.id,
      btoPipelineName: 'Хөвсгөл · Мөрөн Борлуулалт',
      btoStageName: 'ХТ Захиалга',
      placeOk: true,
    });
    const kharkhorin = list.find((row) => row.erxesId === 'pl-kh');
    expect(kharkhorin).toMatchObject({ blocked: true, enabled: false });
    await http()
      .patch(`/api/v1/erxes/pipelines/${kharkhorin?.id}`)
      .set(bearer(admin))
      .send({ enabled: true, btoPipelineId: btoPipeline.id })
      .expect(422);
    // A stage with an action does not take a draft.
    await http()
      .patch(`/api/v1/erxes/pipelines/${found.id}`)
      .set(bearer(admin))
      .send({ btoStageId: btoPipeline.stages[1]?.id })
      .expect(422);
    // A pipeline without a Bto stage cannot be ticked.
    const cash = list.find((row) => row.erxesId === 'pl-cash');
    await http()
      .patch(`/api/v1/erxes/pipelines/${cash?.id}`)
      .set(bearer(admin))
      .send({ enabled: true })
      .expect(422);

    // A deal made before the pipeline is ticked is never copied.
    addDeal('d-old', { productsData: [line('p-cola', 1, 1500)] }, Date.now() - 86_400_000);
    const ticked = (
      await http()
        .patch(`/api/v1/erxes/pipelines/${found.id}`)
        .set(bearer(admin))
        .send({ enabled: true, btoStageId: btoPipeline.stages[2]?.id })
        .expect(200)
    ).body as PipelineJson[];
    const now = ticked.find((row) => row.erxesId === PIPELINE);
    if (!now) throw new Error('no pipeline');
    expect(now).toMatchObject({ enabled: true, btoStageName: 'Хүлээлгэ' });
    murun = now;
  });

  it('copies a new deal once: a draft with its customer, lines, note and creator', async () => {
    const orders = await orderCount();
    expect(await pull()).toMatchObject({ ok: true, pipelines: 1, seen: 0, copied: 0, waiting: 0 });
    expect(await orderCount()).toBe(orders);

    addDeal('d-1001', {
      // Moved to «Архивлах» in erxes within hours: still a new deal for Bto.
      status: 'archived',
      productsData: [
        { ...line('p-cola', 24, 1500), discountPercent: 10, discount: 3600, amount: 32400 },
        // Its erxes code is no Bto code: the barcode erxes holds finds the product.
        line('p-old', 5, 800),
      ],
    });
    expect(await pull()).toMatchObject({ ok: true, seen: 1, copied: 1, waiting: 0 });
    const row = await rowOf('d-1001');
    expect(row.status).toBe('COPIED');
    if (row.orderId === null) throw new Error('no order');
    const order = (await salesApi(app, admin).get(row.orderId)) as OrderJson & { note: string };
    expect(order).toMatchObject({
      status: 'DRAFT',
      customerId: shop.id,
      pipelineId: murun.btoPipelineId,
      stageId: btoPipeline.stages[2]?.id,
      stageName: 'Хүлээлгэ',
      fulfilment: 'PICKUP',
      contactName: 'Ган Сараа',
      contactPhone: '+97699112233',
      // The same person who made the deal in erxes.
      createdByName: 'Бат Туяа',
      // A draft: no price is frozen and nothing is reserved.
      total: null,
      priceDate: null,
    });
    expect(order.number).not.toBeNull();
    expect(order.note).toBe(
      'Нэг дэлгүүр 11/17\nӨглөө 10 цагаас өмнө хүргэнэ.\nХаалга нь арын талд.',
    );
    expect(
      order.lines.map((entry) => [entry.productId, entry.productUnitId, entry.qty, entry.total]),
    ).toEqual([
      [cola.id, unitOf(cola, 'PCS').id, '24', null],
      [juice.id, unitOf(juice, 'PCS').id, '5', null],
    ]);
    for (const entry of order.lines) expect(entry.qtyApproved).toBe('0');
    const reserved = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM stock_reservations
        WHERE doc_line_id IN (SELECT id FROM sales_order_lines WHERE order_id = $1)`,
      [row.orderId],
    );
    expect(reserved.rows[0]?.n).toBe(0);

    // A second pull, and two at once, make nothing new.
    const before = await orderCount();
    expect(await pull()).toMatchObject({ ok: true, seen: 0, copied: 0 });
    await Promise.all([pull(), pull()]);
    expect(await orderCount()).toBe(before);
    expect((await rowOf('d-1001')).orderId).toBe(row.orderId);
    // The deal made before the tick was never kept.
    const old = await sql.query(`SELECT 1 FROM erxes_deals WHERE erxes_id = 'd-old'`);
    expect(old.rowCount).toBe(0);
  });

  it('makes one order of a deal two pulls see at the same moment', async () => {
    const before = (await orderCount()) ?? 0;
    addDeal('d-1002', { productsData: [line('p-cola', 2, 1500)] });
    const [first, second] = await Promise.all([pull(), pull()]);
    expect(first.copied + second.copied).toBe(1);
    expect(await orderCount()).toBe(before + 1);
    expect((await rowOf('d-1002')).status).toBe('COPIED');
  });

  it('shows the erxes name when no Bto user is the creator, until a person names one', async () => {
    const stranger = {
      userId: 'u-stranger',
      createdUser: {
        _id: 'u-stranger',
        email: 'stranger@example.test',
        username: 'stranger',
        details: { fullName: 'Гадны Хүн' },
      },
    };
    addDeal('d-1003', { ...stranger, productsData: [line('p-cola', 1, 1500)] });
    expect(await pull()).toMatchObject({ seen: 1, copied: 1 });
    const row = await rowOf('d-1003');
    if (row.orderId === null) throw new Error('no order');
    const order = await salesApi(app, admin).get(row.orderId);
    expect(order.createdByName).toBeNull();
    const deal = await dealOf(row.id);
    expect(deal).toMatchObject({
      creatorName: 'Гадны Хүн',
      creatorUserId: null,
      creatorUserName: null,
    });

    // The mapping on the settings page: the next deal of that erxes user is the Bto user's.
    const users = (await http().get('/api/v1/erxes/users').set(bearer(admin)).expect(200)).body as {
      id: number;
      erxesId: string;
      email: string | null;
      matchedUserId: number | null;
    }[];
    expect(users.find((user) => user.erxesId === 'u-seller')?.matchedUserId).toBe(seller.id);
    const unknown = users.find((user) => user.erxesId === 'u-stranger');
    expect(unknown).toMatchObject({ email: 'stranger@example.test', matchedUserId: null });
    await http()
      .patch(`/api/v1/erxes/users/${unknown?.id}`)
      .set(bearer(admin))
      .send({ btoUserId: 999_999_999 })
      .expect(422);
    await http()
      .patch(`/api/v1/erxes/users/${unknown?.id}`)
      .set(bearer(admin))
      .send({ btoUserId: mapped.id })
      .expect(200);
    addDeal('d-1004', { ...stranger, productsData: [line('p-cola', 1, 1500)] });
    expect(await pull()).toMatchObject({ seen: 1, copied: 1 });
    const next = await rowOf('d-1004');
    if (next.orderId === null) throw new Error('no order');
    expect((await salesApi(app, admin).get(next.orderId)).createdByName).toBe('Дулмаа');
    // A deal is copied once: the earlier order keeps what it was copied with.
    expect((await salesApi(app, admin).get(row.orderId)).createdByName).toBeNull();
  });

  it('keeps a deal with an unknown product waiting, and copies it once the product exists', async () => {
    const before = (await orderCount()) ?? 0;
    addDeal('d-1005', { productsData: [line('p-cola', 3, 1500), line('p-new', 4, 500)] });
    expect(await pull()).toMatchObject({ ok: true, seen: 1, copied: 0, waiting: 1 });
    expect(await orderCount()).toBe(before);
    const list = await waiting();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      erxesId: 'd-1005',
      status: 'WAITING',
      pipelineName: 'Мөрөн Борлуулалт',
      orderId: null,
      issues: [{ reason: 'PRODUCT_NOT_FOUND', code: '7899', name: 'Шинэ бараа' }],
    });
    // Every pull tries it again; it still waits.
    expect(await pull()).toMatchObject({ seen: 0, copied: 0, waiting: 1 });

    const fresh = await sellable('7899', 'Шинэ бараа');
    expect(await pull()).toMatchObject({ seen: 0, copied: 1, waiting: 0 });
    const row = await rowOf('d-1005');
    if (row.orderId === null) throw new Error('no order');
    const order = await salesApi(app, admin).get(row.orderId);
    expect(order.lines.map((entry) => [entry.productId, entry.qty])).toEqual([
      [cola.id, '3'],
      [fresh.id, '4'],
    ]);
    expect(await waiting()).toHaveLength(0);
    expect(await orderCount()).toBe(before + 1);
  });

  it('lets a person choose the customer of a waiting deal and copy it', async () => {
    addDeal('d-1006', {
      companies: [{ _id: 'co-x', code: '59999', primaryName: 'Танихгүй дэлгүүр' }],
      customers: [],
      productsData: [line('p-cola', 6, 1500)],
    });
    expect(await pull()).toMatchObject({ seen: 1, copied: 0, waiting: 1 });
    const row = await rowOf('d-1006');
    expect((await dealOf(row.id)).issues).toEqual([
      { reason: 'CUSTOMER_NOT_FOUND', code: '59999', name: 'Танихгүй дэлгүүр' },
    ]);
    // Pressing the button changes nothing while the customer is unknown.
    const still = await http()
      .post(`/api/v1/erxes/deals/${row.id}/copy`)
      .set(bearer(admin))
      .expect(200);
    expect(still.body).toMatchObject({ status: 'WAITING', orderId: null });

    await http()
      .patch(`/api/v1/erxes/deals/${row.id}`)
      .set(bearer(admin))
      .send({ customerId: 999_999_999 })
      .expect(404);
    const chosen = await http()
      .patch(`/api/v1/erxes/deals/${row.id}`)
      .set(bearer(admin))
      .send({ customerId: other.id })
      .expect(200);
    expect(chosen.body).toMatchObject({ status: 'WAITING', customer: { id: other.id } });
    const copied = (
      await http().post(`/api/v1/erxes/deals/${row.id}/copy`).set(bearer(admin)).expect(200)
    ).body as DealJson;
    expect(copied).toMatchObject({ status: 'COPIED', issues: [], customer: { id: other.id } });
    if (copied.orderId === null) throw new Error('no order');
    const order = await salesApi(app, admin).get(copied.orderId);
    // The person pressed the button; the order is still the erxes creator's.
    expect(order).toMatchObject({
      customerId: other.id,
      status: 'DRAFT',
      createdByName: 'Бат Туяа',
    });
    // Pressing again answers the same order.
    const again = (
      await http().post(`/api/v1/erxes/deals/${row.id}/copy`).set(bearer(admin)).expect(200)
    ).body as DealJson;
    expect(again.orderId).toBe(copied.orderId);
    // A copied deal takes no more choices.
    await http()
      .patch(`/api/v1/erxes/deals/${row.id}`)
      .set(bearer(admin))
      .send({ customerId: shop.id })
      .expect(409);
  });

  it('sets a waiting deal aside and takes it back', async () => {
    addDeal('d-1007', { companies: [], customers: [], productsData: [line('p-cola', 1, 1500)] });
    expect(await pull()).toMatchObject({ seen: 1, copied: 0, waiting: 1 });
    const row = await rowOf('d-1007');
    expect((await dealOf(row.id)).issues).toEqual([{ reason: 'NO_CUSTOMER' }]);
    await http().post(`/api/v1/erxes/deals/${row.id}/dismiss`).set(bearer(admin)).expect(200);
    expect(await pull()).toMatchObject({ copied: 0, waiting: 0 });
    const aside = (
      await http()
        .get('/api/v1/erxes/deals')
        .query({ status: 'DISMISSED' })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: DealJson[] };
    expect(aside.data.map((deal) => deal.erxesId)).toEqual(['d-1007']);
    await http().post(`/api/v1/erxes/deals/${row.id}/restore`).set(bearer(admin)).expect(200);
    expect(await waiting()).toHaveLength(1);
    await http().post(`/api/v1/erxes/deals/${row.id}/dismiss`).set(bearer(admin)).expect(200);
  });

  it('keeps the whole deal and serves it to the order panel', async () => {
    const row = await rowOf('d-1001');
    if (row.orderId === null) throw new Error('no order');
    const stored = await sql.query<{ raw: Record<string, unknown> }>(
      'SELECT raw FROM erxes_deals WHERE id = $1',
      [row.id],
    );
    // As it came: nothing of the answer is dropped or rewritten.
    expect(stored.rows[0]?.raw).toEqual(erxes.deals.find((deal) => deal._id === 'd-1001'));

    const panel = (
      await http().get(`/api/v1/erxes/orders/${row.orderId}/deal`).set(bearer(reader)).expect(200)
    ).body as { deal: DealJson | null };
    const deal = panel.deal;
    if (!deal) throw new Error('no deal');
    expect(deal).toMatchObject({
      erxesId: 'd-1001',
      name: 'Нэг дэлгүүр 11/17',
      number: 'MB-d-1001',
      status: 'COPIED',
      orderId: row.orderId,
      url: `https://erxes.bto.mn/deal/board?id=b-khuvsgul&pipelineId=${PIPELINE}&itemId=d-1001`,
      creatorName: 'Туяа Бат',
      creatorUserId: seller.id,
      creatorUserName: 'Бат Туяа',
      assigned: ['Болд Дорж'],
      labels: [{ name: 'Яаралтай' }],
      customFields: [
        { label: 'Чиглэл', value: 'Мөрөн төв' },
        { label: 'Төлбөр төлсөн', value: 'true' },
      ],
      attachments: [
        {
          name: 'zahialga.jpg',
          url: 'https://erxes.bto.mn/gateway/read-file?key=uploads%2Fzahialga.jpg',
        },
      ],
      customer: { id: shop.id, code: '50001' },
    });
    // erxes's own prices beside the Bto unit each line became.
    expect(deal.lines).toEqual([
      expect.objectContaining({
        code: '7801',
        quantity: '24',
        unitPrice: '1500',
        discount: '3600',
        amount: '32400',
        unit: expect.objectContaining({ sku: '7801' }),
      }),
      expect.objectContaining({
        code: '900123',
        quantity: '5',
        unitPrice: '800',
        unit: expect.objectContaining({ sku: '7802' }),
      }),
    ]);
    expect(deal.raw).toMatchObject({ _id: 'd-1001', amount: { MNT: 36400 } });

    // An order made in Bto has no deal; an order that does not exist is not found.
    const own = await salesApi(app, admin).draft(
      orderBody(shop.id, [{ productUnitId: unitOf(cola, 'PCS').id, qty: '1' }]),
    );
    const none = await http()
      .get(`/api/v1/erxes/orders/${own.id}/deal`)
      .set(bearer(reader))
      .expect(200);
    expect(none.body).toEqual({ deal: null });
  });

  it('reads erxes only, signs in once, and stays quiet while switched off', async () => {
    expect(erxes.writes).toBe(0);
    // One sign-in for every pull of this process, besides the three checks of the sign-in itself.
    expect(erxes.logins).toBeLessThanOrEqual(5);
    // Each deal was read whole once (twice at most by the two pulls that met), never per pull.
    expect(erxes.details).toBeGreaterThanOrEqual(7);
    expect(erxes.details).toBeLessThanOrEqual(8);
    const settings = (await http().get('/api/v1/erxes/settings').set(bearer(admin)).expect(200))
      .body as { lastFailure: string | null; lastOkAt: string | null; waiting: number };
    expect(settings).toMatchObject({ lastFailure: null, waiting: 0 });
    expect(settings.lastOkAt).not.toBeNull();

    const flow = app.get(ErxesPullFlowService, { strict: false });
    expect(await flow.scheduled()).toMatchObject({ ok: true });
    await http().patch('/api/v1/erxes/settings').set(bearer(admin)).send({ enabled: false });
    addDeal('d-1008', { productsData: [line('p-cola', 1, 1500)] });
    expect(await flow.scheduled()).toEqual({ skipped: true });
    const unseen = await sql.query(`SELECT 1 FROM erxes_deals WHERE erxes_id = 'd-1008'`);
    expect(unseen.rowCount).toBe(0);

    // A changed password in erxes: the pull says so and the page shows it.
    await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ password: 'changed-elsewhere', enabled: true })
      .expect(200);
    expect(await pull()).toMatchObject({ ok: false, failure: 'LOGIN_FAILED' });
    const failed = (await http().get('/api/v1/erxes/settings').set(bearer(admin)).expect(200))
      .body as { lastFailure: string | null };
    expect(failed.lastFailure).toBe('LOGIN_FAILED');
  });

  it('fails visibly when erxes refuses a query, and says what erxes said', async () => {
    await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ password: PASSWORD, enabled: true })
      .expect(200);
    erxes.refuse.add('salesBoards');
    const pipelinesBefore = (await http().get('/api/v1/erxes/pipelines').set(bearer(admin)))
      .body as PipelineJson[];
    const refreshed = (
      await http().post('/api/v1/erxes/pipelines/refresh').set(bearer(admin)).expect(200)
    ).body as { ok: boolean; reason: string | null; detail: string | null };
    expect(refreshed).toMatchObject({ ok: false, reason: 'UNEXPECTED_ANSWER' });
    expect(refreshed.detail).toContain('argument "x"');
    const shown = (await http().get('/api/v1/erxes/settings').set(bearer(admin)).expect(200))
      .body as { lastFailure: string | null; lastFailureDetail: string | null };
    expect(shown.lastFailure).toBe('UNEXPECTED_ANSWER');
    expect(shown.lastFailureDetail).toContain('salesBoards');
    // Nothing of what Bto knew is lost or marked gone by an answer it could not read.
    const pipelinesAfter = (await http().get('/api/v1/erxes/pipelines').set(bearer(admin)))
      .body as (PipelineJson & { gone: boolean })[];
    expect(pipelinesAfter).toHaveLength(pipelinesBefore.length);
    expect(pipelinesAfter.some((row) => row.gone)).toBe(false);
    erxes.refuse.delete('salesBoards');

    // The same for the deals of a pull.
    erxes.refuse.add('deals');
    const pulled = await pull();
    expect(pulled).toMatchObject({ ok: false, failure: 'UNEXPECTED_ANSWER' });
    expect((pulled as PullJson & { detail: string | null }).detail).toContain('deals');
    const after = (await http().get('/api/v1/erxes/settings').set(bearer(admin)).expect(200))
      .body as { lastFailure: string | null; lastFailureDetail: string | null };
    expect(after).toMatchObject({ lastFailure: 'UNEXPECTED_ANSWER' });
    expect(after.lastFailureDetail).toContain('argument "x"');
    erxes.refuse.delete('deals');
    expect(await pull()).toMatchObject({ ok: true, failure: null });
  });
});
