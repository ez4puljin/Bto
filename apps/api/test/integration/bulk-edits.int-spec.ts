import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

interface BulkJson {
  changed: number[];
  unchanged: number[];
}

/**
 * Bulk changes of ticked products (ADR-0051): each owner module changes its own field for many
 * products in one request: catalog the status and category, partners the main supplier, pricing
 * the price profile from a day on, inventory the home warehouse (with a dry run first).
 */
describe('bulk product edits', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let drinks: number;
  let food: number;
  let cola: ProductJson;
  let still: ProductJson;
  let rice: ProductJson;
  let msm: number;
  let apu: number;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  const http = () => request(app.getHttpServer());
  const bulk = (path: string, body: Record<string, unknown>, token = admin, status = 200) =>
    http().post(`/api/v1/${path}`).set(bearer(token)).set(idempotency()).send(body).expect(status);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    const catalog = catalogApi(app, admin);
    drinks = await catalog.category('Ундаа');
    food = await catalog.category('Хүнс');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '601',
      name: 'Кока кола',
      categoryId: drinks,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24' }],
    });
    still = await catalog.product({ sku: '602', name: 'Ус', categoryId: drinks, baseUomId: pcs });
    rice = await catalog.product({ sku: '603', name: 'Будаа', categoryId: food, baseUomId: pcs });
    const partners = partnersApi(app, admin);
    msm = (await partners.supplier({ name: 'МСМ ХХК' })).id;
    apu = (await partners.supplier({ name: 'АПУ ХК' })).id;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('BK1');
    wh2 = await inventory.warehouse('BK2');
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('sets the status and the category of ticked products in one change', async () => {
    await http()
      .patch(`/api/v1/products/${still.id}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    const off = (
      await bulk('products/bulk/status', {
        productIds: [still.id, cola.id],
        status: 'INACTIVE',
      })
    ).body as BulkJson;
    expect(off).toEqual({ changed: [cola.id], unchanged: [still.id] });
    const on = (
      await bulk('products/bulk/status', {
        productIds: [cola.id, still.id],
        status: 'ACTIVE',
      })
    ).body as BulkJson;
    expect(on.changed).toEqual([cola.id, still.id]);
    // Reactivated, a product waiting for its prices keeps waiting (ADR-0044).
    expect(await catalogApi(app, admin).get(cola.id)).toMatchObject({
      status: 'ACTIVE',
      saleReadyAt: null,
    });

    const moved = (
      await bulk('products/bulk/category', {
        productIds: [cola.id, rice.id],
        categoryId: food,
      })
    ).body as BulkJson;
    expect(moved).toEqual({ changed: [cola.id], unchanged: [rice.id] });
    expect(await catalogApi(app, admin).get(cola.id)).toMatchObject({
      categoryId: food,
      sku: '601',
    });
    const audit = await sql.query<{ action: string; after: unknown }>(
      `SELECT action, after FROM audit_log WHERE entity = 'products' AND entity_id = $1 ORDER BY id`,
      [String(cola.id)],
    );
    expect(audit.rows.slice(-3).map((row) => row.after)).toEqual([
      { status: 'INACTIVE' },
      { status: 'ACTIVE' },
      { categoryId: food },
    ]);

    // An unknown product refuses the whole change; a worker may not.
    await bulk(
      'products/bulk/status',
      { productIds: [cola.id, 999_999], status: 'INACTIVE' },
      admin,
      404,
    );
    expect(await catalogApi(app, admin).get(cola.id)).toMatchObject({ status: 'ACTIVE' });
    await bulk(
      'products/bulk/category',
      { productIds: [cola.id], categoryId: drinks },
      worker,
      403,
    );
    await bulk('products/bulk/status', { productIds: [], status: 'ACTIVE' }, admin, 422);
  });

  it('makes a supplier the main one, keeping the old main as an additional supplier', async () => {
    for (const [productId, supplierId] of [
      [cola.id, msm],
      [cola.id, apu],
      [still.id, apu],
    ] as const) {
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    }
    const result = (
      await bulk('product-suppliers/bulk/main', {
        productIds: [cola.id, still.id, rice.id],
        supplierId: apu,
      })
    ).body as BulkJson;
    expect(result).toEqual({ changed: [cola.id, rice.id], unchanged: [still.id] });
    const links = await sql.query<{ product_id: string; supplier_id: string; is_main: boolean }>(
      `SELECT product_id::text, supplier_id::text, is_main FROM product_suppliers
        WHERE product_id = ANY($1::bigint[]) ORDER BY product_id, supplier_id`,
      [[cola.id, still.id, rice.id]],
    );
    // Ordered by product, then supplier: МСМ was created before АПУ.
    expect(links.rows).toEqual([
      { product_id: String(cola.id), supplier_id: String(msm), is_main: false },
      { product_id: String(cola.id), supplier_id: String(apu), is_main: true },
      { product_id: String(still.id), supplier_id: String(apu), is_main: true },
      { product_id: String(rice.id), supplier_id: String(apu), is_main: true },
    ]);
    await http()
      .patch(`/api/v1/suppliers/${msm}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    const refused = await bulk(
      'product-suppliers/bulk/main',
      { productIds: [cola.id], supplierId: msm },
      admin,
      409,
    );
    expect((refused.body as { code: string }).code).toBe('SUPPLIER_INACTIVE');
  });

  it('changes the price profile from a day on, keeping prices and planned rows', async () => {
    const pricing = pricingApi(app, admin);
    const first = await pricing.profile('Ундаа');
    const second = await pricing.profile('Хүнс');
    const box = unitOf(cola, 'BOX').uomId;
    const today = businessDate();
    const tomorrow = addDays(today, 1);
    const nextWeek = addDays(today, 7);
    await pricing.terms(cola.id, '1000', first, box);
    await pricing.terms(cola.id, '1200', first, box, nextWeek);
    await pricing.terms(still.id, '500', second, null);
    const result = (
      await bulk('product-prices/bulk/profile', {
        productIds: [cola.id, still.id, rice.id],
        profileId: second,
        validFrom: tomorrow,
      })
    ).body as BulkJson & { skipped: unknown[] };
    expect(result).toEqual({
      changed: [cola.id],
      unchanged: [still.id],
      skipped: [{ productId: rice.id, reason: 'NO_TERMS' }],
    });
    const view = (
      await http()
        .get('/api/v1/product-prices')
        .query({ productId: cola.id })
        .set(bearer(admin))
        .expect(200)
    ).body as {
      current: { profileId: number; warehousePrice: string; validTo: string | null };
      scheduled: { profileId: number; warehousePrice: string; validFrom: string }[];
    };
    // Today keeps the old profile until tomorrow; tomorrow and next week's price take the new one.
    expect(view.current).toMatchObject({
      profileId: first,
      warehousePrice: '1000',
      validTo: tomorrow,
    });
    expect(view.scheduled).toEqual([
      expect.objectContaining({ profileId: second, warehousePrice: '1000', validFrom: tomorrow }),
      expect.objectContaining({ profileId: second, warehousePrice: '1200', validFrom: nextWeek }),
    ]);
    await bulk(
      'product-prices/bulk/profile',
      { productIds: [cola.id], profileId: first, validFrom: addDays(today, -1) },
      admin,
      422,
    );
  });

  it('moves the home warehouse after a dry run, clearing the old home where nothing is left', async () => {
    const inventory = inventoryApi(app, admin);
    const shelf = await inventory.bin(wh1.id, 'A-01-01');
    for (const product of [cola, still]) {
      await inventory.setHome(product.id, wh1.id);
      await http()
        .put('/api/v1/product-locations')
        .set(bearer(admin))
        .send({ warehouseId: wh1.id, productId: product.id, defaultBinId: shelf.id, minQty: '5' })
        .expect(200);
    }
    const created = await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        supplierId: apu,
        // Cola's home is WH1: the line goes onto its fixed shelf there (ADR-0099 #1).
        lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '3' }],
      })
      .expect(201);
    await http()
      .post(`/api/v1/receipts/${(created.body as { id: number }).id}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);

    const body = { productIds: [cola.id, still.id, rice.id], warehouseId: wh2.id };
    const dry = (await bulk('product-locations/bulk/home', { ...body, dryRun: true })).body;
    expect(dry).toEqual({
      changed: [cola.id, still.id, rice.id],
      unchanged: [],
      withStock: [{ productId: cola.id, warehouseId: wh1.id }],
    });
    const homesOf = async () =>
      (
        await sql.query<{
          product_id: string;
          warehouse_id: string;
          is_home: boolean;
          default_bin_id: string | null;
          min_qty: string | null;
        }>(
          `SELECT product_id::text, warehouse_id::text, is_home, default_bin_id::text, min_qty::text
             FROM product_locations WHERE product_id = ANY($1::bigint[]) ORDER BY product_id, warehouse_id`,
          [[cola.id, still.id, rice.id]],
        )
      ).rows;
    const before = await homesOf();
    expect(before.filter((row) => row.is_home)).toHaveLength(2);

    const applied = (await bulk('product-locations/bulk/home', body)).body;
    expect(applied).toEqual(dry);
    expect(await homesOf()).toEqual([
      // Stock stays in BK1: the old shelf and minimum stay with it.
      {
        product_id: String(cola.id),
        warehouse_id: String(wh1.id),
        is_home: false,
        default_bin_id: String(shelf.id),
        min_qty: '5.000',
      },
      {
        product_id: String(cola.id),
        warehouse_id: String(wh2.id),
        is_home: true,
        default_bin_id: null,
        min_qty: null,
      },
      // Nothing left in BK1: its row goes.
      {
        product_id: String(still.id),
        warehouse_id: String(wh2.id),
        is_home: true,
        default_bin_id: null,
        min_qty: null,
      },
      {
        product_id: String(rice.id),
        warehouse_id: String(wh2.id),
        is_home: true,
        default_bin_id: null,
        min_qty: null,
      },
    ]);
    const again = (await bulk('product-locations/bulk/home', body)).body as BulkJson;
    expect(again).toMatchObject({ changed: [], unchanged: [cola.id, still.id, rice.id] });

    const store = await inventory.warehouse('BKS', 'STORE');
    const refused = await bulk(
      'product-locations/bulk/home',
      { productIds: [cola.id], warehouseId: store.id },
      admin,
      422,
    );
    expect((refused.body as { code: string }).code).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
    await bulk('product-locations/bulk/home', body, worker, 403);
  });
});
