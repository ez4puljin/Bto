import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';

interface PageJson {
  data: { id: number; saleReadyAt: string | null }[];
}

/** Registered products wait for their prices until the price clerk completes them (ADR-0044). */
describe('sale readiness', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let clerk: string;
  let worker: string;
  let drinks: number;
  let pcs: number;
  const today = businessDate();
  const http = () => request(app.getHttpServer());

  const product = (name: string) =>
    catalogApi(app, admin).product({ name, categoryId: drinks, baseUomId: pcs });
  const price = (item: ProductJson, list: 'WHOLESALE' | 'RETAIL', value: string) => ({
    list,
    productUnitId: unitOf(item, 'PCS').id,
    price: value,
  });
  const setPrices = (
    token: string,
    item: ProductJson,
    entries: ReturnType<typeof price>[],
    validFrom = today,
  ) =>
    http()
      .post('/api/v1/unit-prices')
      .set(bearer(token))
      .set(idempotency())
      .send({ productId: item.id, validFrom, entries });
  const complete = (token: string, productIds: number[], key = idempotency()) =>
    http().post('/api/v1/pricing/sale-ready').set(bearer(token)).set(key).send({ productIds });
  const listed = async (saleReady: boolean) =>
    (
      (
        await http()
          .get('/api/v1/products')
          .query({ saleReady: String(saleReady), categoryId: drinks, limit: 100 })
          .set(bearer(worker))
          .expect(200)
      ).body as PageJson
    ).data.map((row) => row.id);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    clerk = await customRoleUser(app, admin, ['pricing.prices.manage']);
    const catalog = catalogApi(app, admin);
    drinks = await catalog.category('Ундаа');
    pcs = await catalog.uomId('PCS');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('creates products waiting for their prices and lists them apart', async () => {
    const water = await product('Шинэ ус');
    expect(water).toMatchObject({ status: 'ACTIVE', saleReadyAt: null });
    expect(await listed(false)).toContain(water.id);
    expect(await listed(true)).not.toContain(water.id);
  });

  it('completes with a wholesale and a supermarket price in force today, all or none', async () => {
    const juice = await product('Жүүс');
    const tea = await product('Цай');
    const refusal = async (ids: number[]) =>
      (await complete(clerk, ids).expect(422)).body as {
        code: string;
        params: { count: number };
        errors: { path: string; message: string }[];
      };

    expect(await refusal([juice.id])).toMatchObject({
      code: 'PRICE_MISSING',
      params: { count: 1 },
      errors: [{ path: 'productIds.0', message: juice.sku }],
    });
    await setPrices(clerk, juice, [price(juice, 'WHOLESALE', '1000')]).expect(200);
    expect((await refusal([juice.id])).code).toBe('PRICE_MISSING');
    // A supermarket price from tomorrow is not in force today.
    await setPrices(clerk, juice, [price(juice, 'RETAIL', '1200')], addDays(today, 1)).expect(200);
    expect((await refusal([juice.id])).code).toBe('PRICE_MISSING');
    await setPrices(clerk, juice, [price(juice, 'RETAIL', '1200')]).expect(200);
    // Tea has no prices: the whole batch is refused and juice keeps waiting.
    expect((await refusal([juice.id, tea.id])).errors).toEqual([
      expect.objectContaining({ path: 'productIds.1', message: tea.sku }),
    ]);
    expect((await catalogApi(app, admin).get(juice.id)).saleReadyAt).toBeNull();

    const key = idempotency();
    const done = await complete(clerk, [juice.id], key).expect(200);
    expect(done.body).toEqual({ completed: [juice.id], alreadyComplete: [] });
    const replayed = await complete(clerk, [juice.id], key).expect(200);
    expect(replayed.headers['idempotent-replayed']).toBe('true');
    expect((await complete(clerk, [juice.id]).expect(200)).body).toEqual({
      completed: [],
      alreadyComplete: [juice.id],
    });
    expect((await catalogApi(app, admin).get(juice.id)).saleReadyAt).toEqual(expect.any(String));
    expect(await listed(true)).toContain(juice.id);

    const { rows } = await sql.query<{ after: Record<string, unknown> }>(
      `SELECT after FROM audit_log WHERE entity = 'products' AND action = 'COMPLETE' AND entity_id = $1`,
      [String(juice.id)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toMatchObject({
      prices: { WHOLESALE: '1000', RETAIL: '1200' },
      date: today,
    });
  });

  it('refuses inactive products and leaves discount programs to the admin', async () => {
    const old = await product('Хуучин бараа');
    await http()
      .patch(`/api/v1/products/${old.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect((await complete(clerk, [old.id]).expect(409)).body).toMatchObject({
      code: 'PRODUCT_INACTIVE',
      errors: [{ message: old.sku }],
    });
    await complete(clerk, [999_999]).expect(404);
    await complete(worker, [old.id]).expect(403);
    await setPrices(worker, old, [price(old, 'WHOLESALE', '500')]).expect(403);
    await http()
      .post('/api/v1/discount-programs')
      .set(bearer(clerk))
      .set(idempotency())
      .send({})
      .expect(403);
  });
});
