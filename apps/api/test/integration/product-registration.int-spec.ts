import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, customRoleUser, login, seedUser } from '../harness/identity';
import { inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface RegisteredJson {
  productId: number;
  sku: string;
  name: string;
}

interface ImageFiles {
  imageFileId: number;
  thumbFileId: number;
}

const REGISTER = 'catalog.products.register';

const jpeg = (size: number) => {
  const body = Buffer.alloc(size, 7);
  body.set([0xff, 0xd8, 0xff]);
  return body;
};

/** Registering a product in one step: units, barcodes, photos, home, shelf, supplier (ADR-0044 #5). */
describe('product registration', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let registrar: string;
  let pcs: number;
  let box: number;
  let block: number;
  let water: number;
  let supplier: number;
  let home: WarehouseJson;
  let store: WarehouseJson;
  const http = () => request(app.getHttpServer());

  /** Presigns and uploads a photo and its thumbnail the way the web does. */
  async function photo(token = registrar): Promise<ImageFiles> {
    const ids: number[] = [];
    for (const [kind, size] of [
      ['catalog.product_image', 2048],
      ['catalog.product_thumb', 512],
    ] as const) {
      const content = jpeg(size);
      const issued = await http()
        .post('/api/v1/files/presign')
        .set(bearer(token))
        .send({ kind, contentType: 'image/jpeg', sizeBytes: content.length })
        .expect(201);
      await http()
        .put(issued.body.uploadUrl)
        .set('Content-Type', 'image/jpeg')
        .send(content)
        .expect(204);
      ids.push(issued.body.fileId as number);
    }
    const [imageFileId, thumbFileId] = ids;
    if (imageFileId === undefined || thumbFileId === undefined) throw new Error('no upload');
    return { imageFileId, thumbFileId };
  }

  const register = (body: Record<string, unknown>, token = registrar, key = randomUUID()) =>
    http()
      .post('/api/v1/product-registrations')
      .set(bearer(token))
      .set('Idempotency-Key', key)
      .send(body);

  const registration = (images: ImageFiles[], overrides: Record<string, unknown> = {}) => ({
    sku: '10001',
    name: 'Цэвэр ус 0.5л',
    categoryId: water,
    baseUomId: pcs,
    weightKg: '0.52',
    baseBarcodes: ['4870001000011'],
    boxFactor: '12',
    boxBarcodes: ['14870001000018'],
    units: [{ uomId: block, factorToBase: '6' }],
    supplierId: supplier,
    homeWarehouseId: home.id,
    fixedBinCode: 'a-01',
    images,
    ...overrides,
  });

  const productCount = async () =>
    Number((await sql.query<{ n: string }>('SELECT count(*) AS n FROM products')).rows[0]?.n);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    registrar = await customRoleUser(app, admin, [REGISTER]);
    const catalog = catalogApi(app, admin);
    pcs = await catalog.uomId('PCS');
    box = await catalog.uomId('BOX');
    block = await catalog.uomId('BLOCK');
    const drinks = await http()
      .post('/api/v1/categories')
      .set(bearer(admin))
      .send({
        name: 'Ундаа',
        skuFrom: '10000',
        skuTo: '19999',
        defaultClassificationCode: '2441100',
      })
      .expect(201);
    water = await catalog.category('Ус', (drinks.body as { id: number }).id);
    supplier = (await partnersApi(app, admin).supplier({ name: 'Ус ХХК' })).id;
    const inventory = inventoryApi(app, admin);
    home = await inventory.warehouse('W1');
    store = await inventory.warehouse('S1', 'STORE');
    await inventory.bin(home.id, 'A-01');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('registers the product with its box, photos, home, shelf and supplier; it waits for prices', async () => {
    const photos = [await photo(), await photo()];
    const next = await http()
      .get('/api/v1/products/next-sku')
      .query({ categoryId: water })
      .set(bearer(registrar))
      .expect(200);
    expect(next.body).toEqual({ sku: '10000' });
    const key = randomUUID();
    const created = await register(registration(photos, { sku: '10000' }), registrar, key).expect(
      201,
    );
    const result = created.body as RegisteredJson;
    expect(result).toMatchObject({ sku: '10000', name: 'Цэвэр ус 0.5л' });
    // A retry with the same key replays the answer instead of registering again.
    const replay = await register(registration(photos, { sku: '10000' }), registrar, key).expect(
      201,
    );
    expect(replay.body).toEqual(result);
    expect(await productCount()).toBe(1);

    const product = (
      await http().get(`/api/v1/products/${result.productId}`).set(bearer(admin)).expect(200)
    ).body as ProductJson & { images: { isPrimary: boolean; sortOrder: number }[] };
    expect(product).toMatchObject({
      status: 'ACTIVE',
      saleReadyAt: null,
      categoryId: water,
      weightKg: '0.52',
      vatType: 'VAT_ABLE',
      cityTax: null,
      // Ус has no default of its own: its parent's.
      classificationCode: '2441100',
      taxProductCode: null,
    });
    expect(unitOf(product, 'PCS')).toMatchObject({ isBase: true, factorToBase: '1' });
    expect(unitOf(product, 'PCS').barcodes.map((b) => b.code)).toEqual(['4870001000011']);
    expect(unitOf(product, 'BOX')).toMatchObject({ factorToBase: '12', isBase: false });
    expect(unitOf(product, 'BOX').barcodes.map((b) => b.code)).toEqual(['14870001000018']);
    expect(unitOf(product, 'BLOCK')).toMatchObject({ factorToBase: '6' });
    expect(product.images.map((image) => [image.sortOrder, image.isPrimary])).toEqual([
      [0, true],
      [1, false],
    ]);

    const locations = await http()
      .get('/api/v1/product-locations')
      .query({ productId: result.productId })
      .set(bearer(admin))
      .expect(200);
    expect(locations.body.data).toEqual([
      expect.objectContaining({ warehouseId: home.id, isHome: true, defaultBinCode: 'A-01' }),
    ]);
    const links = await http()
      .get('/api/v1/product-suppliers')
      .query({ productId: result.productId })
      .set(bearer(admin))
      .expect(200);
    expect(links.body.data).toEqual([
      expect.objectContaining({
        isMain: true,
        supplier: expect.objectContaining({ id: supplier }),
      }),
    ]);
    // The next suggestion follows the new code.
    const after = await http()
      .get('/api/v1/products/next-sku')
      .query({ categoryId: water })
      .set(bearer(registrar))
      .expect(200);
    expect(after.body).toEqual({ sku: '10001' });
  });

  it('writes nothing when any part is refused, and the photos stay usable', async () => {
    const photos = [await photo()];
    const before = await productCount();
    const refused: [Record<string, unknown>, number, Record<string, unknown>][] = [
      [{ sku: '20000' }, 422, { code: 'SKU_OUT_OF_RANGE' }],
      // 010000 is the number of 10000, registered above.
      [{ sku: '010000' }, 409, { code: 'DUPLICATE_VALUE' }],
      [{ baseBarcodes: ['4870001000011'] }, 409, { code: 'BARCODE_TAKEN' }],
      [{ boxFactor: '2.5' }, 422, { code: 'UNIT_FACTOR_INEXACT', params: { path: 'boxFactor' } }],
      [
        { units: [{ uomId: box, factorToBase: '24' }] },
        422,
        { errors: [expect.objectContaining({ path: 'units.0.uomId' })] },
      ],
      [{ baseUomId: box }, 422, { errors: [expect.objectContaining({ path: 'baseUomId' })] }],
      [
        { fixedBinCode: 'Z-99' },
        422,
        { errors: [expect.objectContaining({ path: 'fixedBinCode' })] },
      ],
      [{ homeWarehouseId: store.id }, 422, { code: 'WAREHOUSE_KIND_NOT_ALLOWED' }],
      [{ images: [] }, 422, { code: 'VALIDATION_FAILED' }],
    ];
    for (const [overrides, status, problem] of refused) {
      const response = await register(
        registration(photos, { baseBarcodes: [], boxBarcodes: [], ...overrides }),
      );
      expect({ overrides, status: response.status }).toEqual({ overrides, status });
      expect(response.body).toMatchObject(problem);
    }
    await http()
      .patch(`/api/v1/suppliers/${supplier}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    const inactive = await register(registration(photos, { baseBarcodes: [], boxBarcodes: [] }));
    expect(inactive.status).toBe(409);
    expect(inactive.body).toMatchObject({ code: 'SUPPLIER_INACTIVE' });
    await http()
      .patch(`/api/v1/suppliers/${supplier}`)
      .set(bearer(admin))
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect(await productCount()).toBe(before);
    const files = await sql.query<{ status: string }>(
      'SELECT status FROM files WHERE id = ANY($1::bigint[]) ORDER BY id',
      [[photos[0]?.imageFileId, photos[0]?.thumbFileId]],
    );
    expect(files.rows.map((row) => row.status)).toEqual(['PENDING', 'PENDING']);

    // The same photos register the product once the request is right; no shelf is fine.
    const done = await register(
      registration(photos, {
        sku: '10001',
        baseBarcodes: ['4870001000028'],
        boxBarcodes: [],
        units: [],
        fixedBinCode: null,
      }),
    ).expect(201);
    const product = (
      await http()
        .get(`/api/v1/products/${(done.body as RegisteredJson).productId}`)
        .set(bearer(admin))
        .expect(200)
    ).body as ProductJson;
    expect(product.units.map((unit) => unit.uomCode).sort()).toEqual(['BOX', 'PCS']);
  });

  it('needs the register permission and the home warehouse in the write scope', async () => {
    const outsider = await customRoleUser(app, admin, ['catalog.products.manage']);
    await http()
      .get('/api/v1/products/next-sku')
      .query({ categoryId: water })
      .set(bearer(outsider))
      .expect(403);
    const denied = await register(registration([await photo(admin)], { sku: '10500' }), outsider);
    expect(denied.status).toBe(403);

    const other = await inventoryApi(app, admin).warehouse('W2');
    const scoped = (
      await login(app, await seedUser(app, { roles: ['ADMIN'], warehouseIds: [other.id] }))
    ).accessToken;
    const outside = await register(registration([await photo(scoped)], { sku: '10500' }), scoped);
    expect(outside.status).toBe(403);
    expect(outside.body).toMatchObject({ params: { reason: 'WAREHOUSE_SCOPE' } });
  });
});
