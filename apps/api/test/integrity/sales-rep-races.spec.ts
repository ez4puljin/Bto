import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, salesApi } from '../harness/sales';
import { repApi, repOrderBody } from '../harness/sales-rep';

/**
 * ADR-0061 #6: reps' orders landing on a CONFIRM stage reserve in the same transaction as they are
 * created, through the same locks as the office's submit (pipeline and stage FOR SHARE, customer,
 * stock rows in key order, the number counter last): racing them never reserves more than the
 * shelf holds, never deadlocks and never gives one number twice.
 */
describe('integrity: sales-rep order races', () => {
  let app: NestExpressApplication;
  let sql: Client;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('reserves at most the stock when five reps and the office confirm at once', async () => {
    const http = () => request(app.getHttpServer());
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    const reps: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      reps.push((await login(app, await seedUser(app, { roles: ['SALES_REP'] }))).accessToken);
    }
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('RR1');
    const shelf = (await inventory.bin(wh.id, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const product = await catalog.product({
      sku: '7971',
      name: 'Сүү',
      categoryId: await catalog.category('Уралдааны бараа'),
      baseUomId: await catalog.uomId('PCS'),
    });
    const pcs = unitOf(product, 'PCS').id;
    await inventory.setHome(product.id, wh.id);
    const pricing = pricingApi(app, admin);
    await pricing.terms(product.id, '1500', await pricing.profile('Уралдаан: Сүү'), null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [product.id] })
      .expect(200);
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId: wh.id,
        reason: 'SURPLUS',
        lines: [{ productUnitId: pcs, enteredQty: '30', binId: shelf, unitCost: '1000' }],
      })
      .expect(201);
    const adjustment = (created.body as { id: number }).id;
    await http().post(`/api/v1/adjustments/${adjustment}/submit`).set(bearer(admin)).expect(200);
    await http()
      .post(`/api/v1/adjustments/${adjustment}/post`)
      .set(bearer(admin))
      .set(idempotency())
      .send({})
      .expect(200);
    const shop = await partnersApi(app, admin).customer({ name: 'Уралдааны дэлгүүр' });
    const boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Уралдаан' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const pipelineId = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({
          boardId,
          name: 'Уралдааны борлуулалт',
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
          stages: [
            {
              name: 'Нярав Хяналт',
              action: 'CONFIRM',
              printPickList: false,
              printDeliveryNote: false,
              roles: { VIEW: [], EDIT: [], MOVE: [] },
            },
          ],
        })
        .expect(201)
    ).body as { id?: number; pipeline?: { id: number } };
    const id = pipelineId.pipeline?.id ?? pipelineId.id ?? 0;
    const confirmStage = (
      (await http().get(`/api/v1/sales-pipelines/${id}`).set(bearer(admin)).expect(200)).body as {
        stages: { id: number }[];
      }
    ).stages[0]?.id;
    if (confirmStage === undefined) throw new Error('no stage');
    const draft = await salesApi(app, office).draft(
      orderBody(shop.id, [{ productUnitId: pcs, qty: '10' }]),
    );

    const lines = [{ productUnitId: pcs, qty: '10' }];
    const responses = await Promise.all([
      ...reps.map((token) => repApi(app, token).create(repOrderBody(confirmStage, shop.id, lines))),
      salesApi(app, office).submit(draft.id),
    ]);
    expect(responses.map((response) => response.status)).toEqual([201, 201, 201, 201, 201, 200]);

    const { rows } = await sql.query<{ approved: string; backordered: string; numbers: string }>(
      `SELECT sum(l.qty_approved)::text AS approved, sum(l.qty_backordered)::text AS backordered,
              count(DISTINCT o.number)::text AS numbers
         FROM sales_orders o JOIN sales_order_lines l ON l.order_id = o.id
        WHERE l.product_id = $1 AND o.status = 'CONFIRMED'`,
      [product.id],
    );
    expect(rows).toEqual([{ approved: '30.000', backordered: '30.000', numbers: '6' }]);
    const stock = await sql.query<{ reserved: string }>(
      'SELECT reserved::text FROM warehouse_stock WHERE product_id = $1 AND warehouse_id = $2',
      [product.id, wh.id],
    );
    expect(stock.rows).toEqual([{ reserved: '30.000' }]);
  });
});
