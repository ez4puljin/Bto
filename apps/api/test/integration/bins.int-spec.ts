import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { type BinJson, inventoryApi, type WarehouseJson } from '../harness/inventory';

/** Bins, system bins and product locations (SPEC §5.4, owner 2026-10-11, ADR-0033). */
describe('bins and product locations', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let api: ReturnType<typeof inventoryApi>;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let oldWarehouseId: number;
  const http = () => request(app.getHttpServer());

  const systemTypes = async (warehouseId: number) =>
    (await api.bins(warehouseId))
      .filter((bin) => bin.isSystem)
      .map((bin) => bin.type)
      .sort();

  beforeAll(async () => {
    // A warehouse that existed before inventory: the boot backfill gives it its system bins.
    sql = await connectAs('app');
    const { rows } = await sql.query<{ id: string }>(
      `WITH branch AS (INSERT INTO branches (code, name) VALUES ('OLD', 'Хуучин') RETURNING id)
       INSERT INTO warehouses (code, name, kind, branch_id) SELECT 'OLD', 'Хуучин агуулах', 'WHOLESALE', id
         FROM branch RETURNING id`,
    );
    oldWarehouseId = Number.parseInt(rows[0]?.id ?? '0', 10);
    app = await createHttpApp();
    const token = async (role: string, warehouseIds?: number[]) =>
      (
        await login(
          app,
          await seedUser(app, { roles: [role], ...(warehouseIds ? { warehouseIds } : {}) }),
        )
      ).accessToken;
    admin = await token('ADMIN');
    api = inventoryApi(app, admin);
    wh1 = await api.warehouse('WH1');
    wh2 = await api.warehouse('WH2');
    worker = await token('WAREHOUSE');
  });
  afterAll(async () => {
    await sql.end();
    await app.close();
  });

  it('gives every warehouse its system bins, also those created before inventory', async () => {
    const common = ['DAMAGED', 'RECEIVING', 'RETURNS', 'SHIP', 'STAGING'];
    expect(await systemTypes(oldWarehouseId)).toEqual(common);
    expect(await systemTypes(wh1.id)).toEqual(common);
    const store = await api.warehouse('STORE1', 'STORE');
    expect(await systemTypes(store.id)).toEqual([...common, 'SALESFLOOR'].sort());
    const { rows } = await sql.query<{ code: string; type: string }>(
      `SELECT b.code, b.type FROM bins b JOIN warehouses w ON w.id = b.warehouse_id WHERE w.kind = 'TRANSIT'`,
    );
    expect(rows).toEqual([{ code: 'TRANSIT', type: 'TRANSIT' }]);

    const before = await sql.query<{ count: string }>('SELECT count(*)::text AS count FROM bins');
    const second = await createHttpApp();
    await second.close();
    const after = await sql.query<{ count: string }>('SELECT count(*)::text AS count FROM bins');
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  it('creates shelves by their label and refuses twins, system names and shelves in TRANSIT', async () => {
    const shelf = await api.bin(wh1.id, ' a-01-03 ');
    expect(shelf).toMatchObject({
      code: 'A-01-03',
      type: 'STORAGE',
      sellable: true,
      isSystem: false,
    });
    // The same label may exist in another warehouse.
    await api.bin(wh2.id, 'A-01-03');
    const twin = await http()
      .post('/api/v1/bins')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, code: 'A-01-03', type: 'PICKING' })
      .expect(409);
    expect(twin.body).toMatchObject({
      code: 'DUPLICATE_VALUE',
      params: { constraint: 'bins_warehouse_code_key' },
    });
    await http()
      .post('/api/v1/bins')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, code: 'receiving', type: 'STORAGE' })
      .expect(422);
    await http()
      .post('/api/v1/bins')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, code: 'X-1', type: 'RECEIVING' })
      .expect(422);
    const { rows } = await sql.query<{ id: string }>(
      `SELECT id FROM warehouses WHERE kind = 'TRANSIT'`,
    );
    const transit = await http()
      .post('/api/v1/bins')
      .set(bearer(admin))
      .send({ warehouseId: Number.parseInt(rows[0]?.id ?? '0', 10), code: 'T-1', type: 'STORAGE' })
      .expect(422);
    expect(transit.body.code).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
    await http()
      .post('/api/v1/bins')
      .set(bearer(worker))
      .send({ warehouseId: wh1.id, code: 'W-1', type: 'STORAGE' })
      .expect(403);
  });

  it('creates a block of shelves after a preview, keeping existing ones', async () => {
    const block = {
      warehouseId: wh1.id,
      type: 'STORAGE',
      rowFrom: 'a',
      rowTo: 'B',
      rackFrom: 1,
      rackTo: 2,
      levelFrom: 1,
      levelTo: 3,
    };
    const preview = await http()
      .post('/api/v1/bins/bulk')
      .set(bearer(admin))
      .send({ ...block, dryRun: true })
      .expect(200);
    expect(preview.body).toMatchObject({ created: 0, existing: ['A-01-03'] });
    expect(preview.body.codes).toHaveLength(12);
    expect((await api.bins(wh1.id, { q: 'b-' })).length).toBe(0);

    const made = await http().post('/api/v1/bins/bulk').set(bearer(admin)).send(block).expect(200);
    expect(made.body).toMatchObject({ created: 11, existing: ['A-01-03'] });
    expect((await api.bins(wh1.id, { q: 'b-02' })).map((bin) => bin.code)).toEqual([
      'B-02-01',
      'B-02-02',
      'B-02-03',
    ]);
    await http()
      .post('/api/v1/bins/bulk')
      .set(bearer(admin))
      .send({
        ...block,
        rowFrom: 'A',
        rowTo: 'Z',
        rackFrom: 1,
        rackTo: 20,
        levelFrom: 1,
        levelTo: 1,
      })
      .expect(422);
  });

  it('finds a scanned label and archives only empty shelves', async () => {
    const found = await http()
      .get('/api/v1/bins/lookup')
      .query({ warehouseId: wh1.id, code: 'a-01-03' })
      .set(bearer(worker))
      .expect(200);
    const shelf = found.body as BinJson;
    expect(shelf.code).toBe('A-01-03');
    await http()
      .get('/api/v1/bins/lookup')
      .query({ warehouseId: wh1.id, code: 'Z-99-99' })
      .set(bearer(worker))
      .expect(404);

    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku: '100',
      name: 'Гурил',
      categoryId: await catalog.category('Хүнс'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await sql.query(
      `INSERT INTO bin_stock (warehouse_id, bin_id, product_id, on_hand) VALUES ($1, $2, $3, 5)`,
      [wh1.id, shelf.id, product.id],
    );
    const full = await http()
      .post(`/api/v1/bins/${shelf.id}/archive`)
      .set(bearer(admin))
      .expect(409);
    expect(full.body.code).toBe('BIN_NOT_EMPTY');
    const receiving = await api.systemBin(wh1.id, 'RECEIVING');
    await http().post(`/api/v1/bins/${receiving.id}/archive`).set(bearer(admin)).expect(422);

    const [empty] = await api.bins(wh1.id, { q: 'A-02-01' });
    if (!empty) throw new Error('no A-02-01');
    const archived = await http()
      .post(`/api/v1/bins/${empty.id}/archive`)
      .set(bearer(admin))
      .expect(200);
    expect(archived.body.archivedAt).not.toBeNull();
    expect((await api.bins(wh1.id, { q: 'A-02-01' })).length).toBe(0);
    expect((await api.bins(wh1.id, { q: 'A-02-01', archived: 'true' })).length).toBe(1);
    await http().post(`/api/v1/bins/${empty.id}/restore`).set(bearer(admin)).expect(200);

    const [unused] = await api.bins(wh1.id, { q: 'B-01-01' });
    if (!unused) throw new Error('no B-01-01');
    await http().delete(`/api/v1/bins/${unused.id}`).set(bearer(admin)).expect(204);
    const used = await http().delete(`/api/v1/bins/${shelf.id}`).set(bearer(admin)).expect(409);
    expect(used.body.code).toBe('IN_USE');
  });

  it('gives a product one home warehouse and fixed shelves only there', async () => {
    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku: '200',
      name: 'Кока кола',
      categoryId: await catalog.category('Ундаа'),
      baseUomId: await catalog.uomId('PCS'),
    });
    await api.setHome(product.id, wh1.id);
    const [shelf] = await api.bins(wh1.id, { q: 'A-01-01' });
    const [foreign] = await api.bins(wh2.id, { q: 'A-01-03' });
    if (!shelf || !foreign) throw new Error('shelves missing');
    const set = (token: string, body: Record<string, unknown>) =>
      http().put('/api/v1/product-locations').set(bearer(token)).send(body);

    const located = await set(worker, {
      warehouseId: wh1.id,
      productId: product.id,
      defaultBinId: shelf.id,
      minQty: '24',
      maxQty: '240',
    }).expect(200);
    expect(located.body).toMatchObject({
      isHome: true,
      defaultBinCode: 'A-01-01',
      minQty: '24',
      maxQty: '240',
    });
    await set(worker, {
      warehouseId: wh1.id,
      productId: product.id,
      defaultBinId: foreign.id,
    }).expect(422);
    const receiving = await api.systemBin(wh1.id, 'RECEIVING');
    await set(worker, {
      warehouseId: wh1.id,
      productId: product.id,
      defaultBinId: receiving.id,
    }).expect(422);
    await set(worker, {
      warehouseId: wh1.id,
      productId: product.id,
      minQty: '10',
      maxQty: '5',
    }).expect(422);
    const elsewhere = await set(admin, { warehouseId: wh2.id, productId: product.id }).expect(409);
    expect(elsewhere.body).toMatchObject({
      code: 'PRODUCT_NOT_IN_WAREHOUSE',
      params: { warehouse: wh1.name },
    });

    // Moving the home keeps the old row as a plain location.
    await api.setHome(product.id, wh2.id);
    const rows = await http()
      .get('/api/v1/product-locations')
      .query({ productId: product.id })
      .set(bearer(worker))
      .expect(200);
    expect(
      (rows.body.data as { warehouseId: number; isHome: boolean }[]).map((row) => [
        row.warehouseId,
        row.isHome,
      ]),
    ).toEqual([
      [wh1.id, false],
      [wh2.id, true],
    ]);
    await http()
      .put('/api/v1/product-locations/home')
      .set(bearer(worker))
      .send({ productId: product.id, warehouseId: wh1.id })
      .expect(403);
    const store = await api.warehouse('STORE2', 'STORE');
    await http()
      .put('/api/v1/product-locations/home')
      .set(bearer(admin))
      .send({ productId: product.id, warehouseId: store.id })
      .expect(422);

    // A worker scoped to one warehouse cannot change another.
    const scoped = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh2.id] }))
    ).accessToken;
    await set(scoped, { warehouseId: wh1.id, productId: product.id, minQty: '1' }).expect(403);
  });
});
