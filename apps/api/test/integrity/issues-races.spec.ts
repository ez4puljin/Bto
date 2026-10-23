import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * Two goods issues of the last pieces on a shelf posted at once (ADR-0081): the posting locks the
 * bin's balance, so exactly one leaves and the other is refused; the shelf never goes negative.
 */
describe('integrity: goods issue races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let shelfId: number;
  const outcomes: number[][] = [];

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('WH1');
    const shelf = await inventory.bin(warehouse.id, 'A-01-01');
    shelfId = shelf.id;
    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku: '1',
      name: 'Гурил',
      categoryId: await catalog.category('Хүнс'),
      baseUomId: await catalog.uomId('PCS'),
    });
    // Receipts put the flour on its fixed shelf in its home (ADR-0099 #1).
    await inventory.homeShelf(product.id, warehouse.id, shelf.id);
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'Нийлүүлэгч' })).id;
    const http = () => request(app.getHttpServer());
    const types = (await http().get('/api/v1/issues/expense-types').set(bearer(worker)).expect(200))
      .body as { id: number }[];
    const expenseTypeId = types[0]?.id ?? 0;
    const pieces = unitOf(product, 'PCS').id;

    for (let round = 0; round < 5; round += 1) {
      // One piece on the shelf, two issues of it.
      const receipt = await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({ supplierId, lines: [{ productUnitId: pieces, enteredQty: '1' }] })
        .expect(201);
      await http()
        .post(`/api/v1/receipts/${(receipt.body as { id: number }).id}/post`)
        .set(bearer(admin))
        .set(idempotency())
        .expect(200);
      const drafts = await Promise.all(
        [0, 1].map(
          async () =>
            (
              await http()
                .post('/api/v1/issues')
                .set(bearer(worker))
                .set(idempotency())
                .send({
                  warehouseId: warehouse.id,
                  expenseTypeId,
                  recipient: { kind: 'OTHER', name: 'Оффис' },
                  lines: [{ productUnitId: pieces, enteredQty: '1', binId: shelf.id }],
                })
                .expect(201)
            ).body as { id: number },
        ),
      );
      const results = await Promise.all(
        drafts.map((draft) =>
          http().post(`/api/v1/issues/${draft.id}/post`).set(bearer(worker)).set(idempotency()),
        ),
      );
      outcomes.push(results.map((result) => result.status).sort());
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('lets exactly one issue take the last piece', () => {
    for (const outcome of outcomes) expect(outcome).toEqual([200, 409]);
  });

  it('never leaves the shelf below zero', async () => {
    const { rows } = await sql.query<{ on_hand: string }>(
      'SELECT on_hand FROM bin_stock WHERE bin_id = $1',
      [shelfId],
    );
    expect(rows.map((row) => row.on_hand)).toEqual(['0.000']);
  });
});
