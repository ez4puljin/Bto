import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';

/** GET /barcodes/:code (SPEC §5.2): normalised GTIN forms, current units only, under 300 ms. */
describe('barcode lookup', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let api: ReturnType<typeof catalogApi>;
  let pcs: number;
  let box: number;
  let category: number;
  const http = () => request(app.getHttpServer());
  const resolve = (code: string) =>
    http()
      .get(`/api/v1/barcodes/${encodeURIComponent(code)}`)
      .set(bearer(worker));

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    api = catalogApi(app, admin);
    pcs = await api.uomId('PCS');
    box = await api.uomId('BOX');
    category = await api.category('Баркод');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('resolves every GTIN form of a code to its product and unit', async () => {
    const product = await api.product({
      sku: '60001',
      name: 'Хайрцагтай бараа',
      categoryId: category,
      baseUomId: pcs,
      baseBarcodes: ['036000291452'],
      units: [{ uomId: box, factorToBase: '24', barcodes: ['10012345000017'] }],
    });
    for (const code of ['036000291452', '0036000291452', '00036000291452']) {
      const res = await resolve(code).expect(200);
      expect(res.body).toMatchObject({
        product: { id: product.id, sku: '60001' },
        unit: { uomId: pcs, isBase: true, factorToBase: '1' },
        barcode: { code: '036000291452', barcodeType: 'GS1' },
      });
    }
    const boxed = await resolve('10012345000017').expect(200);
    expect(boxed.body.unit).toMatchObject({ uomId: box, factorToBase: '24', isBase: false });
    await resolve('codes/with?odd#chars').expect(404);
  });

  it('answers the new unit after a supersede, 404 for unknown codes and 422 for unreadable ones', async () => {
    const product = await api.product({
      sku: '60002',
      name: 'Хайрцаг солигдох',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24', barcodes: ['BX-60002'] }],
    });
    const old = unitOf(product, 'BOX');
    const next = await http()
      .post(`/api/v1/product-units/${old.id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '20' })
      .expect(201);
    expect((await resolve('bx-60002').expect(200)).body.unit).toMatchObject({
      id: next.body.id,
      factorToBase: '20',
    });
    await resolve('UNKNOWN-1').expect(404);
    // A wrong check digit is an ordinary code since ADR-0098 #6: unknown here, so 404.
    await resolve('4006381333932').expect(404);
    expect((await resolve('АВ123').expect(422)).body).toMatchObject({
      code: 'BARCODE_INVALID',
    });
  });

  it('refuses to guess between an EAN-8 and a UPC-E registered on different products', async () => {
    await api.product({
      sku: '60003',
      name: 'EAN-8',
      categoryId: category,
      baseUomId: pcs,
      baseBarcodes: ['00000116'],
    });
    await api.product({
      sku: '60004',
      name: 'UPC-A',
      categoryId: category,
      baseUomId: pcs,
      baseBarcodes: ['000100000016'],
    });
    expect((await resolve('00000116').expect(409)).body.code).toBe('BARCODE_AMBIGUOUS');
    expect((await resolve('000100000016').expect(200)).body.product.sku).toBe('60004');
  });

  it('stays under 300 ms with 10,000 products and uses the lookup index', async () => {
    const pcsId = String(pcs);
    await sql.query('BEGIN');
    await sql.query(
      `INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id)
       SELECT (700000 + n)::text, 'Бараа ' || n, ' бараа ' || n, ' bara ' || n, 1, $1
         FROM generate_series(1, 10000) AS n`,
      [category],
    );
    await sql.query(
      `INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base, is_default_sales, is_default_purchase)
       SELECT id, $1, 1, true, true, true FROM products WHERE sku::bigint > 700000`,
      [pcsId],
    );
    await sql.query(
      `INSERT INTO product_barcodes (product_unit_id, code, lookup_key, barcode_type, is_primary)
       SELECT u.id, 'P' || p.sku, 'P' || p.sku, 'UNDEFINED', true
         FROM product_units u JOIN products p ON p.id = u.product_id WHERE p.sku::bigint > 700000`,
    );
    await sql.query('COMMIT');
    await sql.query('ANALYZE products, product_units, product_barcodes');

    let slowest = 0;
    for (const sku of ['705000', '700001', '709999']) {
      const started = performance.now();
      const res = await resolve(`P${sku}`).expect(200);
      slowest = Math.max(slowest, performance.now() - started);
      expect(res.body.product.sku).toBe(sku);
    }
    expect(slowest).toBeLessThan(300);

    const plan = await sql.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN SELECT * FROM product_barcodes WHERE lookup_key IN ('P705000')`,
    );
    expect(plan.rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
      'product_barcodes_lookup_key_key',
    );
  });
});
