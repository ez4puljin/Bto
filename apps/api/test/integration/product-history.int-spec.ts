import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createHttpApp } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

interface PageJson {
  data: {
    action: string;
    entity: string;
    actorName: string | null;
    before: { name?: string; code?: string } | null;
    after: { name?: string; code?: string } | null;
  }[];
  nextCursor: string | null;
}

/** Who changed what on a product (owner 2026-11-06). */
describe('product history', () => {
  let app: NestExpressApplication;
  let admin: string;
  let worker: string;
  let productId: number;
  let otherId: number;
  const http = () => request(app.getHttpServer());
  const history = async (id = productId) =>
    (await http().get(`/api/v1/products/${id}/history`).set(bearer(admin)).expect(200))
      .body as PageJson;

  beforeAll(async () => {
    app = await createHttpApp();
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const catalog = catalogApi(app, admin);
    const pcs = await catalog.uomId('PCS');
    const categoryId = await catalog.category('Түүхийн ангилал');
    const product = await catalog.product({
      sku: '770001',
      name: 'Хуучин нэр',
      categoryId,
      baseUomId: pcs,
    });
    productId = product.id;
    const other = await catalog.product({
      sku: '770002',
      name: 'Өөр бараа',
      categoryId,
      baseUomId: pcs,
    });
    otherId = other.id;
    const unit = product.units[0];
    if (!unit) throw new Error('no unit');
    await http()
      .patch(`/api/v1/products/${productId}`)
      .set(bearer(admin))
      .send({ name: 'Шинэ нэр' })
      .expect(200);
    await http()
      .post(`/api/v1/product-units/${unit.id}/barcodes`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ code: '4870000000017' })
      .expect(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it("lists the product's own changes and its barcodes, newest first, with who", async () => {
    const page = await history();
    const barcode = page.data.find((row) => row.entity === 'product_barcodes');
    expect(barcode).toMatchObject({ action: 'CREATE', after: { code: '4870000000017' } });
    const renamed = page.data.find((row) => row.entity === 'products' && row.action === 'UPDATE');
    expect(renamed?.before?.name).toBe('Хуучин нэр');
    expect(renamed?.after?.name).toBe('Шинэ нэр');
    expect(renamed?.actorName).toEqual(expect.any(String));
    expect(page.data[0]?.entity).toBe('product_barcodes');
  });

  it('holds its prices, locations and suppliers too, and only its own', async () => {
    const pricing = pricingApi(app, admin);
    await pricing.terms(productId, '1200', await pricing.profile('Түүхийн профайл'), null);
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('WHIST');
    await inventory.setHome(productId, warehouse.id);
    const supplier = await partnersApi(app, admin).supplier({
      name: 'Түүх ХХК',
      phone: '99112233',
    });
    await http()
      .post('/api/v1/product-suppliers')
      .set(bearer(admin))
      .send({ productId, supplierId: supplier.id })
      .expect(201);
    const entities = (await history()).data.map((row) => row.entity);
    expect(entities).toEqual(
      expect.arrayContaining(['product_prices', 'product_locations', 'product_suppliers']),
    );
    const other = (await history(otherId)).data.map((row) => row.entity);
    expect(other).not.toContain('product_prices');
    expect(other).not.toContain('product_locations');
    expect(other).not.toContain('product_suppliers');
  });

  it("keeps out another product's rows and those who may not edit", async () => {
    const other = await history(otherId);
    expect(other.data.some((row) => row.entity === 'product_barcodes')).toBe(false);
    expect(other.data.every((row) => row.after?.name !== 'Шинэ нэр')).toBe(true);
    await http().get(`/api/v1/products/${productId}/history`).set(bearer(worker)).expect(403);
    await http().get('/api/v1/products/99999999/history').set(bearer(admin)).expect(404);
  });
});
