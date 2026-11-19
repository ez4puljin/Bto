import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { ERXES_FETCH, type ErxesFetch } from '../../src/modules/erxes/erxes.client';
import { FIXTURE_DEAL, FIXTURE_FIELDS } from '../../src/modules/erxes/erxes-wire.fixture';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { salesApi } from '../harness/sales';

/** Not a real sign-in: no test reaches erxes, the «erxes» below is scripted. */
const EMAIL = 'bto@example.test';
const PASSWORD = 'test-erxes-password-not-real';
const PIPELINE = 'pl-murun';
const NO_ROLES = { VIEW: [], MANAGE: [], ALL_ORDERS: [] };
const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
});

/** 2026-11-18 in Ulaanbaatar is 2026-11-17T16:00Z … 2026-11-18T15:59:59.999Z. */
const DAY = '2026-11-18';

type Deal = Record<string, unknown> & { _id: string; createdAt: string };

interface RangePipelineJson {
  id: number;
  erxesId: string;
  name: string;
  enabled: boolean;
}
interface RangeDealJson {
  erxesId: string;
  pipelineId: number;
  number: string | null;
  name: string | null;
  createdAt: string | null;
  creatorName: string | null;
  stageName: string | null;
  customerName: string | null;
  lines: number | null;
  total: string | null;
  known: { id: number; status: string; orderId: number | null } | null;
}
interface PreviewJson {
  ok: boolean;
  failure: string | null;
  tooMany: boolean;
  deals: RangeDealJson[];
}
interface CopyJson {
  ok: boolean;
  copied: number;
  waiting: number;
  skipped: number;
  failed: number;
  results: {
    erxesId: string;
    outcome: string;
    orderId: number | null;
    issues: { reason: string }[];
    skip: string | null;
    failure: string | null;
  }[];
}

/**
 * The range copy (ADR-0220) over HTTP, with erxes scripted: the deals created within whole days
 * of Ulaanbaatar, listed with what Bto holds of each, and the ticked ones copied as drafts by the
 * minute pull's rules, each on its own, never twice.
 */
describe('erxes range copy', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let reader: string;
  let seller: { id: number };
  let murun: RangePipelineJson;
  let kharkhorin: { id: number };
  let colaUnit: number;
  const erxes = {
    deals: [] as Deal[],
    products: [
      { _id: 'p-cola', name: 'Кола 0.5л', code: '7801', barcodes: [], uom: 'ш' },
      { _id: 'p-new', name: 'Шинэ бараа', code: '7899', barcodes: [], uom: 'ш' },
    ] as Record<string, unknown>[],
    /** Range queries erxes was sent, with their variables. */
    ranges: [] as Record<string, unknown>[],
    writes: 0,
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
      return variables.email === EMAIL && variables.password === PASSWORD
        ? answer({ data: { login: 'loggedIn' } }, { 'set-cookie': 'auth-token=session1; Path=/' })
        : answer({ errors: [{ message: 'Invalid login' }] });
    }
    if (!query.startsWith('query ')) {
      erxes.writes += 1;
      return answer({ errors: [{ message: 'not allowed' }] });
    }
    const root = /^query bto(?:\([^)]*\))? \{\n(\w+)/.exec(query)?.[1];
    switch (root) {
      case 'salesBoards':
        if (!query.includes('salesBoards(type: "deal")')) {
          return answer({ errors: [{ message: 'Field "salesBoards" argument "type" required' }] });
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
                pipelines: [{ _id: 'pl-kh', name: 'Мөрөн Борлуулалт' }],
              },
            ],
          },
        });
      case 'users':
        return answer({ data: { users: [FIXTURE_DEAL.createdUser] } });
      case 'deals': {
        // As the real erxes: a creation filter typed Date, archived deals only when asked for.
        if (query.includes('createdStartDate') && !query.includes('$createdStartDate: Date')) {
          return answer({ errors: [{ message: 'Variable "$createdStartDate" of type String' }] });
        }
        const archivedToo = query.includes('noSkipArchive: true');
        const from =
          typeof variables.createdStartDate === 'string'
            ? new Date(variables.createdStartDate)
            : null;
        const to =
          typeof variables.createdEndDate === 'string' ? new Date(variables.createdEndDate) : null;
        if (from) erxes.ranges.push(variables);
        const skip = typeof variables.skip === 'number' ? variables.skip : 0;
        const limit = typeof variables.limit === 'number' ? variables.limit : 50;
        const rows = erxes.deals
          .filter((deal) => (deal.pipeline as { _id: string })._id === variables.pipelineId)
          .filter((deal) => archivedToo || deal.status !== 'archived')
          .filter((deal) => !from || new Date(deal.createdAt) >= from)
          .filter((deal) => !to || new Date(deal.createdAt) <= to)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(skip, skip + limit)
          // A list item of erxes: no description, attachments or custom fields.
          .map((deal) => {
            const item: Record<string, unknown> = { ...deal };
            for (const field of ['description', 'attachments', 'customFieldsData']) {
              delete item[field];
            }
            return item;
          });
        return answer({ data: { deals: rows } });
      }
      case 'dealDetail':
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
  const addDeal = (id: string, createdAt: string, fields: Record<string, unknown> = {}) => {
    const deal: Deal = {
      ...FIXTURE_DEAL,
      _id: id,
      number: `MB-${id}`,
      name: `Deal ${id}`,
      createdAt,
      productsData: [line('p-cola', 2, 1500)],
      amount: { MNT: 3000 },
      ...fields,
    };
    erxes.deals.push(deal);
    return deal;
  };
  const range = (extra: Record<string, unknown> = {}) => ({
    from: DAY,
    to: DAY,
    pipelineIds: [murun.id],
    ...extra,
  });
  const preview = async (body = range()) =>
    (await http().post('/api/v1/erxes/range/preview').set(bearer(admin)).send(body).expect(200))
      .body as PreviewJson;
  const copy = async (erxesIds: string[], body = range()) =>
    (
      await http()
        .post('/api/v1/erxes/range/copy')
        .set(bearer(admin))
        .send({ ...body, deals: erxesIds.map((erxesId) => ({ erxesId, pipelineId: murun.id })) })
        .expect(200)
    ).body as CopyJson;
  const orderCount = async () =>
    (await sql.query<{ n: number }>('SELECT count(*)::int AS n FROM sales_orders')).rows[0]?.n ?? 0;

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) => builder.overrideProvider(ERXES_FETCH).useValue(scriptedErxes),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    reader = await customRoleUser(app, admin, ['sales.orders.read']);
    seller = await seedUser(app, { roles: ['OFFICE'] });
    await sql.query(`UPDATE users SET full_name = 'Бат Туяа' WHERE id = $1`, [seller.id]);

    const warehouseId = (await inventoryApi(app, admin).warehouse('EX1')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Erxes-ийн бараа');
    const pcs = await catalog.uomId('PCS');
    const profile = await pricingApi(app, admin).profile('Erxes: Ундаа');
    const cola = await catalog.product({
      sku: '7801',
      name: 'Кола 0.5л',
      categoryId: category,
      baseUomId: pcs,
    });
    await inventoryApi(app, admin).setHome(cola.id, warehouseId);
    await pricingApi(app, admin).terms(cola.id, '1500', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id] })
      .expect(200);
    colaUnit = unitOf(cola, 'PCS').id;
    await partnersApi(app, admin).customer({ code: '50001', name: 'Нэг дэлгүүр' });

    const boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Хөвсгөл' })
          .expect(201)
      ).body as { id: number }
    ).id;
    await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({
        boardId,
        name: 'Мөрөн Борлуулалт',
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        roles: NO_ROLES,
        stages: [stageBody('ХТ Захиалга', 'NONE'), stageBody('Нярав Хяналт', 'CONFIRM')],
      })
      .expect(201);

    await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    const refreshed = await http()
      .post('/api/v1/erxes/pipelines/refresh')
      .set(bearer(admin))
      .expect(200);
    expect(refreshed.body).toMatchObject({ ok: true });
    const { rows } = await sql.query<{ id: string }>(
      `SELECT id::text FROM erxes_pipelines WHERE erxes_id = 'pl-kh'`,
    );
    kharkhorin = { id: Number.parseInt(rows[0]?.id ?? '0', 10) };
    // Kharkhorin's pipeline of the same name finds a Bto place too; it stays blocked.
    await sql.query(
      `UPDATE erxes_pipelines SET bto_pipeline_id = p.bto_pipeline_id, bto_stage_id = p.bto_stage_id
         FROM erxes_pipelines p WHERE p.erxes_id = $1 AND erxes_pipelines.erxes_id = 'pl-kh'`,
      [PIPELINE],
    );

    // The day before, the day itself (one archived within hours, one at its last second), the day after.
    addDeal('d-before', '2026-11-17T15:59:59.000Z');
    addDeal('d-morning', '2026-11-18T01:00:00.000Z', { status: 'archived' });
    addDeal('d-noon', '2026-11-18T04:00:00.000Z');
    addDeal('d-new-product', '2026-11-18T06:00:00.000Z', {
      productsData: [line('p-cola', 1, 1500), line('p-new', 3, 500)],
      amount: { MNT: 3000 },
    });
    addDeal('d-last', '2026-11-18T15:59:59.000Z');
    addDeal('d-after', '2026-11-18T16:00:00.000Z');
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('keeps the range to who manages orders', async () => {
    await http().get('/api/v1/erxes/range/pipelines').set(bearer(reader)).expect(403);
    await http()
      .post('/api/v1/erxes/range/preview')
      .set(bearer(reader))
      .send({ from: DAY, to: DAY, pipelineIds: [1] })
      .expect(403);
    await http()
      .post('/api/v1/erxes/range/copy')
      .set(bearer(reader))
      .send({ from: DAY, to: DAY, pipelineIds: [1], deals: [{ erxesId: 'x', pipelineId: 1 }] })
      .expect(403);
  });

  it('offers the pipelines with a Bto place, never Kharkhorin, ticked or not', async () => {
    const list = (await http().get('/api/v1/erxes/range/pipelines').set(bearer(admin)).expect(200))
      .body as RangePipelineJson[];
    // «Бэлэн борлуулалт» has no Bto twin, so no place; Kharkhorin is blocked.
    expect(list.map((row) => row.erxesId)).toEqual([PIPELINE]);
    const found = list[0];
    if (!found) throw new Error('no pipeline');
    expect(found.enabled).toBe(false);
    murun = found;
  });

  it('refuses a range the wrong way round, longer than 31 days, or of Kharkhorin', async () => {
    const refused = (body: Record<string, unknown>) =>
      http().post('/api/v1/erxes/range/preview').set(bearer(admin)).send(body).expect(422);
    await refused(range({ from: '2026-11-18', to: '2026-11-17' }));
    await refused(range({ from: '2026-10-01', to: '2026-11-01' }));
    await refused(range({ pipelineIds: [kharkhorin.id] }));
    await refused(range({ pipelineIds: [] }));
    // 31 whole days is the longest range.
    expect((await preview(range({ from: '2026-10-19', to: DAY }))).ok).toBe(true);
  });

  it('lists the deals created within the days, archived ones too, newest first', async () => {
    erxes.ranges.length = 0;
    const seen = await preview();
    expect(seen).toMatchObject({ ok: true, failure: null, tooMany: false });
    expect(seen.deals.map((deal) => deal.erxesId)).toEqual([
      'd-last',
      'd-new-product',
      'd-noon',
      'd-morning',
    ]);
    // The whole Ulaanbaatar day, as dates erxes reads.
    expect(erxes.ranges[0]).toMatchObject({
      createdStartDate: '2026-11-17T16:00:00.000Z',
      createdEndDate: '2026-11-18T15:59:59.999Z',
      pipelineId: PIPELINE,
    });
    expect(seen.deals.find((deal) => deal.erxesId === 'd-new-product')).toEqual({
      erxesId: 'd-new-product',
      pipelineId: murun.id,
      pipelineName: 'Мөрөн Борлуулалт',
      number: 'MB-d-new-product',
      name: 'Deal d-new-product',
      createdAt: '2026-11-18T06:00:00.000Z',
      creatorName: 'Туяа Бат',
      stageName: 'Шинэ',
      customerName: 'Нэг дэлгүүр',
      lines: 2,
      total: '3000',
      known: null,
    });
  });

  it('copies the ticked deals as drafts by the rules of the pull, one bad deal stopping none', async () => {
    const before = await orderCount();
    // A deal erxes cannot give whole (gone since it was listed) fails alone.
    const result = await copy(['d-morning', 'd-broken', 'd-noon', 'd-new-product']);
    expect(result).toMatchObject({ ok: true, copied: 2, waiting: 1, skipped: 0, failed: 1 });
    const byId = new Map(result.results.map((entry) => [entry.erxesId, entry]));
    expect(byId.get('d-broken')).toMatchObject({ outcome: 'FAILED', failure: 'UNEXPECTED_ANSWER' });
    expect(byId.get('d-new-product')).toMatchObject({
      outcome: 'WAITING',
      issues: [{ reason: 'PRODUCT_NOT_FOUND' }],
    });
    expect(await orderCount()).toBe(before + 2);

    const orderId = byId.get('d-morning')?.orderId;
    if (!orderId) throw new Error('no order');
    const order = await salesApi(app, admin).get(orderId);
    expect(order).toMatchObject({
      status: 'DRAFT',
      stageName: 'ХТ Захиалга',
      fulfilment: 'PICKUP',
      createdByName: 'Бат Туяа',
      total: null,
    });
    expect(order.lines.map((entry) => [entry.productUnitId, entry.qty])).toEqual([[colaUnit, '2']]);
    // The deal is kept as erxes gave it whole, and the person who pressed is written.
    const kept = await sql.query<{ raw: Record<string, unknown>; copied_by: string | null }>(
      `SELECT raw, copied_by::text FROM erxes_deals WHERE erxes_id = 'd-morning'`,
    );
    expect(kept.rows[0]?.raw).toEqual(erxes.deals.find((deal) => deal._id === 'd-morning'));
    expect(kept.rows[0]?.copied_by).not.toBeNull();

    // The audit keeps who ran it and the range.
    const audit = await sql.query<{ actor_id: string | null; after: Record<string, unknown> }>(
      `SELECT actor_id::text, after FROM audit_log WHERE action = 'RANGE_COPY' ORDER BY id`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.after).toMatchObject({
      from: DAY,
      to: DAY,
      pipelines: [PIPELINE],
      requested: 4,
      copied: 2,
      waiting: 1,
      failed: 1,
    });
    expect(audit.rows[0]?.actor_id).toBe(kept.rows[0]?.copied_by);
  });

  it('marks what Bto holds already, and never copies a deal twice', async () => {
    const seen = await preview();
    const known = new Map(seen.deals.map((deal) => [deal.erxesId, deal.known?.status ?? null]));
    expect(Object.fromEntries(known)).toEqual({
      'd-last': null,
      'd-new-product': 'WAITING',
      'd-noon': 'COPIED',
      'd-morning': 'COPIED',
    });
    expect(seen.deals.find((deal) => deal.erxesId === 'd-noon')?.known?.orderId).not.toBeNull();

    const before = await orderCount();
    const again = await copy(['d-morning', 'd-noon', 'd-new-product', 'd-last']);
    expect(again).toMatchObject({ copied: 1, waiting: 0, skipped: 3, failed: 0 });
    expect(
      again.results.filter((entry) => entry.outcome === 'SKIPPED').map((entry) => entry.skip),
    ).toEqual(['KNOWN', 'KNOWN', 'KNOWN']);
    expect(await orderCount()).toBe(before + 1);
    const rows = await sql.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM erxes_deals WHERE erxes_id IN ('d-morning', 'd-noon', 'd-last')`,
    );
    expect(rows.rows[0]?.n).toBe(3);
  });

  it('skips a deal outside the range or of another pipeline, whatever the page sent', async () => {
    const result = await copy(['d-before', 'd-after']);
    expect(result).toMatchObject({ copied: 0, skipped: 2 });
    expect(result.results.map((entry) => entry.skip)).toEqual(['OUT_OF_RANGE', 'OUT_OF_RANGE']);
    const none = await sql.query(
      `SELECT 1 FROM erxes_deals WHERE erxes_id IN ('d-before', 'd-after')`,
    );
    expect(none.rowCount).toBe(0);
    // A deal of a pipeline that was not chosen is refused before erxes is asked.
    await http()
      .post('/api/v1/erxes/range/copy')
      .set(bearer(admin))
      .send({ ...range(), deals: [{ erxesId: 'd-last', pipelineId: kharkhorin.id }] })
      .expect(422);
  });

  it('stops at 1000 deals and asks to narrow the range', async () => {
    for (let index = 0; index < 1001; index += 1) {
      const at = new Date(Date.parse('2026-11-18T08:00:00.000Z') + index * 1000).toISOString();
      erxes.deals.push({ ...FIXTURE_DEAL, _id: `d-many-${index}`, createdAt: at });
    }
    const seen = await preview();
    expect(seen.tooMany).toBe(true);
    expect(seen.deals).toHaveLength(1000);
    expect(erxes.writes).toBe(0);
  });
});
