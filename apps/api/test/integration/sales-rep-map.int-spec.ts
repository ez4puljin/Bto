import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { repApi, type RepOrderJson, repOrderBody } from '../harness/sales-rep';

interface PipelineJson {
  id: number;
  stages: { id: number; name: string }[];
}

interface MapStoreJson {
  customerId: number;
  code: string;
  name: string;
  phone: string | null;
  creditHold: boolean;
  creditHoldReason: string | null;
  addressId: number;
  address: string | null;
  lat: string;
  lng: string;
  lastOrderId: number | null;
  lastOrderAt: string | null;
  lastOrderDate: string | null;
  stale: boolean;
}

interface QuoteJson {
  total: string;
  lines: { priced: boolean; total: string | null }[];
}

interface MapJson {
  today: string;
  freshDays: number;
  data: MapStoreJson[];
}

const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: { VIEW: [], EDIT: [], MOVE: [] },
});

/**
 * The rep app's order-history filters and map: a customer, a product, the payment method, the
 * fulfilment and the state narrow both the page and the summary; the map lists the active
 * customers with a GPS point (the default address's, else the oldest active one's) with the
 * caller's own last order, whether it is stale (no order within 7 Ulaanbaatar days, today
 * included) and the customer's manual credit hold with its reason. Synthetic data.
 */
describe('sales rep order filters and map', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let repA: string;
  let repB: string;
  let cola: ProductJson;
  let water: ProductJson;
  let juice: ProductJson;
  let north: CustomerJson;
  let south: CustomerJson;
  let east: CustomerJson;
  let west: CustomerJson;
  let textOnly: CustomerJson;
  let archivedPoint: CustomerJson;
  let closed: CustomerJson;
  let southAddress: number;
  let northPoint: number;
  let eastPoint: number;
  let westPoint: number;
  let draftStage: number;
  let confirmStage: number;
  const orders: Record<string, RepOrderJson> = {};
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const today = () => businessDate();

  async function address(
    customerId: number,
    body: Record<string, unknown>,
  ): Promise<{ id: number }> {
    return (
      await http()
        .post(`/api/v1/customers/${customerId}/addresses`)
        .set(bearer(admin))
        .send(body)
        .expect(201)
    ).body as { id: number };
  }

  /** Moves an order to noon of an Ulaanbaatar day. */
  async function createdOn(orderId: number, day: string): Promise<void> {
    await sql.query(
      `UPDATE sales_orders SET created_at = ($2::date + time '12:00') AT TIME ZONE 'Asia/Ulaanbaatar'
        WHERE id = $1`,
      [orderId, day],
    );
  }

  async function map(token: string): Promise<MapJson> {
    return (await http().get('/api/v1/sales-rep/map').set(bearer(token)).expect(200))
      .body as MapJson;
  }

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    repA = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    repB = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;

    // Two priced, sale-ready products with a home and no stock: a confirmed order backorders all.
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SM1');
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Газрын зургийн бараа');
    const base = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '7971',
      name: 'Кола',
      categoryId: category,
      baseUomId: base,
    });
    water = await catalog.product({
      sku: '7972',
      name: 'Ус',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(cola.id, wh.id);
    await inventory.setHome(water.id, wh.id);
    // Juice loses its price after its draft is made: the draft cannot be estimated.
    juice = await catalog.product({
      sku: '7973',
      name: 'Жүүс',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(juice.id, wh.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Газар: Ундаа');
    await pricing.terms(cola.id, '1000', profile, null);
    await pricing.terms(water.id, '500', profile, null);
    await pricing.terms(juice.id, '700', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, water.id, juice.id] })
      .expect(200);

    const partners = partnersApi(app, admin);
    // North: the default address has no point; the oldest active one with a point wins.
    north = await partners.customer({ name: 'Байршил 1 Хойд', phone: '99112233' });
    await address(north.id, { address: 'Мөрөн, төв' });
    northPoint = (
      await address(north.id, { address: 'Мөрөн, 1-р баг', lat: '49.63421', lng: '100.16253' })
    ).id;
    await address(north.id, { address: 'Мөрөн, 2-р баг', lat: '49.64000', lng: '100.17000' });
    // South: a newer address made the default: its point wins over the older one's.
    south = await partners.customer({ name: 'Байршил 2 Өмнөд' });
    await address(south.id, { address: 'Хархорин, 1-р баг', lat: '47.19750', lng: '102.82380' });
    southAddress = (
      await address(south.id, {
        address: 'Хархорин, 2-р баг',
        lat: '47.20100',
        lng: '102.83000',
        isDefault: true,
      })
    ).id;
    // East: a point without text.
    east = await partners.customer({ name: 'Байршил 3 Зүүн' });
    eastPoint = (await address(east.id, { lat: '49.70000', lng: '100.20000' })).id;
    west = await partners.customer({ name: 'Байршил 4 Баруун' });
    westPoint = (
      await address(west.id, { address: 'Мөрөн, 4-р баг', lat: '49.62000', lng: '100.10000' })
    ).id;
    // Left off the map: no point, an archived point, an inactive customer.
    textOnly = await partners.customer({ name: 'Байршилгүй' });
    await address(textOnly.id, { address: 'Мөрөн, 5-р баг' });
    archivedPoint = await partners.customer({ name: 'Байршил архивласан' });
    await address(archivedPoint.id, { address: 'Мөрөн, 6-р баг' });
    const gone = await address(archivedPoint.id, { lat: '49.61000', lng: '100.11000' });
    await http().delete(`/api/v1/customer-addresses/${gone.id}`).set(bearer(admin)).expect(204);
    closed = await partners.customer({ name: 'Байршил хаалттай' });
    await address(closed.id, { lat: '49.60000', lng: '100.12000' });
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
          .send({ name: 'Газар' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const created = await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({
        boardId,
        name: 'Газрын борлуулалт',
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
    draftStage = stageOf('Ноорог');
    confirmStage = stageOf('Батлах');

    const rep = repApi(app, repA);
    orders.draftCola = await rep.order(
      repOrderBody(draftStage, north.id, [{ productUnitId: pcs(cola), qty: '1' }]),
    );
    orders.draftWater = await rep.order(
      repOrderBody(draftStage, south.id, [{ productUnitId: pcs(water), qty: '2' }], {
        fulfilment: 'DELIVERY',
        addressId: southAddress,
        paymentMethod: 'BANK_TRANSFER',
      }),
    );
    orders.active = await rep.order(
      repOrderBody(confirmStage, north.id, [
        { productUnitId: pcs(cola), qty: '3' },
        { productUnitId: pcs(water), qty: '4' },
      ]),
    );
    orders.sold = await rep.order(
      repOrderBody(confirmStage, south.id, [{ productUnitId: pcs(cola), qty: '5' }]),
    );
    // Nothing was reserved (no stock), so the status alone stands for the sale here.
    await sql.query(`UPDATE sales_orders SET status = 'DELIVERED' WHERE id = $1`, [orders.sold.id]);
    orders.cancelled = await rep.order(
      repOrderBody(draftStage, north.id, [{ productUnitId: pcs(cola), qty: '6' }]),
    );
    await http()
      .post(`/api/v1/sales-orders/${orders.cancelled.id}/cancel`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Тест' })
      .expect(200);
    orders.otherRep = await repApi(app, repB).order(
      repOrderBody(draftStage, north.id, [{ productUnitId: pcs(water), qty: '1' }]),
    );
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('narrows the page and the summary by customer, product, payment, fulfilment and state', async () => {
    const rep = repApi(app, repA);
    const range = { from: today(), to: today() };
    const id = (name: string) => orders[name]?.id ?? 0;
    const sum = (...names: string[]) =>
      names.reduce((total, name) => total.plus(orders[name]?.total ?? '0'), new Decimal(0));
    const expectPage = async (
      filters: Record<string, unknown>,
      names: string[],
      drafts: number,
      total: Decimal,
    ) => {
      const page = await rep.list({ ...range, ...filters });
      expect(page.data.map((row) => row.id)).toEqual(names.map(id).sort((a, b) => b - a));
      expect(page.summary).toMatchObject({ count: names.length, drafts });
      expect(new Decimal(page.summary?.total ?? 'NaN').eq(total)).toBe(true);
    };

    expect(orders.active?.status).toBe('CONFIRMED');
    expect(orders.active?.total).toEqual(expect.stringMatching(/^\d+$/));
    const everything = ['draftCola', 'draftWater', 'active', 'sold', 'cancelled'];
    await expectPage({}, everything, 2, sum('active', 'sold'));
    await expectPage(
      { customerId: north.id },
      ['draftCola', 'active', 'cancelled'],
      1,
      sum('active'),
    );
    await expectPage({ productId: water.id }, ['draftWater', 'active'], 1, sum('active'));
    await expectPage({ productId: cola.id, customerId: south.id }, ['sold'], 0, sum('sold'));
    await expectPage({ paymentMethod: 'BANK_TRANSFER' }, ['draftWater'], 1, new Decimal(0));
    await expectPage(
      { paymentMethod: 'CASH' },
      ['draftCola', 'active', 'sold', 'cancelled'],
      1,
      sum('active', 'sold'),
    );
    await expectPage({ fulfilment: 'DELIVERY' }, ['draftWater'], 1, new Decimal(0));
    await expectPage({ state: 'DRAFT' }, ['draftCola', 'draftWater'], 2, new Decimal(0));
    await expectPage({ state: 'ACTIVE' }, ['active'], 0, sum('active'));
    await expectPage({ state: 'SOLD' }, ['sold'], 0, sum('sold'));
    await expectPage({ state: 'CANCELLED' }, ['cancelled'], 0, new Decimal(0));
    await expectPage({ state: 'SOLD', customerId: north.id }, [], 0, new Decimal(0));
    // A search and a filter together; another rep's order never shows.
    await expectPage({ q: 'Хойд', productId: water.id }, ['active'], 0, sum('active'));
    expect((await repApi(app, repB).list({ ...range, customerId: north.id })).data).toEqual([
      expect.objectContaining({ id: id('otherRep') }),
    ]);

    // The cursor keeps the filters; only the first page has the summary.
    const first = await rep.list({ ...range, customerId: north.id, limit: 2 });
    expect(first.data.map((row) => row.id)).toEqual([id('cancelled'), id('active')]);
    const second = await rep.list({
      ...range,
      customerId: north.id,
      limit: 2,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ summary: null, nextCursor: null });
    expect(second.data.map((row) => row.id)).toEqual([id('draftCola')]);

    for (const bad of [
      { customerId: 0 },
      { customerId: 'x' },
      { productId: -1 },
      { paymentMethod: 'CARD' },
      { fulfilment: 'SHIP' },
      { state: 'OPEN' },
      { state: 'DELIVERED' },
    ]) {
      await http()
        .get('/api/v1/sales-rep/orders')
        .query({ ...range, ...bad })
        .set(bearer(repA))
        .expect(422);
    }
  });

  it("estimates a draft with today's quote of its lines, never a submitted order", async () => {
    const rep = repApi(app, repA);
    const quote = async (lines: { productUnitId: number; qty: string }[]) =>
      (await http().post('/api/v1/pricing/quote').set(bearer(repA)).send({ lines }).expect(200))
        .body as QuoteJson;
    const detail = async (id: number) => (await rep.get(id).expect(200)).body as RepOrderJson;
    const colaQuote = await quote([{ productUnitId: pcs(cola), qty: '1' }]);
    const waterQuote = await quote([{ productUnitId: pcs(water), qty: '2' }]);
    expect(colaQuote.total).toMatch(/^[1-9]\d*$/);
    expect(waterQuote.total).toMatch(/^[1-9]\d*$/);

    // A draft: no total (prices are frozen at the submit), the quote's as the estimate.
    expect(orders.draftCola).toMatchObject({ total: null, estimatedTotal: colaQuote.total });
    const draft = await detail(orders.draftCola?.id ?? 0);
    expect(draft).toMatchObject({ status: 'DRAFT', total: null, estimatedTotal: colaQuote.total });
    expect(draft.lines.map((line) => [line.total, line.estimatedTotal])).toEqual([
      [null, colaQuote.lines[0]?.total],
    ]);
    // A submitted order: its frozen total and no estimate, on the order and its lines.
    const active = await detail(orders.active?.id ?? 0);
    expect(active).toMatchObject({ estimatedTotal: null, total: orders.active?.total });
    expect(active.total).toMatch(/^[1-9]\d*$/);
    expect(active.lines.map((line) => line.estimatedTotal)).toEqual([null, null]);
    // A cancelled draft has none either.
    expect(await detail(orders.cancelled?.id ?? 0)).toMatchObject({ estimatedTotal: null });

    // A draft whose product lost its price: the priced line keeps its estimate, the order none.
    const mixedLines = [
      { productUnitId: pcs(cola), qty: '2' },
      { productUnitId: pcs(juice), qty: '1' },
    ];
    const mixed = await rep.order(repOrderBody(draftStage, textOnly.id, mixedLines));
    expect(mixed.estimatedTotal).toMatch(/^[1-9]\d*$/);
    await sql.query(
      `UPDATE product_prices SET valid_to = valid_from WHERE product_id = $1 AND valid_to IS NULL`,
      [juice.id],
    );
    const mixedQuote = await quote(mixedLines);
    expect(mixedQuote.lines.map((line) => line.priced)).toEqual([true, false]);
    const unpriced = await detail(mixed.id);
    expect(unpriced).toMatchObject({ total: null, estimatedTotal: null });
    expect(unpriced.lines.map((line) => line.estimatedTotal)).toEqual([
      mixedQuote.lines[0]?.total,
      null,
    ]);

    // The page: drafts with their estimates, the rest without; the summary sums the drafts'.
    const range = { from: today(), to: today() };
    const page = await rep.list(range);
    const estimateOf = new Map(page.data.map((row) => [row.id, row.estimatedTotal]));
    expect(estimateOf.get(orders.draftCola?.id ?? 0)).toBe(colaQuote.total);
    expect(estimateOf.get(orders.draftWater?.id ?? 0)).toBe(waterQuote.total);
    expect(estimateOf.get(mixed.id)).toBeNull();
    for (const name of ['active', 'sold', 'cancelled']) {
      expect(estimateOf.get(orders[name]?.id ?? 0)).toBeNull();
    }
    expect(page.data.find((row) => row.id === orders.draftCola?.id)?.total).toBeNull();
    const both = new Decimal(colaQuote.total).plus(waterQuote.total).toFixed(0);
    expect(page.summary).toMatchObject({ drafts: 3, draftsEstimate: both });
    // The filters narrow it; later pages carry the rows' estimates and no summary.
    expect((await rep.list({ ...range, customerId: north.id })).summary).toMatchObject({
      drafts: 1,
      draftsEstimate: colaQuote.total,
    });
    expect((await rep.list({ ...range, state: 'ACTIVE' })).summary).toMatchObject({
      drafts: 0,
      draftsEstimate: '0',
    });
    const first = await rep.list({ ...range, state: 'DRAFT', limit: 2 });
    expect(first.data.map((row) => row.id)).toEqual([mixed.id, orders.draftWater?.id]);
    const second = await rep.list({ ...range, state: 'DRAFT', limit: 2, cursor: first.nextCursor });
    expect(second.summary).toBeNull();
    expect(second.data.map((row) => [row.id, row.estimatedTotal])).toEqual([
      [orders.draftCola?.id, colaQuote.total],
    ]);
  });

  it('maps located active customers with the default point, else the oldest one with a point', async () => {
    const mine = await map(repA);
    expect(mine).toMatchObject({ today: today(), freshDays: 7 });
    const ours = new Set(
      [north, south, east, west, textOnly, archivedPoint, closed].map((customer) => customer.id),
    );
    const stores = mine.data.filter((store) => ours.has(store.customerId));
    // By name: the four located, active customers only.
    expect(stores.map((store) => store.customerId)).toEqual([north.id, south.id, east.id, west.id]);
    // The address whose point is shown.
    expect(stores.map((store) => store.addressId)).toEqual([
      northPoint,
      southAddress,
      eastPoint,
      westPoint,
    ]);
    expect(stores.map((store) => [store.address, store.lat, store.lng])).toEqual([
      ['Мөрөн, 1-р баг', '49.634210', '100.162530'],
      ['Хархорин, 2-р баг', '47.201000', '102.830000'],
      [null, '49.700000', '100.200000'],
      ['Мөрөн, 4-р баг', '49.620000', '100.100000'],
    ]);
    expect(stores[0]).toMatchObject({
      code: north.code,
      name: 'Байршил 1 Хойд',
      phone: '+97699112233',
    });
    await http().get('/api/v1/sales-rep/map').set(bearer(office)).expect(403);
    await http().get('/api/v1/sales-rep/map').expect(401);
  });

  it("carries the customer's manual credit hold and its reason", async () => {
    const credit = (customerId: number, hold: boolean, reason: string | null) =>
      http()
        .put(`/api/v1/customers/${customerId}/credit`)
        .set(bearer(admin))
        .send({
          creditLimit: null,
          settlementGroup: 'DAY_20',
          creditHold: hold,
          creditHoldReason: reason,
        })
        .expect(200);
    const byId = async () =>
      new Map((await map(repA)).data.map((store) => [store.customerId, store]));

    // West is put on hold with a reason; the others stay open.
    await credit(west.id, true, 'Төлбөр хоцорсон');
    const held = await byId();
    expect(held.get(west.id)).toMatchObject({
      creditHold: true,
      creditHoldReason: 'Төлбөр хоцорсон',
    });
    for (const open of [north, south, east]) {
      expect(held.get(open.id)).toMatchObject({ creditHold: false, creditHoldReason: null });
    }
    // Every rep sees the hold; the store stays on the map.
    expect((await map(repB)).data.find((store) => store.customerId === west.id)).toMatchObject({
      creditHold: true,
    });

    // Lifted: no hold, no reason.
    await credit(west.id, false, null);
    expect((await byId()).get(west.id)).toMatchObject({
      creditHold: false,
      creditHoldReason: null,
    });
  });

  it("shows the caller's own last order and marks stores without one in the last 7 days", async () => {
    // South's orders a week ago (7 days before today: stale); a draft for east 6 days ago (fresh).
    await createdOn(orders.draftWater?.id ?? 0, addDays(today(), -7));
    await createdOn(orders.sold?.id ?? 0, addDays(today(), -7));
    const eastDraft = await repApi(app, repA).order(
      repOrderBody(draftStage, east.id, [{ productUnitId: pcs(cola), qty: '1' }]),
    );
    await createdOn(eastDraft.id, addDays(today(), -6));
    // West has only another rep's order.
    const westOrder = await repApi(app, repB).order(
      repOrderBody(draftStage, west.id, [{ productUnitId: pcs(cola), qty: '1' }]),
    );

    const byId = (data: MapStoreJson[]) => new Map(data.map((store) => [store.customerId, store]));
    const mine = byId((await map(repA)).data);
    // North: the newest order not cancelled (the cancelled one is newer; another rep's too).
    expect(mine.get(north.id)).toMatchObject({
      lastOrderId: orders.active?.id,
      lastOrderDate: today(),
      stale: false,
    });
    const at = mine.get(north.id)?.lastOrderAt ?? '';
    expect(businessDate(new Date(at))).toBe(today());
    expect(mine.get(south.id)).toMatchObject({
      lastOrderId: orders.sold?.id,
      lastOrderDate: addDays(today(), -7),
      stale: true,
    });
    expect(mine.get(east.id)).toMatchObject({
      lastOrderId: eastDraft.id,
      lastOrderDate: addDays(today(), -6),
      stale: false,
    });
    expect(mine.get(west.id)).toMatchObject({
      lastOrderId: null,
      lastOrderAt: null,
      lastOrderDate: null,
      stale: true,
    });

    const theirs = byId((await map(repB)).data);
    expect(theirs.get(west.id)).toMatchObject({
      lastOrderId: westOrder.id,
      lastOrderDate: today(),
      stale: false,
    });
    expect(theirs.get(north.id)).toMatchObject({ lastOrderId: orders.otherRep?.id });
    expect(theirs.get(east.id)).toMatchObject({ lastOrderId: null, stale: true });

    // A cancelled last order leaves the store stale.
    await http()
      .post(`/api/v1/sales-orders/${westOrder.id}/cancel`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Тест' })
      .expect(200);
    expect(byId((await map(repB)).data).get(west.id)).toMatchObject({
      lastOrderId: null,
      stale: true,
    });
  });
});
