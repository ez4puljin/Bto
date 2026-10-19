import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { idempotency, type ProductJson } from '../harness/catalog';
import { type AppStore, appStore, storeOrderBody } from '../harness/customer-app';
import { salesFlow } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled } from '../harness/inventory';

interface StoreOrderJson {
  id: number;
  number: string | null;
  status: string;
  state: string;
  channel: string;
  total: string | null;
  estimatedTotal: string | null;
  cancelReason: string | null;
  invoice: { id: number; number: string } | null;
  lines: { productId: number; qty: string; qtyBackordered: string; total: string | null }[];
}

interface NotificationJson {
  id: number;
  kind: string;
  orderId: number | null;
  invoiceId: number | null;
  payload: Record<string, unknown>;
  read: boolean;
}

/** Orders from «Bto300» (ADR-0079 #5, #6, #8): the app channel, the office's confirmation. */
describe('customer app orders (ADR-0079)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let flow: Awaited<ReturnType<typeof salesFlow>>;
  let cola: ProductJson;
  let water: ProductJson;
  let store: AppStore;
  let other: AppStore;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const setAppChannel = (pipelineId: number | null, stageId: number | null) =>
    http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'CUSTOMER_APP', pipelineId, stageId });

  const notifications = async (target: AppStore) =>
    ((await target.api.get('/notifications').expect(200)).body as { data: NotificationJson[] })
      .data;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    flow = await salesFlow(app, admin, 'CAO');
    cola = await flow.product('9101', 'Кола', '1000', '30');
    water = await flow.product('9102', 'Ус', '500', '5');
    store = await appStore(app, office);
    other = await appStore(app, office);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('refuses to send while no stage without an action takes app orders', async () => {
    const closed = await store.api
      .send(storeOrderBody(today, [{ productUnitId: flow.pcs(cola), qty: '2' }]))
      .expect(409);
    expect(closed.body).toMatchObject({ code: 'CUSTOMER_APP_CLOSED' });
    expect((await store.api.get('/me').expect(200)).body).toMatchObject({ ordersOpen: false });
    const attention = await http().get('/api/v1/customer/attention').set(bearer(admin)).expect(200);
    expect(attention.body).toEqual({ activeAccounts: 2, ordersOpen: false });
    await http().get('/api/v1/customer/attention').set(bearer(office)).expect(403);
  });

  it('lands the app channel only on a stage without an action, in a pipeline all see', async () => {
    const refused = await setAppChannel(flow.pipeline.id, flow.stage('Хяналт').id).expect(422);
    expect(refused.body).toMatchObject({
      errors: [{ path: 'stageId', constraint: 'customerAppStage' }],
    });
    await setAppChannel(flow.pipeline.id, flow.stage('Захиалга').id).expect(200);
    // A save may give that stage no action, nor make the pipeline own-orders-only.
    const pipeline = (
      await http().get(`/api/v1/sales-pipelines/${flow.pipeline.id}`).set(bearer(admin)).expect(200)
    ).body as {
      boardId: number;
      name: string;
      visibility: string;
      ownOrdersOnly: boolean;
      roles: Record<string, number[]>;
      stages: {
        id: number;
        name: string;
        action: string;
        archivedAt: string | null;
        roles: unknown;
        printPickList: boolean;
        printDeliveryNote: boolean;
      }[];
    };
    const body = (changes: { action?: string; ownOrdersOnly?: boolean }) => ({
      boardId: pipeline.boardId,
      name: pipeline.name,
      visibility: pipeline.visibility,
      ownOrdersOnly: changes.ownOrdersOnly ?? false,
      roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
      stages: pipeline.stages
        .filter((stage) => stage.archivedAt === null)
        .map((stage) => ({
          id: stage.id,
          name: stage.name,
          action: stage.name === 'Захиалга' ? (changes.action ?? 'NONE') : stage.action,
          printPickList: stage.printPickList,
          printDeliveryNote: stage.printDeliveryNote,
          roles: { VIEW: [], EDIT: [], MOVE: [] },
        })),
    });
    const save = (changes: { action?: string; ownOrdersOnly?: boolean }) =>
      http()
        .put(`/api/v1/sales-pipelines/${flow.pipeline.id}`)
        .set(bearer(admin))
        .send(body(changes));
    expect((await save({ action: 'CONFIRM' }).expect(422)).body).toMatchObject({
      errors: [{ constraint: 'customerAppStage' }],
    });
    await save({ ownOrdersOnly: true }).expect(422);
    await save({}).expect(200);
    expect((await store.api.get('/me').expect(200)).body).toMatchObject({ ordersOpen: true });
  });

  it('sends a numbered order that reserves nothing and waits for the office', async () => {
    const key = idempotency();
    const body = storeOrderBody(today, [{ productUnitId: flow.pcs(cola), qty: '3' }], {
      note: 'Өглөө авна',
    });
    const sent = await store.api.send(body, key).expect(201);
    const order = sent.body as StoreOrderJson;
    expect(order).toMatchObject({
      status: 'DRAFT',
      state: 'PENDING',
      channel: 'CUSTOMER_APP',
      total: null,
      estimatedTotal: '3000',
      number: expect.any(String),
    });
    // A lost answer sent again: the same order, not a second one.
    const replay = await store.api.send(body, key).expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect((replay.body as StoreOrderJson).id).toBe(order.id);
    const row = await sql.query<{
      created_by: string | null;
      customer_user_id: string;
      contact_phone: string;
      stage_id: string;
    }>(
      'SELECT created_by, customer_user_id::text, contact_phone, stage_id::text FROM sales_orders WHERE id = $1',
      [order.id],
    );
    expect(row.rows[0]).toEqual({
      created_by: null,
      customer_user_id: String(store.session.account.id),
      contact_phone: store.phone,
      stage_id: String(flow.stage('Захиалга').id),
    });
    const reserved = await sql.query<{ count: string }>(
      "SELECT count(*) FROM stock_reservations WHERE doc_type = 'SO' AND doc_id = $1",
      [order.id],
    );
    expect(reserved.rows[0]?.count).toBe('0');
    // The office sees it on its board, on the app's channel.
    const onBoard = (await flow.orders.get(order.id)) as unknown as { channel: string };
    expect(onBoard.channel).toBe('CUSTOMER_APP');
  });

  it('refuses a day past 60 days, a delivery without the store’s own address and empty carts', async () => {
    const line = [{ productUnitId: flow.pcs(cola), qty: '1' }];
    const far = new Date(Date.parse(`${today}T00:00:00Z`) + 61 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await store.api.send(storeOrderBody(far, line)).expect(422);
    await store.api.send(storeOrderBody(today, line, { fulfilment: 'DELIVERY' })).expect(422);
    const otherAddress = (
      (await other.api.get('/checkout').expect(200)).body as { addresses: { id: number }[] }
    ).addresses[0]?.id;
    await store.api
      .send(storeOrderBody(today, line, { fulfilment: 'DELIVERY', addressId: otherAddress }))
      .expect(422);
    await store.api.send(storeOrderBody(today, [])).expect(422);
    await store.api
      .send({ ...storeOrderBody(today, line), customerId: other.customerId })
      .expect(422);
  });

  it('tells the store when the office confirms, with the lines that wait for stock', async () => {
    const sent = (
      await store.api
        .send(
          storeOrderBody(today, [
            { productUnitId: flow.pcs(cola), qty: '2' },
            { productUnitId: flow.pcs(water), qty: '8' },
          ]),
        )
        .expect(201)
    ).body as StoreOrderJson;
    await flow.confirm(sent.id).expect(200);
    const order = (await store.api.get(`/orders/${sent.id}`).expect(200)).body as StoreOrderJson;
    expect(order).toMatchObject({ state: 'CONFIRMED', total: '6000', estimatedTotal: null });
    expect(order.lines.find((line) => line.productId === water.id)?.qtyBackordered).toBe('3');
    const confirmed = (await notifications(store)).find(
      (row) => row.kind === 'ORDER_CONFIRMED' && row.orderId === sent.id,
    );
    expect(confirmed?.payload).toMatchObject({
      orderNumber: sent.number,
      orderTotal: '6000',
      backorderedLines: 1,
      backordered: [{ productId: water.id, name: 'Ус', qty: '3', unitName: expect.any(String) }],
    });
    // The other store hears nothing of it.
    expect((await notifications(other)).some((row) => row.orderId === sent.id)).toBe(false);
  });

  it('tells the store the cancellation’s reason and the sale’s invoice', async () => {
    const cancelled = (
      await store.api
        .send(storeOrderBody(today, [{ productUnitId: flow.pcs(cola), qty: '1' }]))
        .expect(201)
    ).body as StoreOrderJson;
    await flow.orders.cancel(cancelled.id, 'Дэлгүүр утсаар цуцлуулсан').expect(200);
    const order = (await store.api.get(`/orders/${cancelled.id}`).expect(200))
      .body as StoreOrderJson;
    expect(order).toMatchObject({ state: 'CANCELLED', cancelReason: 'Дэлгүүр утсаар цуцлуулсан' });
    expect(
      (await notifications(store)).find(
        (row) => row.kind === 'ORDER_CANCELLED' && row.orderId === cancelled.id,
      )?.payload,
    ).toMatchObject({ reason: 'Дэлгүүр утсаар цуцлуулсан' });

    const sold = (
      await store.api
        .send(storeOrderBody(today, [{ productUnitId: flow.pcs(cola), qty: '4' }]))
        .expect(201)
    ).body as StoreOrderJson;
    await flow.sell(sold.id);
    const delivered = (await store.api.get(`/orders/${sold.id}`).expect(200))
      .body as StoreOrderJson;
    expect(delivered.state).toBe('DELIVERED');
    expect(delivered.invoice).toEqual({ id: expect.any(Number), number: expect.any(String) });
    const notice = (await notifications(store)).find(
      (row) => row.kind === 'ORDER_SOLD' && row.orderId === sold.id,
    );
    expect(notice).toMatchObject({
      invoiceId: delivered.invoice?.id,
      payload: { invoiceNumber: delivered.invoice?.number, invoiceTotal: '4000' },
    });
    // Read once, by its own store only.
    await other.api.post('/notifications/read', { notificationIds: [notice?.id] }).expect(200);
    expect((await notifications(store)).find((row) => row.id === notice?.id)?.read).toBe(false);
    const unread = await store.api
      .post('/notifications/read', { notificationIds: [notice?.id] })
      .expect(200);
    expect((unread.body as { unread: number }).unread).toBeGreaterThanOrEqual(0);
    expect((await notifications(store)).find((row) => row.id === notice?.id)?.read).toBe(true);
  });

  it('lists every order of the store from every channel, never another store’s', async () => {
    const fromOffice = await flow.draft(store.customerId, [
      { productUnitId: flow.pcs(cola), qty: '1' },
    ]);
    // An office draft still without lines is not the store's yet.
    const empty = await flow.draft(store.customerId, []);
    const foreign = await flow.draft(other.customerId, [
      { productUnitId: flow.pcs(cola), qty: '1' },
    ]);
    const page = (await store.api.get('/orders').expect(200)).body as {
      data: { id: number; channel: string; state: string }[];
      summary: { count: number; pending: number };
    };
    const ids = page.data.map((row) => row.id);
    expect(ids).toContain(fromOffice.id);
    expect(ids).not.toContain(empty.id);
    expect(ids).not.toContain(foreign.id);
    expect(page.data.find((row) => row.id === fromOffice.id)?.channel).toBe('ADMIN');
    expect(page.summary.count).toBe(page.data.length);
    await store.api.get(`/orders/${foreign.id}`).expect(404);
    await store.api.get(`/orders/${empty.id}`).expect(404);
    await store.api.get(`/orders/${foreign.id}/reorder`).expect(404);
    const lastTwo = (await store.api.get('/orders?limit=2').expect(200)).body as {
      data: unknown[];
    };
    expect(lastTwo.data).toHaveLength(2);
    const range = (await store.api.get(`/orders?from=${today}&to=${today}`).expect(200)).body as {
      data: unknown[];
    };
    expect(range.data.length).toBe(page.data.length);
  });

  it('repeats an earlier order into the cart, leaving out what cannot be sold', async () => {
    const earlier = (
      await store.api
        .send(
          storeOrderBody(today, [
            { productUnitId: flow.pcs(cola), qty: '2' },
            { productUnitId: flow.pcs(water), qty: '1' },
          ]),
        )
        .expect(201)
    ).body as StoreOrderJson;
    // Water is fully reserved by now (the confirmation above backordered it): «Дууссан».
    const again = (await store.api.get(`/orders/${earlier.id}/reorder`).expect(200)).body as {
      lines: { productId: number; qty: string }[];
      skipped: { productId: number; reason: string }[];
    };
    expect(again.lines).toEqual([{ productId: cola.id, productUnitId: flow.pcs(cola), qty: '2' }]);
    expect(again.skipped).toEqual([{ productId: water.id, name: 'Ус', reason: 'OUT_OF_STOCK' }]);
  });
});
