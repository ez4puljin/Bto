import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { repApi } from '../harness/sales-rep';

/**
 * The rep app's shop and customer picker (ADR-0061 #5, #7): only active, sale-ready products with
 * each unit's wholesale price as pricing gives it and the home warehouse's free stock; only active
 * customers, with what an order needs. Synthetic data.
 */
describe('sales rep shop', () => {
  let app: NestExpressApplication;
  let admin: string;
  let rep: string;
  let cola: ProductJson;
  let water: ProductJson;
  let waiting: ProductJson;
  let shop: CustomerJson;
  let closed: CustomerJson;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    rep = (await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('SS1');
    const shelf = (await inventory.bin(wh.id, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Дэлгүүрийн бараа');
    const base = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '7961',
      name: 'Кола шил',
      categoryId: category,
      baseUomId: base,
      units: [{ uomId: box, factorToBase: '12' }],
    });
    water = await catalog.product({
      sku: '7962',
      name: 'Ус шил',
      categoryId: category,
      baseUomId: base,
    });
    waiting = await catalog.product({
      sku: '7963',
      name: 'Үнэгүй шил',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(cola.id, wh.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Дэлгүүр: Ундаа');
    await pricing.terms(cola.id, '1000', profile, box);
    await pricing.terms(water.id, '500', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, water.id] })
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
    shop = await partners.customer({ name: 'Шилэн дэлгүүр', phone: '99112233' });
    for (const [address, isDefault] of [
      ['Мөрөн, 1-р баг', false],
      ['Мөрөн, 2-р баг', true],
    ] as const) {
      await http()
        .post(`/api/v1/customers/${shop.id}/addresses`)
        .set(bearer(admin))
        .send({ address, isDefault })
        .expect(201);
    }
    closed = await partners.customer({ name: 'Шилэн хаалттай' });
    await http()
      .patch(`/api/v1/customers/${closed.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await app.close();
  });

  it('lists active, sale-ready products with prices as pricing gives them and free stock', async () => {
    const products = await repApi(app, rep).products({ q: 'шил' });
    expect(products.map((product) => product.sku).sort()).toEqual(['7961', '7962']);
    const own = products.find((product) => product.id === cola.id);
    const table = (
      (
        await http()
          .get('/api/v1/product-prices')
          .query({ productId: cola.id })
          .set(bearer(admin))
          .expect(200)
      ).body as { table: { productUnitId: number; wholesale: string; wholesaleBasis: string }[] }
    ).table;
    expect(own?.units.map((unit) => [unit.id, unit.wholesale, unit.basis])).toEqual(
      table.map((row) => [row.productUnitId, row.wholesale, row.wholesaleBasis]),
    );
    expect(own).toMatchObject({ sellable: true, available: '30' });
    // Water has a price but no home warehouse: listed, but an order would refuse it.
    expect(products.find((product) => product.id === water.id)).toMatchObject({
      sellable: false,
      available: '0',
    });
  });

  it('reads products by id, leaving out those the shop would not list', async () => {
    const response = await http()
      .get('/api/v1/sales-rep/products/batch')
      .query({ productIds: `${cola.id},${waiting.id}` })
      .set(bearer(rep))
      .expect(200);
    expect((response.body as { id: number }[]).map((product) => product.id)).toEqual([cola.id]);
    const tooMany = Array.from({ length: 201 }, (_, index) => index + 1).join(',');
    await http()
      .get('/api/v1/sales-rep/products/batch')
      .query({ productIds: tooMany })
      .set(bearer(rep))
      .expect(422);
  });

  it('finds active customers and gives an order what it needs: addresses, default first', async () => {
    const page = (
      await http()
        .get('/api/v1/sales-rep/customers')
        .query({ q: 'Шилэн' })
        .set(bearer(rep))
        .expect(200)
    ).body as { data: { id: number; name: string; address: string | null }[] };
    expect(page.data.map((customer) => customer.id)).toEqual([shop.id]);
    expect(page.data[0]?.address).toBe('Мөрөн, 2-р баг');
    const detail = (
      await http().get(`/api/v1/sales-rep/customers/${shop.id}`).set(bearer(rep)).expect(200)
    ).body as { addresses: { address: string; isDefault: boolean }[]; phone: string | null };
    expect(detail.addresses.map((address) => [address.address, address.isDefault])).toEqual([
      ['Мөрөн, 2-р баг', true],
      ['Мөрөн, 1-р баг', false],
    ]);
    expect(detail).not.toHaveProperty('creditLimit');
    await http().get(`/api/v1/sales-rep/customers/${closed.id}`).set(bearer(rep)).expect(404);
  });

  it('is the rep app only', async () => {
    await http().get('/api/v1/sales-rep/products').set(bearer(admin)).expect(200);
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    await http().get('/api/v1/sales-rep/products').set(bearer(office)).expect(403);
    await http().get('/api/v1/sales-rep/customers').set(bearer(office)).expect(403);
  });

  it('follows the assortment segment and carries the office’s name and colour (ADR-0127)', async () => {
    const save = (body: Record<string, unknown>, token = admin) =>
      http()
        .put('/api/v1/app-settings')
        .set(bearer(token))
        .send({
          assortmentSegmentId: null,
          homeSections: { PROMOTIONS: true, DISCOUNTS: true, NEW: true },
          minOrderAmount: null,
          appName: null,
          appColor: null,
          ...body,
        });
    const ids = async () =>
      (
        (await http().get('/api/v1/sales-rep/products').set(bearer(rep)).expect(200)).body as {
          data: { id: number }[];
        }
      ).data.map((product) => product.id);
    expect((await ids()).sort()).toEqual([cola.id, water.id].sort());
    const onlyWater = (
      await http()
        .post('/api/v1/segments/lists')
        .set(bearer(admin))
        .set(idempotency())
        .send({ name: 'Зөвхөн ус', productIds: [water.id] })
        .expect(201)
    ).body as { id: number };
    await save({
      assortmentSegmentId: onlyWater.id,
      appName: 'Bto ХТ',
      appColor: '#FF3B30',
    }).expect(200);
    expect(await ids()).toEqual([water.id]);
    const batch = await http()
      .get('/api/v1/sales-rep/products/batch')
      .query({ productIds: `${cola.id},${water.id}` })
      .set(bearer(rep))
      .expect(200);
    expect((batch.body as { id: number }[]).map((product) => product.id)).toEqual([water.id]);
    const suppliers = (await http().get('/api/v1/sales-rep/suppliers').set(bearer(rep)).expect(200))
      .body as { productCount: number }[];
    expect(suppliers.every((row) => row.productCount <= 1)).toBe(true);
    expect(
      (await http().get('/api/v1/sales-rep/context').set(bearer(rep)).expect(200)).body,
    ).toMatchObject({ appName: 'Bto ХТ', appColor: '#FF3B30' });
    await save({}).expect(200);
    expect((await ids()).sort()).toEqual([cola.id, water.id].sort());
  });
});
