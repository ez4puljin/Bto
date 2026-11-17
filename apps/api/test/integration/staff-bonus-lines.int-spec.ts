import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

interface QuoteJson {
  total: string;
  discountTotal: string;
  lines: {
    qty: string;
    total: string;
    discountAmount: string;
    bonus?: {
      n: string;
      m: string;
      freeQty: string;
      paidQty: string;
      freeQtyBase: string;
      freeAmount: string;
    } | null;
  }[];
}

type PickOrderJson = OrderJson & {
  lines: (OrderJson['lines'][number] & {
    discountAmount: string | null;
    freeQtyBase?: string | null;
  })[];
};

const same = (a: string | null | undefined, b: string) =>
  a !== null && a !== undefined && new Decimal(a).eq(b);

/**
 * The staff app's N+M (ADR-0217): a 17+1 product typed by its total. The quote names each line's
 * free and paid quantities, the order freezes the free base units on its line and the picking view
 * reads them back, while the money, the discount and the reserved stock stay what the engine made
 * them (ADR-0159 #3); «Бонустай бараа» lists only products an N+M marks. Synthetic data only.
 */
describe('staff app N+M split', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let rep: string;
  let milk: ProductJson;
  let soap: ProductJson;
  let shop: CustomerJson;
  const today = businessDate();
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Бонусын бараа');
    const base = await catalog.uomId('PCS');
    milk = await catalog.product({
      sku: '8901',
      name: 'Бонус сүү',
      categoryId: category,
      baseUomId: base,
    });
    soap = await catalog.product({
      sku: '8902',
      name: 'Бонус саван',
      categoryId: category,
      baseUomId: base,
    });
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Бонусын үнэ');
    for (const own of [milk, soap]) await pricing.terms(own.id, '1000', profile, null);
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('BN1');
    const bin = await inventory.bin(wh.id, 'B-01-01');
    for (const own of [milk, soap]) await inventory.setHome(own.id, wh.id);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [milk.id, soap.id] })
      .expect(200);
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        reason: 'SURPLUS',
        lines: [{ productUnitId: pcs(milk), enteredQty: '50', binId: bin.id, unitCost: '500' }],
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
    shop = await partnersApi(app, admin).customer({ name: 'Бонусын дэлгүүр' });
    await http()
      .post('/api/v1/discount-programs')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        name: '17+1',
        list: 'WHOLESALE',
        scope: 'PRODUCT',
        measure: 'QTY',
        effect: 'BONUS',
        validFrom: today,
        targetKind: 'PRODUCT',
        targetIds: [milk.id],
        steps: [{ threshold: '17', value: '1' }],
      })
      .expect(201);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('lists only the products with an N+M under «Бонустай бараа», with the search', async () => {
    const list = async (query: Record<string, unknown>) =>
      (
        (
          await http()
            .get('/api/v1/sales-rep/products')
            .query({ limit: 50, ...query })
            .set(bearer(rep))
            .expect(200)
        ).body as { data: { id: number; deal: { label: string } | null }[] }
      ).data;
    const bonus = await list({ bonus: true });
    expect(bonus.map((product) => product.id)).toEqual([milk.id]);
    expect(bonus[0]?.deal?.label).toBe('17+1');
    expect(await list({ bonus: true, q: 'саван' })).toEqual([]);
    expect((await list({ q: 'Бонус' })).map((product) => product.id).sort()).toEqual(
      [milk.id, soap.id].sort(),
    );
  });

  it.each([
    { total: '20', main: '19', free: '1' },
    { total: '34', main: '33', free: '1' },
    { total: '36', main: '34', free: '2' },
  ])(
    'splits $total pieces into $main + $free in the quote, the order and its picking',
    async ({ total, main, free }) => {
      const mainMoney = new Decimal(main).times(1000).toFixed(0);
      const freeMoney = new Decimal(free).times(1000).toFixed(0);

      // The staff cart's quote: the money of the main quantity, the split beside it.
      const quoted = (
        await http()
          .post('/api/v1/pricing/quote')
          .set(bearer(office))
          .send({ lines: [{ productUnitId: pcs(milk), qty: total }] })
          .expect(200)
      ).body as QuoteJson;
      expect(quoted).toMatchObject({ total: mainMoney, discountTotal: freeMoney });
      expect(quoted.lines[0]).toMatchObject({
        qty: total,
        total: mainMoney,
        discountAmount: freeMoney,
        bonus: {
          n: '17',
          m: '1',
          freeQty: free,
          paidQty: main,
          freeQtyBase: free,
          freeAmount: freeMoney,
        },
      });

      // The order keeps the total typed, its money and stock as the engine made them.
      const orders = salesApi(app, office);
      const draft = (
        await orders
          .create(orderBody(shop.id, [{ productUnitId: pcs(milk), qty: total }]))
          .expect(201)
      ).body as OrderJson;
      await orders.submit(draft.id).expect(200);
      const picking = (
        await http().get(`/api/v1/sales-orders/${draft.id}`).set(bearer(office)).expect(200)
      ).body as PickOrderJson;
      const [line] = picking.lines;
      expect(line).toMatchObject({ qty: total, total: mainMoney, discountAmount: freeMoney });
      expect(same(line?.qtyBase, total)).toBe(true);
      expect(same(line?.qtyApproved, total)).toBe(true);
      expect(same(line?.freeQtyBase, free)).toBe(true);
      expect(picking).toMatchObject({ total: mainMoney, discountTotal: freeMoney });
      const rows = await sql.query<{ reserved: string }>(
        `SELECT reserved::text AS reserved FROM warehouse_stock WHERE product_id = $1`,
        [milk.id],
      );
      expect(same(rows.rows[0]?.reserved, total)).toBe(true);
      await orders.cancel(draft.id, 'туршилт').expect(200);
    },
  );

  it('gives no split below one whole N+M', async () => {
    const quoted = (
      await http()
        .post('/api/v1/pricing/quote')
        .set(bearer(office))
        .send({ lines: [{ productUnitId: pcs(milk), qty: '17' }] })
        .expect(200)
    ).body as QuoteJson;
    expect(quoted.lines[0]).toMatchObject({
      total: '17000',
      bonus: { freeQty: '0', paidQty: '17', freeQtyBase: '0' },
    });
    const orders = salesApi(app, office);
    const draft = (
      await orders.create(orderBody(shop.id, [{ productUnitId: pcs(milk), qty: '17' }])).expect(201)
    ).body as OrderJson;
    const confirmed = (await orders.submit(draft.id).expect(200)).body as PickOrderJson;
    expect(confirmed.lines[0]?.freeQtyBase ?? null).toBeNull();
    expect(confirmed.lines[0]?.total).toBe('17000');
    await orders.cancel(draft.id, 'туршилт').expect(200);
  });
});
