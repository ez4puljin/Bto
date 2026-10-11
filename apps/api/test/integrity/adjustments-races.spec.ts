import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';

/**
 * Approving and cancelling the same submitted adjustment at once: both lock the header first, so
 * exactly one wins and a cancelled adjustment never leaves ledger rows behind.
 */
describe('integrity: adjustment races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  const outcomes: { posted: number; cancelled: number }[] = [];

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('WH1');
    const shelf = await inventory.bin(warehouse.id, 'A-01-01');
    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku: '1',
      name: 'Гурил',
      categoryId: await catalog.category('Хүнс'),
      baseUomId: await catalog.uomId('PCS'),
    });
    const http = () => request(app.getHttpServer());

    for (let round = 0; round < 6; round += 1) {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(bearer(worker))
        .set(idempotency())
        .send({
          warehouseId: warehouse.id,
          reason: 'SURPLUS',
          lines: [{ productUnitId: unitOf(product, 'PCS').id, enteredQty: '1', binId: shelf.id }],
        })
        .expect(201);
      const id = (created.body as { id: number }).id;
      await http().post(`/api/v1/adjustments/${id}/submit`).set(bearer(worker)).expect(200);
      const [posted, cancelled] = await Promise.all([
        http().post(`/api/v1/adjustments/${id}/post`).set(bearer(admin)).set(idempotency()),
        http().post(`/api/v1/adjustments/${id}/cancel`).set(bearer(worker)),
      ]);
      outcomes.push({ posted: posted.status, cancelled: cancelled.status });
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('lets exactly one of approve and cancel win', () => {
    for (const outcome of outcomes) {
      expect([
        { posted: 200, cancelled: 409 },
        { posted: 409, cancelled: 200 },
      ]).toContainEqual(outcome);
    }
  });

  it('writes ledger rows only for posted adjustments', async () => {
    const { rows } = await sql.query<{ status: string; ledger: string }>(
      `SELECT a.status, count(s.id)::text AS ledger
         FROM adjustments a LEFT JOIN stock_ledger s ON s.doc_type = 'ADJ' AND s.doc_id = a.id
        GROUP BY a.id, a.status`,
    );
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.ledger).toBe(row.status === 'POSTED' ? '1' : '0');
  });
});
