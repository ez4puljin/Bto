import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import type { AuthContext } from '../../src/modules/identity';
import { BinsService, StockPostingService } from '../../src/modules/inventory';
import { type OrderInput, SalesOrdersService } from '../../src/modules/sales';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, staffContext } from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

/**
 * Picking under concurrency and the posting protocol for order documents (ADR-0056 #5, #6): a pick
 * all short still frees the reservations; a pick racing a submit never promises stock twice; an
 * edit racing a submit with the products in opposite order never deadlocks; the order's document
 * is neither numbered by `post()` nor posted twice. Reconciled, RESERVED level included.
 */
describe('integrity: order picking', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let db: Db;
  let orders: SalesOrdersService;
  let posting: StockPostingService;
  let actor: AuthContext;
  let wh: number;
  let shelf: number;
  let flour: ProductJson;
  let sugar: ProductJson;
  const customers: number[] = [];
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
  const confirmed = async (customerId: number, lines: [ProductJson, string][]) =>
    orders.submit(actor, (await orders.create(actor, input(customerId, lines))).id);
  const balance = async (productId: number) =>
    (
      await sql.query<{ sellable: string; reserved: string; active: string }>(
        `SELECT sellable_on_hand::text AS sellable, reserved::text AS reserved,
                (SELECT coalesce(sum(qty_base), 0)::numeric(14,3)::text FROM stock_reservations
                  WHERE product_id = $1 AND status = 'ACTIVE') AS active
           FROM warehouse_stock WHERE product_id = $1 AND lot_id IS NULL`,
        [productId],
      )
    ).rows[0];

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    db = app.get(DB);
    orders = app.get(SalesOrdersService);
    posting = app.get(StockPostingService);
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    actor = staffContext(adminUser.id, 'ADMIN');
    const admin = (await login(app, adminUser)).accessToken;
    const inventory = inventoryApi(app, admin);
    const warehouse = await inventory.warehouse('PICK-SO');
    wh = warehouse.id;
    shelf = (await inventory.bin(wh, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Бэлтгэлтийн бараа');
    const base = await catalog.uomId('PCS');
    flour = await catalog.product({
      sku: '7811',
      name: 'Гурил',
      categoryId: category,
      baseUomId: base,
    });
    sugar = await catalog.product({
      sku: '7812',
      name: 'Чихэр',
      categoryId: category,
      baseUomId: base,
    });
    for (const product of [flour, sugar]) await inventory.setHome(product.id, wh);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Бэлтгэлт');
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
          warehouseId: wh,
          reason: 'SURPLUS',
          lines: [{ productUnitId: pcs(product), enteredQty: '30', binId: shelf, unitCost: '800' }],
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
    for (const name of ['Нэг', 'Хоёр', 'Гурав', 'Дөрөв']) {
      customers.push((await partners.customer({ name })).id);
    }
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('frees the reservations of a pick that is short on every line and posts nothing', async () => {
    const order = await confirmed(customers[0] ?? 0, [[flour, '5']]);
    expect(await balance(flour.id)).toEqual({
      sellable: '30.000',
      reserved: '5.000',
      active: '5.000',
    });
    const packed = await orders.pick(actor, order.id, [
      { lineId: order.lines[0]?.id ?? 0, qty: new Decimal(0), binId: shelf },
    ]);
    expect(packed.status).toBe('PACKED');
    expect(await balance(flour.id)).toEqual({
      sellable: '30.000',
      reserved: '0.000',
      active: '0.000',
    });
    const { rows } = await sql.query(
      `SELECT 1 FROM stock_ledger WHERE doc_type = 'SO' AND doc_id = $1`,
      [order.id],
    );
    expect(rows).toHaveLength(0);
    const { rows: held } = await sql.query<{ status: string }>(
      `SELECT status FROM stock_reservations WHERE doc_type = 'SO' AND doc_id = $1`,
      [order.id],
    );
    expect(held.map((row) => row.status)).toEqual(['RELEASED']);
  });

  it('never promises the same pieces twice when a pick races a submit', async () => {
    const first = await confirmed(customers[1] ?? 0, [[sugar, '20']]);
    // 30 on the shelf, 20 reserved: a second order for 15 gets 10 whether it lands before or
    // after the pick (10 free either way), and the pick takes its 20.
    const [packed, second] = await Promise.all([
      orders.pick(actor, first.id, [
        { lineId: first.lines[0]?.id ?? 0, qty: new Decimal(20), binId: shelf },
      ]),
      confirmed(customers[2] ?? 0, [[sugar, '15']]),
    ]);
    expect(packed.lines[0]?.qtyPicked?.toFixed()).toBe('20');
    expect(second.lines[0]?.qtyApproved.toFixed()).toBe('10');
    expect(await balance(sugar.id)).toEqual({
      sellable: '10.000',
      reserved: '10.000',
      active: '10.000',
    });
    await orders.cancel(actor, second.id, 'Тест');
  });

  it('edits a reserved order while another submits the same products in opposite order', async () => {
    const edited = await confirmed(customers[3] ?? 0, [[sugar, '2']]);
    const other = await orders.create(
      actor,
      input(customers[0] ?? 0, [
        [flour, '1'],
        [sugar, '1'],
      ]),
    );
    const results = await Promise.allSettled([
      orders.update(
        actor,
        edited.id,
        input(customers[3] ?? 0, [
          [flour, '3'],
          [sugar, '2'],
        ]),
      ),
      orders.submit(actor, other.id),
    ]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    const after = await orders.get(edited.id);
    expect(after.number).toBe(edited.number);
    expect(after.lines.map((line) => line.qtyApproved.toFixed())).toEqual(['3', '2']);
    for (const id of [edited.id, other.id]) await orders.cancel(actor, id, 'Тест');
    expect(await balance(flour.id)).toMatchObject({ reserved: '0.000', active: '0.000' });
  });

  it('posts an order document without a number and refuses the same pick twice', async () => {
    const order = await confirmed(customers[1] ?? 0, [[flour, '2']]);
    const line = order.lines[0];
    if (!line) throw new Error('no line');
    const staging = (await app.get(BinsService).systemBin(wh, 'STAGING')).id;
    const movements = (qty: Decimal) =>
      [
        { movementType: 'PICK_OUT' as const, leg: 1, binId: shelf, qtyBase: qty.negated() },
        { movementType: 'PICK_IN' as const, leg: 2, binId: staging, qtyBase: qty },
      ].map((part) => ({
        ...part,
        docType: 'SO' as const,
        docId: order.id,
        docLineId: line.id,
        warehouseId: wh,
        productId: flour.id,
        enteredQty: qty,
        productUnitId: pcs(flour),
        factorSnapshot: new Decimal(1),
      }));
    const { rows: before } = await sql.query<{ n: string }>(
      `SELECT coalesce(max(last_value), 0)::text AS n FROM number_sequences WHERE scope_key = 'SO'`,
    );
    const result = await inTransaction(db, (tx) =>
      posting.post(tx, actor, {
        docs: [{ docType: 'SO', docId: order.id, external: true }],
        movements: movements(new Decimal(2)),
        reservationConsume: { docType: 'SO', docLineIds: [line.id] },
      }),
    );
    expect(result.numbers.size).toBe(0);
    const { rows: after } = await sql.query<{ n: string }>(
      `SELECT coalesce(max(last_value), 0)::text AS n FROM number_sequences WHERE scope_key = 'SO'`,
    );
    expect(after[0]?.n).toBe(before[0]?.n);
    expect(await balance(flour.id)).toMatchObject({ reserved: '0.000', active: '0.000' });
    expect(
      await codeOf(
        inTransaction(db, (tx) =>
          posting.post(tx, actor, {
            docs: [{ docType: 'SO', docId: order.id, external: true }],
            movements: movements(new Decimal(1)),
          }),
        ),
      ),
    ).toBe('ALREADY_POSTED');
    // The order is still CONFIRMED here (posted by hand): the service's own pick runs into the
    // ledger's idempotency key, so a line is never picked twice whichever way it is tried.
    expect(
      await codeOf(
        orders.pick(actor, order.id, [{ lineId: line.id, qty: new Decimal(1), binId: shelf }]),
      ),
    ).toBe('ALREADY_POSTED');
  });
});
