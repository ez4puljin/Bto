import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * ADR-0034 #1: every receipt action locks the header first, so a line added while the receipt is
 * being posted either makes it into the posting or is refused; a posted line never misses its
 * ledger row.
 */
describe('integrity: receipt races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let worker: string;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('WH1');
    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku: '1',
      name: 'Гурил',
      categoryId: await catalog.category('Хүнс'),
      baseUomId: await catalog.uomId('PCS'),
    });
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ' })).id;
    const unit = unitOf(product, 'PCS').id;
    const http = () => request(app.getHttpServer());

    for (let round = 0; round < 6; round += 1) {
      const created = await http()
        .post('/api/v1/receipts')
        .set(bearer(worker))
        .set(idempotency())
        .send({
          warehouseId: warehouse.id,
          supplierId,
          lines: [{ productUnitId: unit, enteredQty: '1' }],
        })
        .expect(201);
      const id = (created.body as { id: number }).id;
      const [posted, added] = await Promise.all([
        http().post(`/api/v1/receipts/${id}/post`).set(bearer(worker)).set(idempotency()),
        http()
          .post(`/api/v1/receipts/${id}/lines`)
          .set(bearer(worker))
          .send({ productUnitId: unit, enteredQty: '2' }),
      ]);
      expect(posted.status).toBe(200);
      // Either the line went in before the posting locked the header, or it found it posted.
      expect([201, 409]).toContain(added.status);
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('never leaves a posted line without its ledger row', async () => {
    const { rows } = await sql.query<{ lines: string; ledger: string }>(
      `SELECT (SELECT count(*) FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id
                WHERE r.status = 'POSTED')::text AS lines,
              (SELECT count(*) FROM stock_ledger WHERE doc_type = 'GR')::text AS ledger`,
    );
    expect(rows[0]?.lines).toBe(rows[0]?.ledger);
    const { rows: receipts } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM goods_receipts WHERE status = 'POSTED'`,
    );
    expect(receipts[0]?.count).toBe('6');
  });
});
