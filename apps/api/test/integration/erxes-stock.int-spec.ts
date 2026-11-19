import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { ERXES_FETCH, type ErxesFetch } from '../../src/modules/erxes/erxes.client';
import {
  ERXES_STOCK_PACE,
  ErxesStockRunFlowService,
} from '../../src/modules/erxes/services/erxes-stock-run-flow.service';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';

/** Not a real sign-in: no test reaches erxes, the «erxes» below is scripted. */
const EMAIL = 'bto@example.test';
const PASSWORD = 'test-erxes-password-not-real';
const EAN_JUICE = '5901234123464';

interface RunJson {
  id: number;
  status: string;
  products: number;
  batchesTotal: number;
  batchesDone: number;
  batchesFailed: number;
  productsUnread: number;
  failure: string | null;
}
interface OverviewJson {
  configured: boolean;
  active: RunJson | null;
  latest: RunJson | null;
  failed: RunJson | null;
}
interface RowJson {
  code: string | null;
  productId: number | null;
  erxesId: string | null;
  erkhet: string | null;
  bto: string | null;
  difference: string | null;
  unitDiffers: boolean;
  reason: string | null;
}
interface ComparisonJson {
  runId: number | null;
  locations: { code: string }[];
  counts: { matched: number; different: number; notInBto: number; notInErkhet: number };
  data: RowJson[];
}

/**
 * Erkhet's stock by location through erxes (ADR-0221), with erxes scripted: rights, linking
 * locations, a run in the worker with a refused call, the comparison's three groups, queries only,
 * and Bto's stock untouched.
 */
describe('erxes stock by location', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let keeper: string;
  let outsider: string;
  let warehouseId: number;
  let otherWarehouseId: number;
  let cola: ProductJson;
  let juice: ProductJson;
  let failing: ProductJson;
  let onlyBto: ProductJson;

  const erxes = {
    config: {
      'pl-hall': { account: '150101', location: '01,02' },
      'pl-drinks': { account: '150101', location: '02,08' },
      'pl-cash': { account: '120101', location: '01' },
    } as Record<string, unknown>,
    products: [
      { _id: 'p-cola', code: '7801', name: 'Кола 0.5л', barcodes: [], uom: 'ш' },
      { _id: 'p-old', code: '900123', name: 'Жүүс 1л', barcodes: [EAN_JUICE], uom: 'хайрцаг' },
      { _id: 'p-fail', code: '7803', name: 'Ус', barcodes: [], uom: 'ш' },
      { _id: 'p-new', code: '7899', name: 'Шинэ бараа', barcodes: [], uom: 'ш' },
      { _id: 'p-zero', code: '7898', name: 'Үлдэгдэлгүй', barcodes: [], uom: 'ш' },
    ],
    /** product → location → quantity, as Erkhet would answer. */
    balances: {
      'p-cola': { '01': 90, '02': 5, '08': 3 },
      'p-old': { '01': 4 },
      'p-fail': { '01': 7 },
      'p-new': { '01': 6 },
      'p-zero': {},
    } as Record<string, Record<string, number>>,
    writes: 0,
    calls: [] as { pipelineId: string; ids: string[] }[],
  };
  const http = () => request(app.getHttpServer());

  const scriptedErxes: ErxesFetch = (url, init) => {
    const answer = (body: unknown, headers: Record<string, string> = {}) =>
      Promise.resolve(new Response(JSON.stringify(body), { headers }));
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
    if ((init.headers as Record<string, string>).cookie !== 'auth-token=session1') {
      return answer({ errors: [{ message: 'Login required' }] });
    }
    const root = /^query bto(?:\([^)]*\))? \{\n(\w+)/.exec(query)?.[1];
    switch (root) {
      case 'configsGetValue':
        return answer({ data: { configsGetValue: erxes.config } });
      case 'products': {
        expect(query).toContain('status: "active"');
        const perPage = variables.perPage as number;
        const page = variables.page as number;
        return answer({
          data: { products: erxes.products.slice((page - 1) * perPage, page * perPage) },
        });
      }
      case 'erkhetRemainders': {
        const ids = variables.productIds as string[];
        const pipelineId = variables.pipelineId as string;
        erxes.calls.push({ pipelineId, ids });
        if (pipelineId === 'pl-drinks' && ids.includes('p-fail')) {
          return answer({ errors: [{ message: 'Erkhet did not answer' }] });
        }
        const config = erxes.config[pipelineId] as { location: string };
        const locations = config.location.split(',');
        return answer({
          data: {
            erkhetRemainders: ids.map((id) => ({
              _id: id,
              remainder: 0,
              remainders: Object.entries(erxes.balances[id] ?? {})
                .filter(([location]) => locations.includes(location))
                .map(([location, remainder]) => ({ location, remainder })),
            })),
          },
        });
      }
      default:
        return answer({
          errors: [{ message: `Cannot query field "${root ?? ''}" on type "Query".` }],
        });
    }
  };

  const overview = async (token = admin) =>
    (await http().get('/api/v1/erxes/stock').set(bearer(token)).expect(200)).body as OverviewJson;
  const link = (code: string, id: number | null, token = admin, status = 200) =>
    http()
      .patch(`/api/v1/erxes/stock/locations/${code}`)
      .set(bearer(token))
      .send({ warehouseId: id })
      .expect(status);
  const compare = async (query: Record<string, string | number | boolean>) =>
    (
      await http()
        .get('/api/v1/erxes/stock/compare')
        .query({ warehouseId, ...query })
        .set(bearer(keeper))
        .expect(200)
    ).body as ComparisonJson;
  const onHandTotal = async () =>
    (
      await sql.query<{ total: string }>(
        'SELECT coalesce(sum(on_hand), 0)::text AS total FROM warehouse_stock',
      )
    ).rows[0]?.total;
  const run = async () => {
    const started = (await http().post('/api/v1/erxes/stock/runs').set(bearer(admin)).expect(200))
      .body as OverviewJson;
    const runId = started.active?.id;
    if (runId === undefined) throw new Error('no run started');
    await app.get(ErxesStockRunFlowService).execute(runId);
    return runId;
  };

  beforeAll(async () => {
    app = await createHttpApp({
      override: (builder) =>
        builder
          .overrideProvider(ERXES_FETCH)
          .useValue(scriptedErxes)
          .overrideProvider(ERXES_STOCK_PACE)
          .useValue({ concurrency: 2, gapMs: 0, productPage: 2, batch: 1 }),
    });
    sql = await connectAs('migrator');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    keeper = await customRoleUser(app, admin, ['inventory.stocktakes.manage']);
    outsider = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;

    const inventory = inventoryApi(app, admin);
    warehouseId = (await inventory.warehouse('ES1')).id;
    otherWarehouseId = (await inventory.warehouse('ES2')).id;
    const shelf = (await inventory.bin(warehouseId, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const categoryId = await catalog.category('Эрхэтийн бараа');
    const baseUomId = await catalog.uomId('PCS');
    const product = (sku: string, name: string, fields: Record<string, unknown> = {}) =>
      catalog.product({ sku, name, categoryId, baseUomId, ...fields });
    cola = await product('7801', 'Кола 0.5л');
    juice = await product('7802', 'Жүүс 1л', { baseBarcodes: [EAN_JUICE] });
    failing = await product('7803', 'Ус 0.5л');
    onlyBto = await product('9001', 'Зөвхөн Bto-д');
    const pcs = (item: ProductJson) => unitOf(item, 'PCS').id;
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId,
        reason: 'SURPLUS',
        lines: [
          { productUnitId: pcs(cola), enteredQty: '100', binId: shelf, unitCost: '500' },
          { productUnitId: pcs(juice), enteredQty: '4', binId: shelf, unitCost: '500' },
          { productUnitId: pcs(failing), enteredQty: '2', binId: shelf, unitCost: '500' },
          { productUnitId: pcs(onlyBto), enteredQty: '8', binId: shelf, unitCost: '500' },
        ],
      })
      .expect(201);
    const adjustment = (created.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${adjustment}/submit`).set(bearer(admin)).expect(200);
    await http()
      .post(`/api/v1/adjustments/${adjustment}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(200);
  });

  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('opens the page to the stock counters and its buttons to the warehouse set-up right', async () => {
    await http().get('/api/v1/erxes/stock').set(bearer(outsider)).expect(403);
    await http()
      .get('/api/v1/erxes/stock/compare')
      .query({ warehouseId: 1 })
      .set(bearer(outsider))
      .expect(403);
    await overview(keeper);
    await http().get('/api/v1/erxes/stock/locations').set(bearer(keeper)).expect(200);
    await http().post('/api/v1/erxes/stock/runs').set(bearer(keeper)).expect(403);
    await link('01', warehouseId, keeper, 403);
  });

  it('starts nothing without a saved sign-in', async () => {
    const started = (await http().post('/api/v1/erxes/stock/runs').set(bearer(admin)).expect(200))
      .body as OverviewJson;
    expect(started).toMatchObject({ configured: false, active: null });
    await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    expect((await overview()).configured).toBe(true);
  });

  it('lists the known locations and links them by hand', async () => {
    const before = (
      await http().get('/api/v1/erxes/stock/locations').set(bearer(keeper)).expect(200)
    ).body as { code: string; name: string | null; warehouseId: number | null }[];
    expect(before.map((location) => location.code)).toEqual(
      expect.arrayContaining(['01', '02', '04', '05', '08', '17']),
    );
    expect(before.every((location) => location.warehouseId === null)).toBe(true);
    // Two locations add up in one warehouse.
    await link('01', warehouseId);
    const after = (await link('08', warehouseId)).body as {
      code: string;
      warehouseId: number | null;
    }[];
    expect(
      after.filter((location) => location.warehouseId === warehouseId).map((l) => l.code),
    ).toEqual(['01', '08']);
    await link('02', otherWarehouseId);
    await link('02', null);
    await link('99', warehouseId, admin, 404);
    await link('01', 999_999, admin, 422);
    const audit = await sql.query(
      `SELECT 1 FROM audit_log WHERE entity = 'erxes_stock_locations' AND entity_id = '08'`,
    );
    expect(audit.rowCount).toBe(1);
  });

  it('reads Erkhet in the worker, counts a refused call and changes no stock', async () => {
    const stockBefore = await onHandTotal();
    const start = async () =>
      (
        (await http().post('/api/v1/erxes/stock/runs').set(bearer(admin)).expect(200))
          .body as OverviewJson
      ).active;
    const started = await start();
    expect(started).toMatchObject({ status: 'QUEUED' });
    // A second press while one waits answers that one.
    expect((await start())?.id).toBe(started?.id);
    const runId = started?.id ?? 0;
    expect(await app.get(ErxesStockRunFlowService).execute(runId)).toEqual({ status: 'DONE' });
    // A run is done once.
    expect(await app.get(ErxesStockRunFlowService).execute(runId)).toEqual({ status: 'SKIPPED' });
    const state = await overview();
    expect(state.active).toBeNull();
    expect(state.latest).toMatchObject({
      id: runId,
      status: 'DONE',
      products: 5,
      // 5 products, one a call, through pl-hall and pl-drinks; pl-cash is not the stock account.
      batchesTotal: 10,
      batchesDone: 10,
      batchesFailed: 1,
      productsUnread: 1,
    });
    expect(new Set(erxes.calls.map((call) => call.pipelineId))).toEqual(
      new Set(['pl-hall', 'pl-drinks']),
    );
    expect(erxes.calls.every((call) => call.ids.length === 1)).toBe(true);
    expect(erxes.writes).toBe(0);
    expect(await onHandTotal()).toBe(stockBefore);
  });

  it('compares the linked locations with Bto in three groups', async () => {
    const all = await compare({ onlyDifferent: false });
    expect(all.locations.map((location) => location.code)).toEqual(['01', '08']);
    expect(all.counts).toEqual({ matched: 3, different: 2, notInBto: 1, notInErkhet: 1 });
    const byCode = Object.fromEntries(all.data.map((row) => [row.code, row]));
    // 01: 90 and 08: 3; 02 is not linked to this warehouse.
    expect(byCode['7801']).toMatchObject({
      erkhet: '93',
      bto: '100',
      difference: '-7',
      unitDiffers: false,
    });
    // Matched by barcode; erxes counts it in boxes, Bto in pieces: marked, not converted.
    expect(byCode['7802']).toMatchObject({
      erkhet: '4',
      bto: '4',
      difference: '0',
      unitDiffers: true,
    });
    // A call for it was refused: unknown, never zero.
    expect(byCode['7803']).toMatchObject({ erkhet: null, bto: '2', difference: null });

    const different = await compare({ onlyDifferent: true });
    expect(different.data.map((row) => row.code)).toEqual(['7801', '7803']);
    expect((await compare({ q: 'кола' })).data.map((row) => row.code)).toEqual(['7801']);

    const notInBto = await compare({ group: 'NOT_IN_BTO' });
    expect(notInBto.data).toEqual([
      expect.objectContaining({
        erxesId: 'p-new',
        code: '7899',
        erkhet: '6',
        reason: 'PRODUCT_NOT_FOUND',
      }),
    ]);
    const notInErkhet = await compare({ group: 'NOT_IN_ERKHET' });
    expect(notInErkhet.data).toEqual([
      expect.objectContaining({ productId: onlyBto.id, code: '9001', bto: '8', erkhet: null }),
    ]);

    // A warehouse with no linked location compares nothing.
    const other = (
      await http()
        .get('/api/v1/erxes/stock/compare')
        .query({ warehouseId: otherWarehouseId })
        .set(bearer(keeper))
        .expect(200)
    ).body as ComparisonJson;
    expect(other).toMatchObject({ locations: [], data: [] });
  });

  it('keeps only the newest run’s rows', async () => {
    erxes.balances['p-cola'] = { '01': 100, '08': 3 };
    const first = (await overview()).latest?.id;
    const second = await run();
    expect(second).not.toBe(first);
    const { rows } = await sql.query<{ run_id: string }>(
      'SELECT DISTINCT run_id::text FROM erxes_stock_products',
    );
    expect(rows.map((row) => Number.parseInt(row.run_id, 10))).toEqual([second]);
    const all = await compare({ onlyDifferent: false });
    expect(all.data.find((row) => row.code === '7801')).toMatchObject({
      erkhet: '103',
      difference: '3',
    });
  });

  it('fails a run erxes will not sign in to, keeping the last finished one', async () => {
    const latest = (await overview()).latest?.id;
    await http()
      .patch('/api/v1/erxes/settings')
      .set(bearer(admin))
      .send({ password: 'wrong-test-password' })
      .expect(200);
    await run();
    const state = await overview();
    expect(state.failed).toMatchObject({ status: 'FAILED', failure: 'LOGIN_FAILED' });
    expect(state.latest?.id).toBe(latest);
    expect((await compare({ onlyDifferent: false })).runId).toBe(latest);
  });
});
