import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

describe('products: create, update, list (SPEC §5.2)', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let pcs: number;
  let box: number;
  let kg: number;
  let drinks: number;
  let cola: number;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const api = catalogApi(app, admin);
    pcs = await api.uomId('PCS');
    box = await api.uomId('BOX');
    kg = await api.uomId('KG');
    drinks = await api.category('Ундаа');
    cola = await api.category('Кола', drinks);
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('creates a product with its base unit, a box and barcodes in one step', async () => {
    const product = await catalogApi(app, admin).product({
      sku: '10023',
      name: '  Кока кола   0,5л ',
      categoryId: cola,
      baseUomId: pcs,
      vatType: 'VAT_ABLE',
      cityTax: false,
      weightKg: '0.55',
      baseBarcodes: ['4006381333931'],
      units: [
        { uomId: box, factorToBase: '24', isDefaultPurchase: true, barcodes: ['10012345000017'] },
      ],
    });
    expect(product).toMatchObject({
      sku: '10023',
      name: 'Кока кола 0,5л',
      status: 'ACTIVE',
      weightKg: '0.55',
      cityTax: false,
    });
    const base = unitOf(product, 'PCS');
    const pack = unitOf(product, 'BOX');
    expect(base).toMatchObject({
      isBase: true,
      factorToBase: '1',
      isDefaultSales: true,
      isDefaultPurchase: false,
    });
    expect(pack).toMatchObject({
      factorToBase: '24',
      isDefaultSales: false,
      isDefaultPurchase: true,
    });
    expect(base.barcodes).toEqual([
      expect.objectContaining({
        code: '4006381333931',
        gtin14: '04006381333931',
        barcodeType: 'GS1',
        isPrimary: true,
      }),
    ]);
    expect(pack.barcodes[0]).toMatchObject({ gtin14: '10012345000017', isPrimary: true });

    const { rows } = await sql.query<{ search_text: string; search_phonetic: string }>(
      `SELECT search_text, search_phonetic FROM products WHERE id = $1`,
      [product.id],
    );
    expect(rows[0]).toEqual({
      search_text: ' кока кола 0.5 л 10023',
      search_phonetic: ' koka kola 0.5 l 10023',
    });
    const audit = await sql.query(
      `SELECT 1 FROM audit_log WHERE entity = 'products' AND entity_id = $1 AND action = 'CREATE'`,
      [String(product.id)],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('suggests the next numeric SKU, keeping its width, and refuses duplicates', async () => {
    const api = catalogApi(app, admin);
    const next = await http().get('/api/v1/products/next-sku').set(bearer(admin)).expect(200);
    expect(next.body).toEqual({ sku: '10024' });
    const auto = await api.product({ name: 'Автомат код', categoryId: drinks, baseUomId: pcs });
    expect(auto.sku).toBe('10024');
    const twin = await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({ sku: '10024', name: 'Давхар', categoryId: drinks, baseUomId: pcs })
      .expect(409);
    expect(twin.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'products_sku_key' },
    });
    await http().get('/api/v1/products/next-sku').set(bearer(worker)).expect(403);
  });

  it('creates nothing when a barcode is taken or wrong', async () => {
    const taken = await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({
        sku: '20001',
        name: 'Хуулбар',
        categoryId: drinks,
        baseUomId: pcs,
        baseBarcodes: ['4006381333931'],
      })
      .expect(409);
    expect(taken.body).toMatchObject({ code: 'BARCODE_TAKEN', params: { sku: '10023' } });
    const wrong = await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({
        sku: '20001',
        name: 'Буруу',
        categoryId: drinks,
        baseUomId: pcs,
        baseBarcodes: ['4006381333932'],
      })
      .expect(422);
    expect(wrong.body).toMatchObject({
      code: 'BARCODE_INVALID',
      params: { problem: 'CHECK_DIGIT' },
    });
    const { rowCount } = await sql.query(`SELECT 1 FROM products WHERE sku = '20001'`);
    expect(rowCount).toBe(0);
  });

  it('keeps conversions exact: whole factors for pieces, three decimals for kilograms', async () => {
    const api = catalogApi(app, admin);
    const half = await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({
        name: 'Хагас хайрцаг',
        categoryId: drinks,
        baseUomId: pcs,
        units: [{ uomId: box, factorToBase: '24.5' }],
      })
      .expect(422);
    expect(half.body.code).toBe('UNIT_FACTOR_INEXACT');
    const flour = await api.product({
      name: 'Гурил 1-р зэрэг',
      categoryId: drinks,
      baseUomId: kg,
      vatType: 'VAT_FREE',
      units: [{ uomId: box, factorToBase: '25.5' }],
    });
    expect(unitOf(flour, 'BOX').factorToBase).toBe('25.5');
    await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({
        name: 'Нарийн',
        categoryId: drinks,
        baseUomId: kg,
        units: [{ uomId: box, factorToBase: '0.0005' }],
      })
      .expect(422);
    const missing = await http()
      .post('/api/v1/products')
      .set(bearer(admin))
      .send({ name: 'Ангилалгүй', categoryId: 999999, baseUomId: pcs })
      .expect(422);
    expect(missing.body.errors).toEqual([expect.objectContaining({ path: 'categoryId' })]);
  });

  it('updates names with their search keys and lets every user read but only the admin write', async () => {
    const api = catalogApi(app, admin);
    const product = await api.product({ name: 'Fanta 1L', categoryId: cola, baseUomId: pcs });
    const updated = await http()
      .patch(`/api/v1/products/${product.id}`)
      .set(bearer(admin))
      .send({ name: 'Фанта 1л', status: 'INACTIVE', cityTax: null })
      .expect(200);
    expect(updated.body).toMatchObject({ name: 'Фанта 1л', status: 'INACTIVE', cityTax: null });
    const { rows } = await sql.query<{ search_phonetic: string }>(
      `SELECT search_phonetic FROM products WHERE id = $1`,
      [product.id],
    );
    expect(rows[0]?.search_phonetic).toBe(` fanta 1 l ${product.sku}`);

    await http().get(`/api/v1/products/${product.id}`).set(bearer(worker)).expect(200);
    await http().get('/api/v1/products').set(bearer(worker)).expect(200);
    await http()
      .patch(`/api/v1/products/${product.id}`)
      .set(bearer(worker))
      .send({ name: 'x' })
      .expect(403);
    await http()
      .post('/api/v1/products')
      .set(bearer(worker))
      .send({ name: 'x', categoryId: cola, baseUomId: pcs })
      .expect(403);
  });

  it('lists by name with keyset pages, filtering by category subtree and status', async () => {
    const page = async (query: string) =>
      (await http().get(`/api/v1/products?${query}`).set(bearer(worker)).expect(200)).body as {
        data: ProductJson[];
        nextCursor: string | null;
      };
    const all = await page('limit=100');
    const names = all.data.map((row) => row.name);
    const { rows } = await sql.query<{ name: string }>(
      `SELECT name FROM products ORDER BY name, id`,
    );
    expect(names).toEqual(rows.map((row) => row.name));
    expect(all.data[0]).toMatchObject({
      baseUnit: expect.objectContaining({ uomName: expect.any(String) }),
      thumbUrl: null,
    });

    const first = await page('limit=1');
    expect(first.nextCursor).not.toBeNull();
    const second = await page(`limit=1&cursor=${first.nextCursor ?? ''}`);
    expect(second.data[0]?.name).toBe(rows[1]?.name);

    const inDrinks = await page(`categoryId=${drinks}&limit=100`);
    const inCola = await page(`categoryId=${cola}&limit=100`);
    expect(inDrinks.data.length).toBeGreaterThan(inCola.data.length);
    expect(inCola.data.every((row) => row.categoryId === cola)).toBe(true);
    const inactive = await page('status=INACTIVE');
    expect(inactive.data.map((row) => row.name)).toEqual(['Фанта 1л']);
  });
});
