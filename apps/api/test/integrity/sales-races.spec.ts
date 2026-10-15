import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { systemActor } from '../../src/modules/identity';
import { type OrderInput, SalesOrdersService } from '../../src/modules/sales';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

/**
 * Orders confirming together (SPEC §5.7, §6.4 #4, ADR-0055): the last pieces are never promised
 * twice — whoever locks the stock row first takes them, the others are backordered — and orders
 * whose lines name the same products in opposite order never deadlock. Reservations match the
 * cache afterwards (the reconciliation's RESERVED level).
 */
describe('integrity: sales orders', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let orders: SalesOrdersService;
  let flour: ProductJson;
  let sugar: ProductJson;
  const customers: number[] = [];
  const actor = systemActor('sales-races');
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;

  const input = (customerId: number, lines: [ProductJson, string][]): OrderInput => ({
    customerId,
    fulfilment: 'PICKUP',
    deliveryDate: addDays(businessDate(), 1),
    addressId: null,
    contactName: null,
    contactPhone: null,
    paymentMethod: 'CASH',
    note: null,
    lines: lines.map(([product, qty]) => ({ productUnitId: pcs(product), qty: new Decimal(qty) })),
  });

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    orders = app.get(SalesOrdersService);
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const wh = await inventory.warehouse('RACE-SO');
    const bin = await inventory.bin(wh.id, 'A-01-01');
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Уралдааны бараа');
    const base = await catalog.uomId('PCS');
    flour = await catalog.product({
      sku: '7801',
      name: 'Гурил',
      categoryId: category,
      baseUomId: base,
    });
    sugar = await catalog.product({
      sku: '7802',
      name: 'Элсэн чихэр',
      categoryId: category,
      baseUomId: base,
    });
    for (const product of [flour, sugar]) await inventory.setHome(product.id, wh.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Уралдаан');
    await pricing.terms(flour.id, '1000', profile, null);
    await pricing.terms(sugar.id, '1000', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [flour.id, sugar.id] })
      .expect(200);
    for (const product of [flour, sugar]) {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          reason: 'SURPLUS',
          lines: [
            { productUnitId: pcs(product), enteredQty: '30', binId: bin.id, unitCost: '800' },
          ],
        })
        .expect(201);
      const id = (created.body as { id: number }).id;
      await http().post(`/api/v1/adjustments/${id}/submit`).set(bearer(admin)).expect(200);
      await http()
        .post(`/api/v1/adjustments/${id}/post`)
        .set(bearer(admin))
        .set(idempotency())
        .send({})
        .expect(200);
    }
    const partners = partnersApi(app, admin);
    for (const name of ['Нэг', 'Хоёр', 'Гурав'])
      customers.push((await partners.customer({ name })).id);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('never reserves more than is available when orders confirm together', async () => {
    const drafts = await Promise.all([
      orders.create(actor, input(customers[0] ?? 0, [[flour, '20']])),
      orders.create(actor, input(customers[1] ?? 0, [[flour, '20']])),
      orders.create(actor, input(customers[0] ?? 0, [[flour, '20']])),
    ]);
    const confirmed = await Promise.all(drafts.map((draft) => orders.submit(actor, draft.id)));
    const approved = confirmed.map((order) => order.lines[0]?.qtyApproved.toFixed() ?? '');
    expect(approved.reduce((sum, qty) => sum + Number.parseInt(qty, 10), 0)).toBe(30);
    expect([...approved].sort()).toEqual(['0', '10', '20']);
    const { rows } = await sql.query<{ reserved: string; held: string }>(
      `SELECT (SELECT reserved FROM warehouse_stock WHERE product_id = $1 AND lot_id IS NULL)::text AS reserved,
              (SELECT sum(qty_base) FROM stock_reservations WHERE product_id = $1 AND status = 'ACTIVE')::text AS held`,
      [flour.id],
    );
    expect(rows[0]).toEqual({ reserved: '30.000', held: '30.000' });
  });

  it('confirms orders naming the same products in opposite order without a deadlock', async () => {
    const first = await orders.create(
      actor,
      input(customers[1] ?? 0, [
        [sugar, '5'],
        [flour, '1'],
      ]),
    );
    const second = await orders.create(
      actor,
      input(customers[2] ?? 0, [
        [flour, '1'],
        [sugar, '5'],
      ]),
    );
    const results = await Promise.allSettled([
      orders.submit(actor, first.id),
      orders.submit(actor, second.id),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    // Cancelling all of them gives every piece back.
    const { rows } = await sql.query<{ id: string }>(
      `SELECT id::text FROM sales_orders WHERE status = 'CONFIRMED'`,
    );
    await Promise.all(rows.map((row) => orders.cancel(actor, Number.parseInt(row.id, 10), 'Тест')));
    const { rows: left } = await sql.query<{ reserved: string }>(
      `SELECT coalesce(sum(reserved), 0)::text AS reserved FROM warehouse_stock
        WHERE product_id = ANY($1)`,
      [[flour.id, sugar.id]],
    );
    expect(left[0]?.reserved).toBe('0.000');
  });
});
