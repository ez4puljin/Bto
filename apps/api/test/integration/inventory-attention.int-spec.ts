import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface AttentionJson {
  transfersToShip: number;
  transfersToReceive: number;
  adjustmentsToApprove: number;
  stocktakesToReview: number;
  receiptsToCost: number;
  lowStock: { count: number; warehouseId: number | null };
  cap: number;
}

/** The home page's attention counts (ADR-0047 #7): by right and write scope, capped. */
describe('attention counts', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let clerk: string;
  let accountant: string;
  let prices: string;
  let nobody: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let store: WarehouseJson;
  let rice: ProductJson;
  let sequence = 0;
  const http = () => request(app.getHttpServer());
  const attention = async (token: string) =>
    (await http().get('/api/v1/inventory/attention').set(bearer(token)).expect(200))
      .body as AttentionJson;

  /** A transfer in a given state, written straight into the table. */
  const transfer = async (status: 'REQUESTED' | 'SHIPPED', from: number, to: number) => {
    sequence += 1;
    await sql.query(
      `INSERT INTO transfers (origin, status, source_warehouse_id, dest_warehouse_id, number,
                              requested_at, shipped_at, ship_date)
       VALUES ('REQUEST', $1, $2, $3, $4, now(),
               CASE WHEN $1 = 'SHIPPED' THEN now() END, CASE WHEN $1 = 'SHIPPED' THEN current_date END)`,
      [status, from, to, `TR-T-${sequence}`],
    );
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    store = await inventory.warehouse('STORE1', 'STORE');
    const token = async (roles: string[], warehouseIds?: number[]) =>
      (await login(app, await seedUser(app, { roles, ...(warehouseIds ? { warehouseIds } : {}) })))
        .accessToken;
    worker = await token(['WAREHOUSE'], [wh1.id]);
    clerk = await token(['POS_CASHIER'], [store.id]);
    accountant = await token(['ACCOUNTANT']);
    nobody = await token([]);
    // Among the system roles only the admin enters prices (the price clerk is a custom role).
    prices = admin;

    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Будаа');
    rice = await catalog.product({
      sku: '11',
      name: 'Будаа',
      categoryId: category,
      baseUomId: await catalog.uomId('PCS'),
    });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('counts the work waiting for each person, in their warehouses only', async () => {
    await transfer('REQUESTED', wh1.id, store.id);
    await transfer('REQUESTED', wh2.id, store.id);
    await transfer('SHIPPED', wh1.id, store.id);
    await sql.query(
      `INSERT INTO adjustments (warehouse_id, reason, status, submitted_at)
       VALUES ($1, 'DAMAGED', 'SUBMITTED', now()), ($2, 'DAMAGED', 'SUBMITTED', now())`,
      [wh1.id, wh2.id],
    );
    await sql.query(
      `INSERT INTO stocktakes (warehouse_id, status, started_at) VALUES ($1, 'REVIEW', now())`,
      [wh1.id],
    );
    // A posted receipt waiting for its costs.
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh1.id,
        supplierId,
        lines: [{ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '5' }],
      })
      .expect(201);
    await http()
      .post(`/api/v1/receipts/${(receipt.body as { id: number }).id}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .expect(200);
    // Rice at its minimum in WH1: one low-stock line there.
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, productId: rice.id, minQty: '10' })
      .expect(200);

    expect(await attention(admin)).toEqual({
      transfersToShip: 2,
      transfersToReceive: 1,
      adjustmentsToApprove: 2,
      stocktakesToReview: 1,
      receiptsToCost: 1,
      lowStock: { count: 1, warehouseId: wh1.id },
      cap: 100,
    });
    // WH1's clerk ships only WH1's request; approvals and costs are not theirs.
    expect(await attention(worker)).toMatchObject({
      transfersToShip: 1,
      transfersToReceive: 0,
      adjustmentsToApprove: 0,
      stocktakesToReview: 0,
      receiptsToCost: 0,
      lowStock: { count: 1, warehouseId: wh1.id },
    });
    // The supermarket receives; nothing low there.
    expect(await attention(clerk)).toMatchObject({
      transfersToShip: 0,
      transfersToReceive: 1,
      lowStock: { count: 0, warehouseId: null },
    });
    expect(await attention(accountant)).toMatchObject({
      transfersToShip: 0,
      receiptsToCost: 1,
    });
    expect(await attention(nobody)).toEqual({
      transfersToShip: 0,
      transfersToReceive: 0,
      adjustmentsToApprove: 0,
      stocktakesToReview: 0,
      receiptsToCost: 0,
      lowStock: { count: 0, warehouseId: null },
      cap: 100,
    });
    // An approver scoped to WH2 approves only WH2's adjustment.
    const wh2Admin = (
      await login(app, await seedUser(app, { roles: ['ADMIN'], warehouseIds: [wh2.id] }))
    ).accessToken;
    expect(await attention(wh2Admin)).toMatchObject({
      transfersToShip: 1,
      adjustmentsToApprove: 1,
      stocktakesToReview: 0,
    });
  });

  it('counts products waiting for prices for the price clerk only', async () => {
    const { rows } = await sql.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM products WHERE status = 'ACTIVE' AND sale_ready_at IS NULL`,
    );
    const body = (await http().get('/api/v1/pricing/attention').set(bearer(prices)).expect(200))
      .body as { productsWaitingForPrices: number; cap: number };
    expect(body).toEqual({
      productsWaitingForPrices: Math.min(rows[0]?.count ?? 0, 100),
      cap: 100,
    });
    await http().get('/api/v1/pricing/attention').set(bearer(worker)).expect(403);
  });

  it('stops counting at the cap', async () => {
    await sql.query(
      `INSERT INTO transfers (origin, status, source_warehouse_id, dest_warehouse_id, number, requested_at)
       SELECT 'REQUEST', 'REQUESTED', $1, $2, 'TR-CAP-' || g, now() FROM generate_series(1, 101) g`,
      [wh2.id, store.id],
    );
    expect((await attention(admin)).transfersToShip).toBe(100);
  });
});
