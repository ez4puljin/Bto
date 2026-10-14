import type { NestExpressApplication } from '@nestjs/platform-express';
import { EXPORTABLE_PRODUCT_COLUMNS } from '@tugeel/shared/catalog';
import type { SegmentCondition, SegmentDefinition } from '@tugeel/shared/segments';
import { businessDate } from '@tugeel/shared/time';
import ExcelJS from 'exceljs';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp, sqlStateOf } from '../harness/apps';
import { catalogApi, idempotency } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

const DENIED = '42501';
const UNIQUE = '23505';
const CHECK = '23514';
const COUNT = 20_000;

const all = (...conditions: SegmentCondition[]): SegmentDefinition => ({
  match: 'ALL',
  groups: [{ match: 'ALL', conditions }],
});

/**
 * The segments guards and their scale (ADR-0049): a segment is archived, never deleted (the app
 * role can neither DELETE nor TRUNCATE the table); a live name is unique per entity; and with the
 * owner's whole catalogue (20,000 products) a list page under three conditions answers within
 * 500 ms, the segments list counts ten segments within 2 s, and the whole catalogue goes to Excel
 * (two files at a time, never more than 20,000 rows). Timings are logged.
 */
describe('integrity: segments', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let owner: Client;
  let token: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    owner = await connectAs('admin');
    token = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
  });
  afterAll(async () => {
    await sql.end();
    await owner.end();
    await app.close();
  });

  it('archives segments instead of deleting them and keeps live names unique', async () => {
    const insert = (entity: string, name: string, definition = '{"match":"ALL","groups":[]}') =>
      sql.query<{ id: string }>(
        `INSERT INTO segments (entity, name, name_key, definition)
         VALUES ($1, $2, lower($2), $3::jsonb) RETURNING id::text`,
        [entity, name, definition],
      );
    const { rows } = await insert('PRODUCT', 'Ундаа');
    expect(await sqlStateOf(sql.query('DELETE FROM segments'))).toBe(DENIED);
    expect(await sqlStateOf(sql.query('TRUNCATE segments'))).toBe(DENIED);
    expect(await sqlStateOf(insert('PRODUCT', 'Ундаа'))).toBe(UNIQUE);
    expect(await sqlStateOf(insert('ORDER', 'Захиалга'))).toBe(CHECK);
    expect(await sqlStateOf(insert('PRODUCT', ''))).toBe(CHECK);
    expect(await sqlStateOf(insert('PRODUCT', 'Жагсаалт', '[]'))).toBe(CHECK);
    // The same name lives on in another entity, and again once the first is archived.
    await insert('SUPPLIER', 'Ундаа');
    await sql.query('UPDATE segments SET archived_at = now() WHERE id = $1', [rows[0]?.id]);
    await insert('PRODUCT', 'Ундаа');
  });

  it('filters and counts the whole catalogue quickly', async () => {
    const catalog = catalogApi(app, token);
    const root = await catalog.category('Бүх бараа');
    const leaves: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      leaves.push(await catalog.category(`Ангилал ${index}`, root));
    }
    const pcs = await catalog.uomId('PCS');
    const partners = partnersApi(app, token);
    const msm = (await partners.supplier({ name: 'МСМ ХХК' })).id;
    const apu = (await partners.supplier({ name: 'АПУ ХК' })).id;
    const warehouse = (await inventoryApi(app, token).warehouse('WH1')).id;
    const profile = await pricingApi(app, token).profile('Ундаа');
    // The catalogue in bulk, straight into the owners' tables: every product has a base unit (in
    // the same statement, as the deferred guard wants), a main supplier and a home; a third have no
    // weight, a fifth a minimum, three in four prices.
    await owner.query(
      `WITH made AS (
         INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id, weight_kg)
         SELECT (100000 + g)::text, 'Бараа ' || g, 'бараа ' || g, 'бара ' || g, 1,
                ($1::bigint[])[1 + g % 10], CASE WHEN g % 3 = 0 THEN NULL ELSE 0.5 END
           FROM generate_series(1, $2::int) g
         RETURNING id)
       INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base, is_default_sales, is_default_purchase)
       SELECT id, $3, 1, true, true, true FROM made`,
      [leaves, COUNT, pcs],
    );
    await owner.query(
      `INSERT INTO product_suppliers (product_id, supplier_id, is_main)
       SELECT id, CASE WHEN id % 2 = 0 THEN $1::bigint ELSE $2::bigint END, true FROM products`,
      [msm, apu],
    );
    await owner.query(
      `INSERT INTO product_locations (warehouse_id, product_id, is_home, min_qty)
       SELECT $1, id, true, CASE WHEN id % 5 = 0 THEN 3 END FROM products`,
      [warehouse],
    );
    await owner.query(
      `INSERT INTO product_prices (product_id, warehouse_price, profile_id, whole_uom_id, valid_from)
       SELECT id, 1000 + id % 500, $1, NULL, $2::date FROM products WHERE id % 4 <> 0`,
      [profile, businessDate()],
    );
    await owner.query('ANALYZE');

    const where = all(
      { field: 'category', op: 'IN', ids: leaves.slice(0, 5) },
      { field: 'supplier', op: 'MAIN_IN', ids: [msm] },
      { field: 'missing', op: 'IS', values: ['WEIGHT'] },
    );
    const page = async () => {
      const started = performance.now();
      const res = await http()
        .post('/api/v1/products/query')
        .set(bearer(token))
        .send({ where, limit: 50 })
        .expect(200);
      return { ms: performance.now() - started, body: res.body as { total: number | null } };
    };
    await page(); // warms the routes and the pool
    const { ms: pageMs, body } = await page();
    const { rows } = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count
         FROM products p JOIN product_suppliers s ON s.product_id = p.id AND s.is_main
        WHERE p.category_id = ANY($1::bigint[]) AND s.supplier_id = $2 AND p.weight_kg IS NULL`,
      [leaves.slice(0, 5), msm],
    );
    expect(body.total).toBe(rows[0]?.count);

    const definitions = [
      where,
      all({ field: 'category', op: 'NOT_IN', ids: [leaves[0] ?? 0] }),
      all({ field: 'supplier', op: 'NONE' }),
      all({ field: 'homeWarehouse', op: 'IN', ids: [warehouse] }),
      all({ field: 'stock', op: 'OUT_OF_STOCK' }),
      all({ field: 'stock', op: 'AT_OR_BELOW_MIN', warehouseId: warehouse }),
      all({ field: 'priceProfile', op: 'NONE' }),
      all({ field: 'warehousePrice', op: 'BETWEEN', min: '1100', max: '1300' }),
      all({ field: 'missing', op: 'IS', values: ['EBARIMT'] }),
      {
        match: 'ANY',
        groups: [
          { match: 'ALL', conditions: [{ field: 'createdAt', op: 'LAST_DAYS', days: 7 }] },
          { match: 'ALL', conditions: [{ field: 'stage', op: 'IN', values: ['PENDING'] }] },
        ],
      } satisfies SegmentDefinition,
    ];
    const segmentIds: number[] = [];
    for (const [index, definition] of definitions.entries()) {
      const res = await http()
        .post('/api/v1/segments')
        .set(bearer(token))
        .set(idempotency())
        .send({ entity: 'PRODUCT', name: `Сегмент ${index}`, definition })
        .expect(201);
      segmentIds.push((res.body as { id: number }).id);
    }
    const started = performance.now();
    const counts = await http()
      .get('/api/v1/segments/counts')
      .query({ segmentIds })
      .set(bearer(token))
      .expect(200);
    const countsMs = performance.now() - started;
    expect((counts.body as { count: number | null }[]).map((row) => row.count)).toEqual([
      rows[0]?.count,
      COUNT - COUNT / 10,
      0,
      COUNT,
      COUNT,
      COUNT / 5,
      COUNT / 4,
      // 1000 + id % 500 within 1100–1300: 201 of every 500 ids, 51 of them unpriced (id % 4 = 0)
      (COUNT / 500) * (201 - 51),
      COUNT,
      COUNT,
    ]);
    // Logged for the delivery notes: how long the list and the segments page take here.
    console.log(
      `segments at scale: page ${Math.round(pageMs)} ms, ten counts ${Math.round(countsMs)} ms`,
    );
    expect(pageMs).toBeLessThan(500);
    expect(countsMs).toBeLessThan(2000);
  }, 120_000);

  it('exports the whole catalogue, two files at a time, and no more than 20,000 rows', async () => {
    const exportAll = () =>
      http()
        .post('/api/v1/exports/products')
        .set(bearer(token))
        .send({ columns: EXPORTABLE_PRODUCT_COLUMNS })
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
    const started = performance.now();
    const file = await exportAll().expect(200);
    const exportMs = performance.now() - started;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as ArrayBuffer);
    expect(workbook.worksheets[0]?.rowCount).toBe(COUNT + 1);
    // A third export while two run is refused at once, never queued.
    const statuses = (await Promise.all([exportAll(), exportAll(), exportAll()])).map(
      (res) => res.status,
    );
    expect(statuses.sort()).toEqual([200, 200, 429]);
    // One product more than an export holds: refused with the count, before any row is read.
    await owner.query(
      `WITH made AS (
         INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id)
         SELECT '999999', 'Илүү бараа', 'илүү бараа', 'илү бара', 1, category_id FROM products LIMIT 1
         RETURNING id)
       INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base, is_default_sales, is_default_purchase)
       SELECT made.id, u.uom_id, 1, true, true, true FROM made, (SELECT uom_id FROM product_units LIMIT 1) u`,
    );
    const tooMany = await exportAll().expect(422);
    expect(JSON.parse((tooMany.body as Buffer).toString('utf8'))).toMatchObject({
      code: 'EXPORT_TOO_LARGE',
      params: { count: COUNT + 1, limit: COUNT },
    });
    console.log(`segments at scale: export of ${COUNT} rows ${Math.round(exportMs)} ms`);
    expect(exportMs).toBeLessThan(60_000);
  }, 180_000);
});
