import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { SKU_NUMBER_LOCK } from '../../src/modules/catalog/services/sku-ranges.service';
import type { AuthContext } from '../../src/modules/identity';
import { ImportPipelineService } from '../../src/modules/imports';
import { ProductRegistrationService, type RegistrationInput } from '../../src/modules/inventory';
import { LOCKS as PARTNER_LOCKS } from '../../src/modules/partners/services/support';
import { SaleReadinessService } from '../../src/modules/pricing';
import { connectAs, createHttpApp, waitFor } from '../harness/apps';
import { catalogApi, codeOf, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { importsApi } from '../harness/imports';
import { inventoryApi, staffContext, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

type ImageFiles = RegistrationInput['images'][number];

const jpeg = (size: number) => {
  const body = Buffer.alloc(size, 5);
  body.set([0xff, 0xd8, 0xff]);
  return body;
};

/**
 * Registration races (ADR-0044 #5): every product writer takes products (by id), then
 * product_locations, then product_suppliers (architecture §5.3); one number is one code; two
 * completions of overlapping products wait for each other.
 */
describe('integrity: product registration concurrency', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let superuser: Client;
  let admin: string;
  let ctx: AuthContext;
  let registrations: ProductRegistrationService;
  let pcs: number;
  let water: number;
  let supplier: number;
  let home: WarehouseJson;
  const http = () => request(app.getHttpServer());

  async function photo(): Promise<ImageFiles> {
    const ids: number[] = [];
    for (const [kind, size] of [
      ['catalog.product_image', 1024],
      ['catalog.product_thumb', 256],
    ] as const) {
      const content = jpeg(size);
      const issued = await http()
        .post('/api/v1/files/presign')
        .set(bearer(admin))
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

  const input = (sku: string, image: ImageFiles): RegistrationInput => ({
    sku,
    name: `Ус ${sku}`,
    categoryId: water,
    baseUomId: pcs,
    weightKg: null,
    baseBarcodes: [],
    boxFactor: new Decimal(12),
    boxBarcodes: [],
    units: [],
    supplierId: supplier,
    homeWarehouseId: home.id,
    fixedBinCode: 'A-01',
    images: [image],
  });

  /** Sessions waiting for a lock that matches `where` (a pg_locks condition). */
  const waiting = async (where: string) =>
    Number(
      (
        await sql.query<{ n: string }>(
          `SELECT count(DISTINCT pid)::text AS n FROM pg_locks WHERE NOT granted AND ${where}`,
        )
      ).rows[0]?.n,
    );
  const untilWaiting = (where: string, count: number) =>
    waitFor(async () => ((await waiting(where)) >= count ? true : undefined), 10_000, 50);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    superuser = await connectAs('admin');
    const user = await seedUser(app, { roles: ['ADMIN'] });
    admin = (await login(app, user)).accessToken;
    ctx = staffContext(user.id, 'ADMIN');
    registrations = app.get(ProductRegistrationService);
    const catalog = catalogApi(app, admin);
    pcs = await catalog.uomId('PCS');
    water = await catalog.category('Ус');
    supplier = (await partnersApi(app, admin).supplier({ name: 'Ус ХХК' })).id;
    const inventory = inventoryApi(app, admin);
    home = await inventory.warehouse('WH1');
    await inventory.bin(home.id, 'A-01');
  });
  afterAll(async () => {
    await superuser.end();
    await sql.end();
    await app.close();
  });

  it('lets a registration and an import revert pass each other: one table order', async () => {
    const imports = importsApi(app, admin);
    const job = await imports.check('PRODUCTS', [
      {
        sku: '5001',
        name: 'Импортын ус',
        category: 'Ус',
        homeWarehouse: 'WH1',
        fixedBin: 'A-01',
        supplier: 'Ус ХХК',
      },
    ]);
    expect((await imports.commit(job.id)).status).toBe('COMMITTED');
    await http()
      .post(`/api/v1/imports/${job.id}/revert`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    const image = await photo();
    const { rows } = await superuser.query<{ id: string }>(
      `SELECT (CASE WHEN is_called THEN last_value + 1 ELSE last_value END)::text AS id
         FROM products_id_seq`,
    );
    const next = Number(rows[0]?.id);
    const holder = await connectAs('app');
    try {
      // The registration writes its product and home, then waits for its supplier link's lock.
      await holder.query('SELECT pg_advisory_lock($1::int, $2::int)', [
        PARTNER_LOCKS.productSuppliers,
        next,
      ]);
      const registering = codeOf(registrations.register(ctx, input('6001', image)));
      await untilWaiting(
        `locktype = 'advisory' AND classid = ${PARTNER_LOCKS.productSuppliers}`,
        1,
      );
      // The revert takes its products, then waits for product_locations behind the registration;
      // had it locked product_suppliers first, the two would deadlock here.
      const reverting = app.get(ImportPipelineService).revert(job.id);
      await untilWaiting(`locktype = 'relation' AND relation = 'product_locations'::regclass`, 1);
      await holder.query('SELECT pg_advisory_unlock($1::int, $2::int)', [
        PARTNER_LOCKS.productSuppliers,
        next,
      ]);
      expect(await registering).toBeUndefined();
      await reverting;
    } finally {
      await holder.end();
    }
    expect(await imports.get(job.id)).toMatchObject({ status: 'REVERTED' });
    const { rows: links } = await sql.query<{ sku: string }>(
      `SELECT p.sku FROM product_suppliers ps JOIN products p ON p.id = ps.product_id ORDER BY p.sku`,
    );
    expect(links.map((row) => row.sku)).toEqual(['6001']);
  });

  it('registers one number once when "7000" and "07000" race', async () => {
    const images = [await photo(), await photo()];
    const holder = await connectAs('app');
    let outcomes: (string | undefined)[];
    try {
      await holder.query('SELECT pg_advisory_lock($1::int, hashtext($2))', [
        SKU_NUMBER_LOCK,
        '7000',
      ]);
      const attempts = ['7000', '07000'].map((sku, index) => {
        const image = images[index];
        if (!image) throw new Error('no photo');
        return codeOf(registrations.register(ctx, input(sku, image)));
      });
      await untilWaiting(`locktype = 'advisory' AND classid = ${SKU_NUMBER_LOCK}`, 2);
      await holder.query('SELECT pg_advisory_unlock($1::int, hashtext($2))', [
        SKU_NUMBER_LOCK,
        '7000',
      ]);
      outcomes = await Promise.all(attempts);
    } finally {
      await holder.end();
    }
    expect(outcomes.map((code) => code ?? 'OK').sort()).toEqual(['DUPLICATE_VALUE', 'OK']);
    const { rows } = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM products WHERE sku::numeric = 7000`,
    );
    expect(rows[0]?.n).toBe('1');
  });

  it('completes overlapping selections once each, waiting instead of deadlocking', async () => {
    const catalog = catalogApi(app, admin);
    const today = businessDate();
    const items: ProductJson[] = [];
    for (const sku of ['8001', '8002', '8003']) {
      const item = await catalog.product({
        sku,
        name: `Үнэтэй ${sku}`,
        categoryId: water,
        baseUomId: pcs,
      });
      await http()
        .post('/api/v1/unit-prices')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          productId: item.id,
          validFrom: today,
          entries: (['WHOLESALE', 'RETAIL'] as const).map((list) => ({
            list,
            productUnitId: unitOf(item, 'PCS').id,
            price: '1500',
          })),
        })
        .expect(200);
      items.push(item);
    }
    const [first, second, third] = items.map((item) => item.id);
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('products missing');
    }
    const readiness = app.get(SaleReadinessService);
    const holder = await connectAs('app');
    let results: Awaited<ReturnType<SaleReadinessService['complete']>>[];
    try {
      // Both completions queue behind the first product's row; given in opposite orders, they
      // still lock by id and so wait for each other instead of deadlocking.
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM products WHERE id = $1 FOR UPDATE', [first]);
      const calls = [
        readiness.complete(ctx, [third, second, first]),
        readiness.complete(ctx, [second, first]),
      ];
      await untilWaiting(`locktype IN ('transactionid', 'tuple')`, 2);
      await holder.query('ROLLBACK');
      results = await Promise.all(calls);
    } finally {
      await holder.end();
    }
    const completed = results.flatMap((result) => result.completed).sort((a, b) => a - b);
    expect(completed).toEqual([first, second, third]);
    const { rows } = await sql.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM audit_log
        WHERE action = 'COMPLETE' AND entity = 'products' AND entity_id = ANY($1::text[])`,
      [[first, second, third].map(String)],
    );
    expect(rows[0]?.n).toBe('3');
  });
});
