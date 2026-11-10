import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
}
interface StageJson {
  id: number;
  name: string;
  archivedAt: string | null;
}
interface PipelineJson {
  id: number;
  boardId: number;
  loadedStageId: number | null;
  stages: StageJson[];
}
interface LoadingJson {
  driverId: number;
  driverName: string | null;
  loadedAt: string;
}
interface LoadingOrderJson {
  orderId: number;
  orderNumber: string | null;
  status: string;
  customerName: string;
  lineCount: number;
  total: string | null;
  loading: LoadingJson | null;
}
type DetailJson = OrderJson & { stageId: number | null; loading: LoadingJson | null };

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageBody = (name: string, action: string, id?: number) => ({
  ...(id ? { id } : {}),
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
});
const STAGES: [string, string][] = [
  ['Ирсэн', 'NONE'],
  ['Нөөцлөх', 'CONFIRM'],
  ['Бэлдэх', 'PICK'],
  ['Бэлдсэн', 'NONE'],
  ['Борлуулалт', 'SALE'],
  ['Ачигдсан', 'NONE'],
];

/**
 * The driver's loading (ADR-0179): a driver sees the picked orders of the sales pipelines, marks
 * the stores loaded onto their truck (who and when kept), a sold order's card moves into the
 * pipeline's loaded stage while a packed one stays before the sale, a second loading and an
 * unpicked order are refused, and a loading is taken back by its driver or the admin only.
 * Synthetic data.
 */
describe('sales loading by drivers', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let driver: string;
  let driverId: number;
  let otherDriver: string;
  let keeper: string;
  let shelf: number;
  let cola: ProductJson;
  let shop: CustomerJson;
  let pipeline: PipelineJson;
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const stage = (name: string) => {
    const found = pipeline.stages.find((entry) => entry.name === name && !entry.archivedAt);
    if (!found) throw new Error(`no stage ${name}`);
    return found;
  };
  const move = (orderId: number, stageName: string) =>
    http()
      .post(`/api/v1/sales-orders/${orderId}/move`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ stageId: stage(stageName).id })
      .expect(200);
  const detail = async (id: number) =>
    (await http().get(`/api/v1/sales-orders/${id}`).set(bearer(admin)).expect(200))
      .body as DetailJson;
  const work = async (token: string) =>
    (await http().get('/api/v1/sales-loading').set(bearer(token)).expect(200))
      .body as LoadingOrderJson[];
  const load = (token: string, orderIds: number[]) =>
    http().post('/api/v1/sales-loading').set(bearer(token)).set(idempotency()).send({ orderIds });
  const undo = (token: string, orderId: number) =>
    http().post(`/api/v1/sales-loading/${orderId}/undo`).set(bearer(token)).send({});
  /** An order of 2 colas picked and in «Бэлдсэн» (PACKED). */
  const packedOrder = async (): Promise<number> => {
    const draft = await salesApi(app, admin).draft(
      orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '2' }], { pipelineId: pipeline.id }),
    );
    await move(draft.id, 'Нөөцлөх');
    await move(draft.id, 'Бэлдэх');
    const order = await detail(draft.id);
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/pick`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ lines: [{ lineId: order.lines[0]?.id, qty: '2', binId: shelf }] })
      .expect(200);
    await move(draft.id, 'Бэлдсэн');
    return draft.id;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('LDA');
    shelf = (await inventory.bin(wh.id, 'A-01-01')).id;
    const seeded = await seedUser(app, { roles: ['DRIVER'] });
    driverId = seeded.id;
    driver = (await login(app, seeded)).accessToken;
    otherDriver = (await login(app, await seedUser(app, { roles: ['DRIVER'] }))).accessToken;
    keeper = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh.id] }))
    ).accessToken;

    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ачилтын бараа');
    cola = await catalog.product({
      sku: '7931',
      name: 'Ачилтын кола',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventory.setHome(cola.id, wh.id);
    const pricing = pricingApi(app, admin);
    await pricing.terms(cola.id, '1000', await pricing.profile('Ачилт: Ундаа'), null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id] })
      .expect(200);
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        reason: 'SURPLUS',
        lines: [{ productUnitId: pcs(cola), enteredQty: '50', binId: shelf, unitCost: '500' }],
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
    shop = await partnersApi(app, admin).customer({ name: 'Ачилтын дэлгүүр' });
    const board = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Ачилт' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const body = {
      boardId: board,
      name: 'Ачилтын борлуулалт',
      visibility: 'PUBLIC',
      ownOrdersOnly: false,
      kind: 'SALES',
      roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
    };
    pipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({ ...body, stages: STAGES.map(([name, action]) => stageBody(name, action)) })
        .expect(201)
    ).body as PipelineJson;
    expect(pipeline.loadedStageId).toBeNull();
    const save = (loadedStageId: number | null) =>
      http()
        .put(`/api/v1/sales-pipelines/${pipeline.id}`)
        .set(bearer(admin))
        .send({
          ...body,
          loadedStageId,
          stages: STAGES.map(([name, action]) => stageBody(name, action, stage(name).id)),
        });
    // The loaded stage runs no action (ADR-0179 #3).
    expect(((await save(stage('Борлуулалт').id).expect(422)).body as ProblemJson).code).toBe(
      'VALIDATION_FAILED',
    );
    await save(stage('Ачигдсан').id).expect(200);
    pipeline = (
      await http().get(`/api/v1/sales-pipelines/${pipeline.id}`).set(bearer(admin)).expect(200)
    ).body as PipelineJson;
    expect(pipeline.loadedStageId).toBe(stage('Ачигдсан').id);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('lists the picked orders, records who loaded them and when, and moves only sold cards', async () => {
    const packed = await packedOrder();
    const sold = await packedOrder();
    await move(sold, 'Борлуулалт');
    expect(['DELIVERED', 'INVOICED']).toContain((await detail(sold)).status);
    // An order not yet picked is not on the list and cannot be loaded.
    const waitingDraft = await salesApi(app, admin).draft(
      orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }], { pipelineId: pipeline.id }),
    );
    await move(waitingDraft.id, 'Нөөцлөх');

    // Only the right opens the list.
    await http().get('/api/v1/sales-loading').set(bearer(keeper)).expect(403);
    const list = await work(driver);
    const mine = list.filter((row) => [packed, sold, waitingDraft.id].includes(row.orderId));
    expect(mine.map((row) => [row.orderId, row.loading])).toEqual([
      [packed, null],
      [sold, null],
    ]);
    expect(mine[0]).toMatchObject({ customerName: 'Ачилтын дэлгүүр', lineCount: 1, total: '2000' });
    expect(((await load(driver, [waitingDraft.id]).expect(409)).body as ProblemJson).code).toBe(
      'ORDER_NOT_LOADABLE',
    );

    const before = Date.now();
    const after = (await load(driver, [sold, packed]).expect(200)).body as LoadingOrderJson[];
    const loaded = after.filter((row) => [packed, sold].includes(row.orderId));
    expect(loaded.map((row) => [row.orderId, row.loading?.driverId])).toEqual([
      [packed, driverId],
      [sold, driverId],
    ]);
    expect(Date.parse(loaded[0]?.loading?.loadedAt ?? '')).toBeGreaterThanOrEqual(before - 5000);
    // The sold card moved into «Ачигдсан»; the packed one waits before the sale in «Бэлдсэн».
    expect((await detail(sold)).stageId).toBe(stage('Ачигдсан').id);
    const packedDetail = await detail(packed);
    expect(packedDetail.stageId).toBe(stage('Бэлдсэн').id);
    expect(packedDetail.status).toBe('PACKED');
    expect(packedDetail.loading).toMatchObject({ driverId });
    // The board's card carries the loading too.
    const stages = (
      await http()
        .get(`/api/v1/sales-pipelines/${pipeline.id}/cards`)
        .set(bearer(admin))
        .expect(200)
    ).body as { cards: { id: number; loading: LoadingJson | null }[] }[];
    const card = stages.flatMap((entry) => entry.cards).find((entry) => entry.id === sold);
    expect(card?.loading).toMatchObject({ driverId });
    // Another driver neither sees them waiting nor loads them again.
    expect((await work(otherDriver)).map((row) => row.orderId)).not.toContain(sold);
    const twice = (await load(otherDriver, [packed]).expect(409)).body as ProblemJson;
    expect(twice.code).toBe('ORDER_ALREADY_LOADED');
    expect(twice.params?.number).toBe(packedDetail.number);
    // The sale of a loaded order still runs as before.
    await move(packed, 'Борлуулалт');
    expect((await detail(packed)).loading).toMatchObject({ driverId });

    // Taking a loading back: not another driver; the driver the same day, the card going back.
    expect(((await undo(otherDriver, sold).expect(403)).body as ProblemJson).code).toBe(
      'LOAD_UNDO_FORBIDDEN',
    );
    await undo(driver, sold).expect(200);
    const undone = await detail(sold);
    expect(undone.loading).toBeNull();
    expect(undone.stageId).toBe(stage('Борлуулалт').id);
    expect((await work(otherDriver)).map((row) => row.orderId)).toContain(sold);
    await undo(driver, sold).expect(409);
    // The admin takes back another's loading; the row stays with who undid it.
    await undo(admin, packed).expect(200);
    const rows = await sql.query<{ order_id: string; undone: boolean }>(
      `SELECT order_id::text, undone_at IS NOT NULL AS undone FROM sales_order_loads
        WHERE order_id = ANY($1::bigint[]) ORDER BY id`,
      [[packed, sold]],
    );
    expect(rows.rows.map((row) => row.undone)).toEqual([true, true]);
    // A loading is never deleted.
    await expect(sql.query('DELETE FROM sales_order_loads')).rejects.toThrow(/permission denied/);
  });
});
