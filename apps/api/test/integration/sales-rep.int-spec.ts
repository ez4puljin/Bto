import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, salesApi } from '../harness/sales';
import { repApi, type RepOrderJson, repOrderBody } from '../harness/sales-rep';

interface StageJson {
  id: number;
  name: string;
  archivedAt: string | null;
}
interface PipelineJson {
  id: number;
  stages: StageJson[];
}

type StageRoles = { VIEW: number[]; EDIT: number[]; MOVE: number[] };
const NO_STAGE_ROLES: StageRoles = { VIEW: [], EDIT: [], MOVE: [] };
const NO_PIPELINE_ROLES = { VIEW: [], MANAGE: [], ALL_ORDERS: [] };
const stageBody = (name: string, action: string, roles: StageRoles = NO_STAGE_ROLES) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles,
});

/**
 * The sales-rep app's orders (ADR-0061 #5–#6): the stages a rep may place on, an order created on
 * the chosen stage (a draft on NONE, confirmed and reserved on CONFIRM, nothing left behind on a
 * refusal), idempotent sends, and only the rep's own orders by Ulaanbaatar days and search
 * (ADR-0066). Synthetic data.
 */
describe('sales rep orders', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let repA: string;
  let repB: string;
  let repAId: number;
  let cola: ProductJson;
  let waiting: ProductJson;
  let shop: CustomerJson;
  let closed: CustomerJson;
  let addressId: number;
  let main: PipelineJson;
  let shared: PipelineJson;
  let hidden: PipelineJson;
  let roleIds: Record<string, number>;
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const stage = (pipeline: PipelineJson, name: string) => {
    const found = pipeline.stages.find((entry) => entry.name === name);
    if (!found) throw new Error(`no stage ${name}`);
    return found.id;
  };
  const count = async (query: string, params: unknown[] = []) =>
    (await sql.query<{ count: string }>(query, params)).rows[0]?.count;

  async function pipeline(
    boardId: number,
    name: string,
    visibility: string,
    roles: Record<string, number[]>,
    stages: ReturnType<typeof stageBody>[],
  ): Promise<PipelineJson> {
    const created = await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({ boardId, name, visibility, ownOrdersOnly: false, roles, stages })
      .expect(201);
    const id =
      (created.body as { id?: number; pipeline?: { id: number } }).pipeline?.id ??
      (created.body as { id: number }).id;
    return (await http().get(`/api/v1/sales-pipelines/${id}`).set(bearer(admin)).expect(200))
      .body as PipelineJson;
  }

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const a = await seedUser(app, { roles: ['SALES_REP'] });
    repAId = a.id;
    repA = (await login(app, a)).accessToken;
    repB = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    const roles = (
      (await http().get('/api/v1/roles').set(bearer(admin)).expect(200)).body as {
        data: { id: number; code: string | null }[];
      }
    ).data;
    roleIds = Object.fromEntries(
      roles.flatMap((role) => (role.code ? [[role.code, role.id] as const] : [])),
    );

    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SR1');
    const shelf = (await inventory.bin(wh.id, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Төлөөлөгчийн бараа');
    const base = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '7951',
      name: 'Кола',
      categoryId: category,
      baseUomId: base,
    });
    waiting = await catalog.product({
      sku: '7952',
      name: 'Хүлээгдэж буй',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(cola.id, wh.id);
    await inventory.setHome(waiting.id, wh.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Төлөөлөгч: Ундаа');
    await pricing.terms(cola.id, '1000', profile, null);
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
        lines: [{ productUnitId: pcs(cola), enteredQty: '30', binId: shelf, unitCost: '700' }],
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

    const partners = partnersApi(app, admin);
    shop = await partners.customer({ name: 'Төлөөлөгчийн дэлгүүр' });
    addressId = (
      (
        await http()
          .post(`/api/v1/customers/${shop.id}/addresses`)
          .set(bearer(admin))
          .send({ address: 'Мөрөн, 5-р баг', isDefault: true })
          .expect(201)
      ).body as { id: number }
    ).id;
    closed = await partners.customer({ name: 'Хаагдсан дэлгүүр' });
    await http()
      .patch(`/api/v1/customers/${closed.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);

    const boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Мөрөн' })
          .expect(201)
      ).body as { id: number }
    ).id;
    main = await pipeline(boardId, 'Мөрөн Борлуулалт', 'PUBLIC', NO_PIPELINE_ROLES, [
      stageBody('ХТ Захиалга', 'NONE'),
      stageBody('Нярав Хяналт', 'CONFIRM'),
      stageBody('Бэлдэх', 'PICK'),
      stageBody('Борлуулалт', 'SALE'),
      stageBody('Цуцалсан', 'CANCEL'),
      stageBody('Оффисынх', 'NONE', { VIEW: [], EDIT: [], MOVE: [roleIds.OFFICE ?? 0] }),
    ]);
    shared = await pipeline(
      boardId,
      'Төлөөлөгчдийн',
      'PRIVATE',
      { VIEW: [roleIds.SALES_REP ?? 0], MANAGE: [], ALL_ORDERS: [] },
      [stageBody('Шинэ', 'NONE', { VIEW: [], EDIT: [], MOVE: [roleIds.SALES_REP ?? 0] })],
    );
    hidden = await pipeline(boardId, 'Нууц', 'PRIVATE', NO_PIPELINE_ROLES, [
      stageBody('Нууц шат', 'NONE'),
    ]);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('keeps reps to the app: no office order route, no customer list; the office not in the app', async () => {
    for (const path of ['/api/v1/sales-orders', '/api/v1/customers', '/api/v1/sales-boards']) {
      await http().get(path).set(bearer(repA)).expect(403);
    }
    await salesApi(app, repA)
      .create(orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(403);
    await http().get('/api/v1/sales-rep/context').set(bearer(office)).expect(403);
  });

  it('lists the NONE and CONFIRM stages a rep may place on, and the channel default', async () => {
    const before = await repApi(app, repA).context();
    expect(before.today).toBe(businessDate());
    const pipelines = before.boards.flatMap((board) => board.pipelines);
    expect(
      pipelines.map((entry) => [entry.name, entry.stages.map((s) => `${s.name}:${s.action}`)]),
    ).toEqual([
      ['Мөрөн Борлуулалт', ['ХТ Захиалга:NONE', 'Нярав Хяналт:CONFIRM']],
      ['Төлөөлөгчдийн', ['Шинэ:NONE']],
    ]);
    expect(before.defaultStageId).toBeNull();
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'SALES_REP', pipelineId: main.id, stageId: stage(main, 'ХТ Захиалга') })
      .expect(200);
    expect((await repApi(app, repA).context()).defaultStageId).toBe(stage(main, 'ХТ Захиалга'));
    expect(hidden.stages).toHaveLength(1);
  });

  it('creates a numbered draft on a NONE stage, on the rep channel, reserving nothing', async () => {
    const order = await repApi(app, repA).order(
      repOrderBody(stage(main, 'ХТ Захиалга'), shop.id, [{ productUnitId: pcs(cola), qty: '3' }], {
        fulfilment: 'DELIVERY',
        addressId,
      }),
    );
    expect(order).toMatchObject({
      status: 'DRAFT',
      stageName: 'ХТ Захиалга',
      pipelineName: 'Мөрөн Борлуулалт',
      addressText: 'Мөрөн, 5-р баг',
      total: null,
    });
    expect(order.number).toMatch(/^\d{8}_\d{4}$/);
    const { rows } = await sql.query<{ channel: string; created_by: string }>(
      'SELECT channel, created_by::text FROM sales_orders WHERE id = $1',
      [order.id],
    );
    expect(rows).toEqual([{ channel: 'SALES_REP', created_by: String(repAId) }]);
    expect(
      await count(`SELECT count(*) FROM stock_reservations WHERE doc_type = 'SO' AND doc_id = $1`, [
        order.id,
      ]),
    ).toBe('0');
  });

  it('confirms on a CONFIRM stage in the same transaction: prices frozen, stock reserved, the rest short', async () => {
    const order = await repApi(app, repA).order(
      repOrderBody(stage(main, 'Нярав Хяналт'), shop.id, [{ productUnitId: pcs(cola), qty: '35' }]),
    );
    expect(order).toMatchObject({ status: 'CONFIRMED', stageName: 'Нярав Хяналт' });
    expect(order.lines[0]).toMatchObject({ qtyApproved: '30', qtyBackordered: '5' });
    expect(order.total).toEqual(expect.stringMatching(/^\d+$/));
    expect(order.events.map((event) => event.toStatus)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'CONFIRMED',
    ]);
    expect(order.number).toMatch(/^\d{8}_\d{4}$/);
    // Cancelled so the stock is free again for the tests below.
    await http()
      .post(`/api/v1/sales-orders/${order.id}/cancel`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Тест' })
      .expect(200);
  });

  it('leaves nothing behind when it refuses: a stage of another kind, an unseen stage, the data', async () => {
    const orders = await count('SELECT count(*) FROM sales_orders');
    const lines = [{ productUnitId: pcs(cola), qty: '1' }];
    // Stages a rep may not use: a PICK stage, MOVE kept for the office, a pipeline they do not see.
    for (const stageId of [
      stage(main, 'Бэлдэх'),
      stage(main, 'Оффисынх'),
      stage(hidden, 'Нууц шат'),
    ]) {
      const response = await repApi(app, repA)
        .create(repOrderBody(stageId, shop.id, lines))
        .expect(422);
      expect(response.body).toMatchObject({
        errors: [expect.objectContaining({ path: 'stageId', constraint: 'repStage' })],
      });
    }
    // The office's own checks: an inactive customer, a product waiting for prices, a delivery
    // without an address.
    for (const body of [
      repOrderBody(stage(main, 'Нярав Хяналт'), closed.id, lines),
      repOrderBody(stage(main, 'Нярав Хяналт'), shop.id, [
        { productUnitId: pcs(waiting), qty: '1' },
      ]),
      repOrderBody(stage(main, 'ХТ Захиалга'), shop.id, lines, { fulfilment: 'DELIVERY' }),
    ]) {
      const response = await repApi(app, repA).create(body);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    }
    expect(await count('SELECT count(*) FROM sales_orders')).toBe(orders);
  });

  it('replays a repeated send and refuses the same key for another body', async () => {
    const key = idempotency();
    const body = repOrderBody(stage(shared, 'Шинэ'), shop.id, [
      { productUnitId: pcs(cola), qty: '2' },
    ]);
    const first = await repApi(app, repA).create(body, key).expect(201);
    const again = await repApi(app, repA).create(body, key).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as RepOrderJson).id).toBe((first.body as RepOrderJson).id);
    await repApi(app, repA)
      .create({ ...body, note: 'өөр' }, key)
      .expect(409);
  });

  it('shows a rep only their own rep orders, by Ulaanbaatar days and search', async () => {
    const theirs = await repApi(app, repB).order(
      repOrderBody(stage(main, 'ХТ Захиалга'), shop.id, [{ productUnitId: pcs(cola), qty: '1' }]),
    );
    const officeOrder = (
      await salesApi(app, office)
        .create(orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
        .expect(201)
    ).body as { id: number };
    const today = businessDate();
    const first = `${today.slice(0, 7)}-01`;
    const range = { from: first, to: today };
    const mine = await repApi(app, repA).list(range);
    expect(mine.data.map((row) => row.id)).not.toContain(theirs.id);
    expect(mine.data.map((row) => row.id)).not.toContain(officeOrder.id);
    expect(mine.data.length).toBeGreaterThanOrEqual(3);
    expect(mine.summary).toMatchObject({ count: mine.data.length });
    // Each row counts its own order's lines (a bare "id" in the subquery once matched the line's).
    const { rows: lines } = await sql.query<{ id: number; lines: number }>(
      `SELECT order_id::int AS id, count(*)::int AS lines FROM sales_order_lines
        WHERE order_id = ANY($1::bigint[]) GROUP BY order_id`,
      [mine.data.map((row) => row.id)],
    );
    expect(lines).toHaveLength(mine.data.length);
    expect(Object.fromEntries(mine.data.map((row) => [row.id, row.lineCount]))).toEqual(
      Object.fromEntries(lines.map((row) => [row.id, row.lines])),
    );
    await repApi(app, repA).get(theirs.id).expect(404);
    await repApi(app, repA).get(officeOrder.id).expect(404);
    await repApi(app, repB)
      .get(mine.data[0]?.id ?? 0)
      .expect(404);

    // A customer's name or an order number finds the order; the summary follows the search.
    const named = await repApi(app, repA).list({ ...range, q: 'Төлөөлөгчийн' });
    expect(named.data.map((row) => row.id).sort()).toEqual(mine.data.map((row) => row.id).sort());
    expect(named.summary).toEqual(mine.summary);
    const numbered = mine.data.find((row) => row.number !== null);
    const byNumber = await repApi(app, repA).list({ ...range, q: numbered?.number ?? '' });
    expect(byNumber.data.map((row) => row.id)).toEqual([numbered?.id]);
    expect(byNumber.summary).toMatchObject({ count: 1 });
    const none = await repApi(app, repA).list({ ...range, q: 'Ийм харилцагч алга' });
    expect(none).toMatchObject({ data: [], summary: { count: 0, total: '0', drafts: 0 } });

    // 2026-09-30 16:30Z is 2026-10-01 00:30 in Ulaanbaatar: the order counts on the 1st.
    const moved = mine.data[0]?.id ?? 0;
    const dayBefore = addDays(first, -1);
    await sql.query(
      `UPDATE sales_orders SET created_at = ($2::date - interval '7 hours 30 minutes') AT TIME ZONE 'UTC'
        WHERE id = $1`,
      [moved, first],
    );
    expect((await repApi(app, repA).list(range)).data.map((row) => row.id)).toContain(moved);
    await sql.query(
      `UPDATE sales_orders SET created_at = ($2::date - interval '8 hours 1 minute') AT TIME ZONE 'UTC'
        WHERE id = $1`,
      [moved, first],
    );
    expect(
      (await repApi(app, repA).list({ from: dayBefore, to: dayBefore })).data.map((row) => row.id),
    ).toEqual([moved]);
    expect((await repApi(app, repA).list(range)).data.map((row) => row.id)).not.toContain(moved);

    // 366 days at most, both ends included; the days must exist; the month form is gone.
    await repApi(app, repA).list({ from: addDays(today, -365), to: today });
    for (const query of [
      { from: addDays(today, -366), to: today },
      { from: today, to: addDays(today, -1) },
      { from: '2026-02-30', to: '2026-03-01' },
      { from: '2026-10', to: today },
      { from: today },
      { month: today.slice(0, 7) },
    ]) {
      await http().get('/api/v1/sales-rep/orders').query(query).set(bearer(repA)).expect(422);
    }
  });

  it('puts the rep order on the office board, where the office moves it on', async () => {
    const order = await repApi(app, repA).order(
      repOrderBody(stage(main, 'ХТ Захиалга'), shop.id, [{ productUnitId: pcs(cola), qty: '4' }]),
    );
    const seen = await salesApi(app, office).get(order.id);
    expect(seen).toMatchObject({ status: 'DRAFT', stageName: 'ХТ Захиалга' });
    const moved = await http()
      .post(`/api/v1/sales-orders/${order.id}/move`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ stageId: stage(main, 'Нярав Хяналт') })
      .expect(200);
    expect((moved.body as { order: { status: string } }).order.status).toBe('CONFIRMED');
    const own = (await repApi(app, repA).get(order.id).expect(200)).body as RepOrderJson;
    expect(own).toMatchObject({ status: 'CONFIRMED', stageName: 'Нярав Хяналт' });
    await http()
      .post(`/api/v1/sales-orders/${order.id}/cancel`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Тест' })
      .expect(200);
  });
});
