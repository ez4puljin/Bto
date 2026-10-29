import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * ADR-0115: a purchase order's save locks the order and its supplier rows, so two pages that opened
 * the same empty cell never both write it — one is applied, the other reported as a conflict; and
 * a receipt's confirmations lock its header, so two keepers confirming their warehouses at once
 * post it exactly once. ADR-0118: the order page's arrivals lock the receipt, so two counts of one
 * line typed from two pages at once apply once and report the other as a conflict.
 */
describe('integrity: purchase order races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let manager: string;
  let keepers: string[];
  let supplierId: number;
  let products: ProductJson[];
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    manager = (await login(app, await seedUser(app, { roles: ['PROCUREMENT'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const warehouses = [await inventory.warehouse('RW1'), await inventory.warehouse('RW2')];
    keepers = [];
    for (const warehouse of warehouses) {
      keepers.push(
        (
          await login(
            app,
            await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [warehouse.id] }),
          )
        ).accessToken,
      );
    }
    supplierId = (await partnersApi(app, admin).supplier({ name: 'Туршилтын нийлүүлэгч' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Туршилт');
    const pcs = await catalog.uomId('PCS');
    products = [];
    for (const [index, warehouse] of warehouses.entries()) {
      const product = await catalog.product({
        sku: `95${index}`,
        name: `Туршилтын бараа ${index}`,
        categoryId: category,
        baseUomId: pcs,
      });
      await inventory.setHome(product.id, warehouse.id);
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId: product.id, supplierId })
        .expect(201);
      products.push(product);
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  const newOrder = async () =>
    (
      (
        await http()
          .post('/api/v1/purchase-orders')
          .set(bearer(manager))
          .set(idempotency())
          .send({ supplierIds: [supplierId] })
          .expect(201)
      ).body as { id: number }
    ).id;
  const save = (id: number, product: ProductJson, qty: string) =>
    http()
      .put(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/lines`)
      .set(bearer(manager))
      .send({
        changes: [
          {
            productId: product.id,
            productUnitId: unitOf(product, 'PCS').id,
            qty,
            previousUnitId: null,
            previousQty: null,
          },
        ],
      });

  it('applies one of two saves of the same empty cell and reports the other', async () => {
    for (let round = 0; round < 5; round += 1) {
      const id = await newOrder();
      const product = products[0] as ProductJson;
      const results = await Promise.all([save(id, product, '7'), save(id, product, '9')]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      const bodies = results.map(
        (result) => result.body as { applied: number; conflicts: unknown[] },
      );
      expect(bodies.map((body) => body.applied).sort()).toEqual([0, 1]);
      expect(bodies.map((body) => body.conflicts.length).sort()).toEqual([0, 1]);
      const { rows } = await sql.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM purchase_order_lines l
           JOIN purchase_order_suppliers s ON s.id = l.order_supplier_id WHERE s.order_id = $1`,
        [id],
      );
      expect(rows[0]?.count).toBe('1');
    }
  });

  it('posts a receipt once when its two keepers confirm at the same moment', async () => {
    for (let round = 0; round < 4; round += 1) {
      const id = await newOrder();
      for (const product of products) await save(id, product, '3').expect(200);
      for (const to of ['SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED']) {
        await http()
          .post(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/status`)
          .set(bearer(manager))
          .set(idempotency())
          .send({ to })
          .expect(200);
      }
      const { rows } = await sql.query<{ receipt_id: string }>(
        `SELECT receipt_id::text FROM purchase_order_suppliers WHERE order_id = $1`,
        [id],
      );
      const receiptId = Number.parseInt(rows[0]?.receipt_id ?? '0', 10);
      const draft = (
        await http().get(`/api/v1/receipts/${receiptId}`).set(bearer(manager)).expect(200)
      ).body as { lines: { id: number; warehouseId: number }[] };
      for (const [index, line] of draft.lines.entries()) {
        await http()
          .patch(`/api/v1/receipt-lines/${line.id}`)
          .set(bearer(keepers[index] as string))
          .send({ enteredQty: '3' })
          .expect(200);
      }
      await http()
        .patch(`/api/v1/receipts/${receiptId}`)
        .set(bearer(keepers[0] as string))
        .send({ noteTotalQty: '6', noteTotalAmount: '0' })
        .expect(200);
      const confirmed = await Promise.all(
        keepers.map((token) =>
          http().post(`/api/v1/receipts/${receiptId}/post`).set(bearer(token)).set(idempotency()),
        ),
      );
      expect(confirmed.map((result) => result.status)).toEqual([200, 200]);
      const { rows: state } = await sql.query<{ status: string; ledger: string; po: string }>(
        `SELECT r.status,
                (SELECT count(*) FROM stock_ledger WHERE doc_type = 'GR' AND doc_id = r.id)::text AS ledger,
                (SELECT s.status FROM purchase_order_suppliers s WHERE s.receipt_id = r.id) AS po
           FROM goods_receipts r WHERE r.id = $1`,
        [receiptId],
      );
      expect(state[0]).toEqual({ status: 'POSTED', ledger: '2', po: 'ACCOUNTING' });
    }
  });

  it('applies one of two counts of the same receipt line typed on two order pages at once', async () => {
    for (let round = 0; round < 4; round += 1) {
      const id = await newOrder();
      await save(id, products[0] as ProductJson, '5').expect(200);
      for (const to of ['SENT', 'SHIPPING', 'IN_TRANSIT', 'ARRIVED']) {
        await http()
          .post(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/status`)
          .set(bearer(manager))
          .set(idempotency())
          .send({ to })
          .expect(200);
      }
      const { rows } = await sql.query<{ receipt_id: string }>(
        `SELECT receipt_id::text FROM purchase_order_suppliers WHERE order_id = $1`,
        [id],
      );
      const receiptId = Number.parseInt(rows[0]?.receipt_id ?? '0', 10);
      const draft = (
        await http().get(`/api/v1/receipts/${receiptId}`).set(bearer(manager)).expect(200)
      ).body as { lines: { id: number }[] };
      const lineId = draft.lines[0]?.id as number;
      const typed = (qty: string) =>
        http()
          .put(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/arrivals`)
          .set(bearer(manager))
          .send({ changes: [{ lineId, arrivedQtyBase: qty, previousArrivedQtyBase: null }] });
      const results = await Promise.all([typed('3'), typed('4')]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      const bodies = results.map(
        (result) => result.body as { applied: number; conflicts: unknown[] },
      );
      expect(bodies.map((body) => body.applied).sort()).toEqual([0, 1]);
      expect(bodies.map((body) => body.conflicts.length).sort()).toEqual([0, 1]);
      const { rows: counted } = await sql.query<{ qty_base: string }>(
        `SELECT qty_base::text FROM goods_receipt_lines WHERE id = $1`,
        [lineId],
      );
      expect(['3.000', '4.000']).toContain(counted[0]?.qty_base);
    }
  });
});
