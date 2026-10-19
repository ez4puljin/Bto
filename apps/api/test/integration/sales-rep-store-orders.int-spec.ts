import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, salesApi } from '../harness/sales';
import { repApi, type RepOrderJson, repOrderBody } from '../harness/sales-rep';

interface PipelineJson {
  id: number;
  stages: { id: number; name: string }[];
}

interface StoreOrderJson {
  id: number;
  number: string | null;
  status: string;
  channel: string;
  createdAt: string;
  createdDate: string;
  createdTime: string;
  takerName: string | null;
  mine: boolean;
  total: string | null;
  estimatedTotal: string | null;
  lineCount: number;
}

interface StoreOrderPageJson {
  data: StoreOrderJson[];
  nextCursor: string | null;
}

const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
});

/**
 * A store's order history in the rep app (ADR-0068): every order of the store, whoever took it
 * and on whichever channel, any status, newest first, with the taker's name and the Ulaanbaatar
 * day and time; only the caller's own rep orders are `mine` (the ones that open). Synthetic data.
 */
describe('sales rep store order history', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let repA: string;
  let repB: string;
  let cola: ProductJson;
  let store: CustomerJson;
  let elsewhere: CustomerJson;
  const orders: Record<string, RepOrderJson> = {};
  let officeOrder: { id: number; number: string | null };
  let repAOffice: { id: number; number: string | null };
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;

  async function history(
    token: string,
    customerId: number,
    query: Record<string, unknown> = {},
  ): Promise<StoreOrderPageJson> {
    return (
      await http()
        .get(`/api/v1/sales-rep/customers/${customerId}/orders`)
        .query(query)
        .set(bearer(token))
        .expect(200)
    ).body as StoreOrderPageJson;
  }

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const named = async (roles: string[], fullName: string) => {
      const user = await seedUser(app, { roles });
      await sql.query('UPDATE users SET full_name = $2 WHERE id = $1', [user.id, fullName]);
      return { id: user.id, token: (await login(app, user)).accessToken };
    };
    admin = (await named(['ADMIN'], 'Түүх Оффис')).token;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const repAUser = await named(['SALES_REP'], 'Түүх Борлуулагч А');
    repA = repAUser.token;
    repB = (await named(['SALES_REP'], 'Түүх Борлуулагч Б')).token;

    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SM1');
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Түүхийн бараа');
    cola = await catalog.product({
      sku: '7981',
      name: 'Түүхийн кола',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
    });
    await inventory.setHome(cola.id, wh.id);
    const pricing = pricingApi(app, admin);
    await pricing.terms(cola.id, '1000', await pricing.profile('Түүх: Ундаа'), null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id] })
      .expect(200);

    const partners = partnersApi(app, admin);
    store = await partners.customer({ name: 'Түүхийн дэлгүүр' });
    elsewhere = await partners.customer({ name: 'Түүхийн өөр дэлгүүр' });

    const boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Түүх' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const created = await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({
        boardId,
        name: 'Түүхийн борлуулалт',
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
        stages: [stageBody('Ноорог', 'NONE'), stageBody('Батлах', 'CONFIRM')],
      })
      .expect(201);
    const pipelineId =
      (created.body as { id?: number; pipeline?: { id: number } }).pipeline?.id ??
      (created.body as { id: number }).id;
    const pipeline = (
      await http().get(`/api/v1/sales-pipelines/${pipelineId}`).set(bearer(admin)).expect(200)
    ).body as PipelineJson;
    const stageOf = (name: string) => pipeline.stages.find((entry) => entry.name === name)?.id ?? 0;
    const draftStage = stageOf('Ноорог');
    const confirmStage = stageOf('Батлах');

    // Oldest first: the office's draft, rep A's office-channel draft, rep B's order, then rep A's
    // confirmed, draft, cancelled.
    officeOrder = await salesApi(app, admin).draft(
      orderBody(store.id, [{ productUnitId: pcs(cola), qty: '1' }], { pipelineId }),
    );
    // 05:30 in Ulaanbaatar is 21:30 UTC the day before: the day and time must be Ulaanbaatar's.
    await sql.query(
      `UPDATE sales_orders SET created_at = timestamp '2026-10-02 05:30' AT TIME ZONE 'Asia/Ulaanbaatar'
        WHERE id = $1`,
      [officeOrder.id],
    );
    // Rep A's own order on the office channel (a user with both rights): not `mine`, never opens.
    repAOffice = await salesApi(app, admin).draft(
      orderBody(store.id, [{ productUnitId: pcs(cola), qty: '1' }], { pipelineId }),
    );
    await sql.query('UPDATE sales_orders SET created_by = $2 WHERE id = $1', [
      repAOffice.id,
      repAUser.id,
    ]);
    orders.theirs = await repApi(app, repB).order(
      repOrderBody(confirmStage, store.id, [{ productUnitId: pcs(cola), qty: '2' }]),
    );
    const rep = repApi(app, repA);
    orders.confirmed = await rep.order(
      repOrderBody(confirmStage, store.id, [{ productUnitId: pcs(cola), qty: '3' }]),
    );
    orders.draft = await rep.order(
      repOrderBody(draftStage, store.id, [{ productUnitId: pcs(cola), qty: '4' }]),
    );
    orders.cancelled = await rep.order(
      repOrderBody(draftStage, store.id, [{ productUnitId: pcs(cola), qty: '5' }]),
    );
    await http()
      .post(`/api/v1/sales-orders/${orders.cancelled.id}/cancel`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Тест' })
      .expect(200);
    // Another store's order never shows.
    orders.elsewhere = await rep.order(
      repOrderBody(draftStage, elsewhere.id, [{ productUnitId: pcs(cola), qty: '1' }]),
    );
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it("lists every order of the store, newest first, with who took it and the caller's own marked", async () => {
    const page = await history(repA, store.id);
    expect(page.nextCursor).toBeNull();
    const id = (name: string) => orders[name]?.id ?? 0;
    expect(page.data.map((row) => row.id)).toEqual([
      id('cancelled'),
      id('draft'),
      id('confirmed'),
      id('theirs'),
      repAOffice.id,
      officeOrder.id,
    ]);
    expect(
      page.data.map((row) => [row.status, row.channel, row.mine, row.takerName, row.lineCount]),
    ).toEqual([
      ['CANCELLED', 'SALES_REP', true, 'Түүх Борлуулагч А', 1],
      ['DRAFT', 'SALES_REP', true, 'Түүх Борлуулагч А', 1],
      ['CONFIRMED', 'SALES_REP', true, 'Түүх Борлуулагч А', 1],
      ['CONFIRMED', 'SALES_REP', false, 'Түүх Борлуулагч Б', 1],
      ['DRAFT', 'ADMIN', false, 'Түүх Борлуулагч А', 1],
      ['DRAFT', 'ADMIN', false, 'Түүх Оффис', 1],
    ]);
    expect(page.data.map((row) => row.number)).toEqual([
      orders.cancelled?.number,
      orders.draft?.number,
      orders.confirmed?.number,
      orders.theirs?.number,
      repAOffice.number,
      officeOrder.number,
    ]);

    // Amounts: a submitted order's frozen total; a draft's estimate (rep's or office's), no total.
    const [cancelled, draft, confirmed, theirs, , fromOffice] = page.data;
    expect(confirmed).toMatchObject({ total: orders.confirmed?.total, estimatedTotal: null });
    expect(confirmed?.total).toMatch(/^[1-9]\d*$/);
    expect(theirs).toMatchObject({ total: orders.theirs?.total, estimatedTotal: null });
    expect(draft).toMatchObject({ total: null, estimatedTotal: orders.draft?.estimatedTotal });
    expect(draft?.estimatedTotal).toMatch(/^[1-9]\d*$/);
    expect(cancelled).toMatchObject({ total: null, estimatedTotal: null });
    const quote = (
      await http()
        .post('/api/v1/pricing/quote')
        .set(bearer(repA))
        .send({ lines: [{ productUnitId: pcs(cola), qty: '1' }] })
        .expect(200)
    ).body as { total: string };
    expect(fromOffice).toMatchObject({ total: null, estimatedTotal: quote.total });

    // The Ulaanbaatar day and time of the instant, never UTC's.
    expect(fromOffice).toMatchObject({
      createdAt: '2026-10-01T21:30:00.000Z',
      createdDate: '2026-10-02',
      createdTime: '05:30',
    });
    for (const row of page.data) expect(row.createdTime).toMatch(/^\d{2}:\d{2}$/);

    // `mine` is exactly what opens: rep A's own office-channel order answers 404 too.
    for (const row of page.data) {
      await repApi(app, repA)
        .get(row.id)
        .expect(row.mine ? 200 : 404);
    }

    // Rep B sees the same orders with only their own marked.
    const theirView = await history(repB, store.id);
    expect(theirView.data.map((row) => row.id)).toEqual(page.data.map((row) => row.id));
    expect(theirView.data.map((row) => row.mine)).toEqual([
      false,
      false,
      false,
      true,
      false,
      false,
    ]);

    // The other store: only its own order.
    expect((await history(repA, elsewhere.id)).data.map((row) => row.id)).toEqual([
      id('elsewhere'),
    ]);
  });

  it('pages by the order id with a cursor', async () => {
    const all = (await history(repA, store.id)).data.map((row) => row.id);
    const first = await history(repA, store.id, { limit: 2 });
    expect(first.data.map((row) => row.id)).toEqual(all.slice(0, 2));
    expect(first.nextCursor).toEqual(expect.any(String));
    const rest = await history(repA, store.id, { limit: 50, cursor: first.nextCursor });
    expect(rest.data.map((row) => row.id)).toEqual(all.slice(2));
    expect(rest.nextCursor).toBeNull();
    const exact = await history(repA, store.id, { limit: 4, cursor: first.nextCursor });
    expect(exact).toMatchObject({ nextCursor: null });
    expect(exact.data).toHaveLength(4);

    for (const bad of [{ limit: 0 }, { limit: 51 }, { limit: 'x' }, { cursor: 'not-ours' }]) {
      await http()
        .get(`/api/v1/sales-rep/customers/${store.id}/orders`)
        .query(bad)
        .set(bearer(repA))
        .expect(422);
    }
  });

  it('answers 404 for a customer the rep may not see and 403 without the rep right', async () => {
    // Every existing customer is visible until reps are scoped to zones (delivery 7): an unknown
    // one stands for the rest.
    const missing = await http()
      .get('/api/v1/sales-rep/customers/2147483000/orders')
      .set(bearer(repA))
      .expect(404);
    expect((missing.body as { code: string }).code).toBe('NOT_FOUND');
    await http()
      .get(`/api/v1/sales-rep/customers/${store.id}/orders`)
      .set(bearer(office))
      .expect(403);
    await http().get(`/api/v1/sales-rep/customers/${store.id}/orders`).expect(401);
  });
});
