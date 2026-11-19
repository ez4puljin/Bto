import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { repApi, type RepProductJson, repOrderBody } from '../harness/sales-rep';

interface OfflineProductJson extends RepProductJson {
  mainSupplierId: number | null;
}
interface OfflineCustomerJson {
  id: number;
  code: string;
  name: string;
  phone: string | null;
  address: string | null;
  creditHold: boolean;
  addresses: { id: number; label: string | null; address: string | null; isDefault: boolean }[];
  contacts: { name: string | null; phone: string | null }[];
  overdue: { amount: string; oldestDueDate: string | null } | null;
}
interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
interface KnownJson {
  key: string;
  status: 'COMPLETED' | 'IN_PROGRESS';
  createdAt: string;
  orderId: number | null;
}

/**
 * The rep's order without the server (ADR-0225): the walks a phone keeps on its disk (every product
 * the shop shows the rep, every active customer with addresses) and the question which of its
 * Idempotency-Keys the server holds after an outage. Synthetic data.
 */
describe('sales rep offline', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let repA: string;
  let repB: string;
  let repAId: number;
  let cola: ProductJson;
  let water: ProductJson;
  let juice: ProductJson;
  let waiting: ProductJson;
  let supplierId: number;
  let shop: CustomerJson;
  let held: CustomerJson;
  let closed: CustomerJson;
  let stageId: number;
  const http = () => request(app.getHttpServer());

  /** Every page of a walk, `limit` rows at a time. */
  async function walk<T>(
    token: string,
    path: string,
    limit: number,
  ): Promise<{ rows: T[]; pages: number }> {
    const rows: T[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page: Page<T> = (
        await http()
          .get(`/api/v1/sales-rep/offline/${path}`)
          .query({ limit, ...(cursor ? { cursor } : {}) })
          .set(bearer(token))
          .expect(200)
      ).body as Page<T>;
      rows.push(...page.data);
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10_000);
    return { rows, pages };
  }

  /** Every product `/sales-rep/products` shows, by every page of its default order. */
  async function listed(token: string): Promise<RepProductJson[]> {
    const rows: RepProductJson[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<RepProductJson> = (
        await http()
          .get('/api/v1/sales-rep/products')
          .query({ limit: 200, ...(cursor ? { cursor } : {}) })
          .set(bearer(token))
          .expect(200)
      ).body as Page<RepProductJson>;
      rows.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== null);
    return rows;
  }

  const known = (token: string, keys: unknown) =>
    http().post('/api/v1/sales-rep/orders/known').set(bearer(token)).send({ keys });

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const a = await seedUser(app, { roles: ['SALES_REP'] });
    repAId = a.id;
    repA = (await login(app, a)).accessToken;
    repB = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;

    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SO1');
    const shelf = (await inventory.bin(wh.id, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Офлайн бараа');
    const base = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    const make = (sku: string, name: string, units: Record<string, unknown>[] = []) =>
      catalog.product({ sku, name, categoryId: category, baseUomId: base, units });
    cola = await make('7981', 'Офлайн кола', [{ uomId: box, factorToBase: '12' }]);
    water = await make('7982', 'Офлайн ус');
    juice = await make('7983', 'Офлайн жүүс');
    waiting = await make('7984', 'Офлайн үнэгүй');
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Офлайн үнэ');
    for (const product of [cola, water, juice, waiting]) {
      await inventory.setHome(product.id, wh.id);
    }
    await pricing.terms(cola.id, '1000', profile, box);
    await pricing.terms(water.id, '500', profile, null);
    await pricing.terms(juice.id, '700', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, water.id, juice.id] })
      .expect(200);
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        reason: 'SURPLUS',
        lines: [
          {
            productUnitId: unitOf(cola, 'PCS').id,
            enteredQty: '30',
            binId: shelf,
            unitCost: '700',
          },
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

    const partners = partnersApi(app, admin);
    supplierId = (await partners.supplier({ name: 'Офлайн нийлүүлэгч', phone: '99114455' })).id;
    await http()
      .post('/api/v1/product-suppliers')
      .set(bearer(admin))
      .send({ productId: cola.id, supplierId })
      .expect(201);

    // Rep A's staff app shows only cola and water (ADR-0164); rep B sees the whole shop.
    const segment = (
      (
        await http()
          .post('/api/v1/segments/lists')
          .set(bearer(admin))
          .set(idempotency())
          .send({ name: 'Офлайн: кола, ус', productIds: [cola.id, water.id] })
          .expect(201)
      ).body as { id: number }
    ).id;
    await http()
      .post('/api/v1/app-settings/staff-assortments')
      .set(bearer(admin))
      .set(idempotency())
      .send({ title: 'Офлайн', segmentIds: [segment], userIds: [repAId] })
      .expect(201);

    shop = await partners.customer({ name: 'Офлайн дэлгүүр', phone: '99115566' });
    for (const [address, isDefault] of [
      ['Мөрөн, 7-р баг', false],
      ['Мөрөн, 8-р баг', true],
    ] as const) {
      await http()
        .post(`/api/v1/customers/${shop.id}/addresses`)
        .set(bearer(admin))
        .send({ address, isDefault })
        .expect(201);
    }
    await http()
      .post(`/api/v1/customers/${shop.id}/contacts`)
      .set(bearer(admin))
      .send({ name: 'Бат', phone: '99117788' })
      .expect(201);
    held = await partners.customer({ name: 'Офлайн зогсоосон' });
    await http()
      .put(`/api/v1/customers/${held.id}/credit`)
      .set(bearer(admin))
      .send({
        creditLimit: null,
        settlementGroup: 'DAY_20',
        creditHold: true,
        creditHoldReason: 'Төлбөр хоцорсон',
      })
      .expect(200);
    closed = await partners.customer({ name: 'Офлайн хаалттай' });
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
          .send({ name: 'Офлайн самбар' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const pipeline = await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({
        boardId,
        name: 'Офлайн борлуулалт',
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
        stages: [
          {
            name: 'ХТ Захиалга',
            action: 'NONE',
            printPickList: false,
            printDeliveryNote: false,
            roles: { VIEW: [], EDIT: [], MOVE: [] },
          },
        ],
      })
      .expect(201);
    const pipelineId =
      (pipeline.body as { id?: number; pipeline?: { id: number } }).pipeline?.id ??
      (pipeline.body as { id: number }).id;
    const detail = (
      await http().get(`/api/v1/sales-pipelines/${pipelineId}`).set(bearer(admin)).expect(200)
    ).body as { stages: { id: number }[] };
    stageId = detail.stages[0]?.id ?? 0;
  });

  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('walks every product the shop shows the rep, by id, in the list’s own rows', async () => {
    const { rows, pages } = await walk<OfflineProductJson>(repA, 'products', 1);
    const shown = await listed(repA);
    const ids = rows.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(shown.map((row) => row.id).sort((a, b) => a - b));
    // Outside the rep's segment, or not sale-ready: absent.
    expect(ids).toEqual(expect.arrayContaining([cola.id, water.id]));
    expect(ids).not.toContain(juice.id);
    expect(ids).not.toContain(waiting.id);
    expect(pages).toBe(ids.length);

    // The same row the shop's list sends, and the main supplier for the filter.
    const offlineCola = rows.find((row) => row.id === cola.id);
    const listedCola = shown.find((row) => row.id === cola.id);
    expect(offlineCola).toEqual({ ...listedCola, mainSupplierId: supplierId });
    expect(offlineCola).toMatchObject({ available: '30', sellable: true, stockBlocked: false });
    expect(rows.find((row) => row.id === water.id)?.mainSupplierId).toBeNull();

    // Rep B has no setting: the whole shop, juice included, and still what the list shows.
    const other = (await walk<OfflineProductJson>(repB, 'products', 500)).rows.map((row) => row.id);
    expect(other).toContain(juice.id);
    expect(other).toEqual((await listed(repB)).map((row) => row.id).sort((a, b) => a - b));
  });

  it('walks every active customer with addresses, contacts and the hold', async () => {
    const { rows } = await walk<OfflineCustomerJson>(repA, 'customers', 2);
    const ids = rows.map((row) => row.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(closed.id);
    const own = rows.find((row) => row.id === shop.id);
    expect(own).toMatchObject({
      name: 'Офлайн дэлгүүр',
      address: 'Мөрөн, 8-р баг',
      creditHold: false,
      contacts: [{ name: 'Бат', phone: '+97699117788' }],
      overdue: null,
    });
    expect(own?.addresses.map((address) => [address.address, address.isDefault])).toEqual([
      ['Мөрөн, 8-р баг', true],
      ['Мөрөн, 7-р баг', false],
    ]);
    // The same addresses the detail route gives, ids included (the checkout's addressId).
    const detail = (
      await http().get(`/api/v1/sales-rep/customers/${shop.id}`).set(bearer(repA)).expect(200)
    ).body as { addresses: unknown[]; contacts: unknown[] };
    expect(own?.addresses).toEqual(detail.addresses);
    expect(own?.contacts).toEqual(detail.contacts);
    expect(rows.find((row) => row.id === held.id)?.creditHold).toBe(true);
    expect(own).not.toHaveProperty('creditLimit');
  });

  it('refuses a page too large, a cursor not its own, and the office', async () => {
    const get = (path: string, query: Record<string, unknown>, token = repA) =>
      http().get(`/api/v1/sales-rep/offline/${path}`).query(query).set(bearer(token));
    await get('products', { limit: 501 }).expect(422);
    await get('customers', { limit: 1001 }).expect(422);
    await get('products', { cursor: 'not-a-cursor' }).expect(422);
    await get('customers', { cursor: Buffer.from('{"id":"x"}').toString('base64url') }).expect(422);
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    await get('products', {}, office).expect(403);
    await get('customers', {}, office).expect(403);
    await known(office, [randomUUID()]).expect(403);
  });

  it('tells the caller which of its keys the server holds, with the order a key created', async () => {
    const sent = randomUUID();
    const order = await repApi(app, repA)
      .create(
        repOrderBody(stageId, shop.id, [{ productUnitId: unitOf(cola, 'PCS').id, qty: '2' }]),
        { 'Idempotency-Key': sent },
      )
      .expect(201);
    const lost = randomUUID();
    const answer = (await known(repA, [sent.toUpperCase(), lost]).expect(200)).body as {
      data: KnownJson[];
    };
    expect(answer.data).toEqual([
      {
        key: sent.toUpperCase(),
        status: 'COMPLETED',
        createdAt: expect.any(String) as string,
        orderId: (order.body as { id: number }).id,
      },
    ]);
    // Another user's key is never answered, even with the same key.
    expect((await known(repB, [sent]).expect(200)).body).toEqual({ data: [] });
  });

  it('forgets a refused order’s key, and shows a key still running', async () => {
    const refused = randomUUID();
    const response = await repApi(app, repA).create(
      repOrderBody(stageId, closed.id, [{ productUnitId: unitOf(cola, 'PCS').id, qty: '1' }]),
      { 'Idempotency-Key': refused },
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect((await known(repA, [refused]).expect(200)).body).toEqual({ data: [] });

    // A claim whose request died before it was stored (the interceptor's own insert).
    const stuck = randomUUID();
    await sql.query(
      `INSERT INTO idempotency_keys (actor_kind, actor_id, key, method, path, request_hash, status, created_at)
       VALUES ('STAFF', $1, $2, 'POST', '/api/v1/sales-rep/orders', 'x', 'IN_PROGRESS', now() - interval '2 hours')`,
      [repAId, stuck],
    );
    const answer = (await known(repA, [stuck]).expect(200)).body as { data: KnownJson[] };
    expect(answer.data).toHaveLength(1);
    expect(answer.data[0]).toMatchObject({ key: stuck, status: 'IN_PROGRESS', orderId: null });
    expect(Date.now() - Date.parse(answer.data[0]?.createdAt ?? '')).toBeGreaterThan(3_600_000);
  });

  it('answers no order for a key another route completed', async () => {
    const key = randomUUID();
    await http()
      .post('/api/v1/segments/lists')
      .set(bearer(admin))
      .set({ 'Idempotency-Key': key })
      .send({ name: 'Офлайн: түлхүүр', productIds: [water.id] })
      .expect(201);
    const answer = (await known(admin, [key]).expect(200)).body as { data: KnownJson[] };
    expect(answer.data).toEqual([
      { key, status: 'COMPLETED', createdAt: expect.any(String) as string, orderId: null },
    ]);
  });

  it('refuses keys that are not UUIDs, none, or more than 200', async () => {
    await known(repA, ['not-a-uuid']).expect(422);
    await known(repA, []).expect(422);
    await known(repA, 'x').expect(422);
    await known(
      repA,
      Array.from({ length: 201 }, () => randomUUID()),
    ).expect(422);
    expect(
      (
        await known(
          repA,
          Array.from({ length: 200 }, () => randomUUID()),
        ).expect(200)
      ).body,
    ).toEqual({ data: [] });
  });
});
