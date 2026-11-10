import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
}
interface StageJson {
  id: number;
  name: string;
  archivedAt: string | null;
}
interface PipelineJson {
  id: number;
  stages: StageJson[];
}
interface PartJson {
  warehouseId: number;
  status: string;
}
interface ExcludedJson {
  id: number;
  productId: number;
  qty: string;
  originalQty: string | null;
  total: string | null;
  excludedByName: string | null;
}
interface ChangeJson {
  fields?: { field: string; before: string | null; after: string | null }[];
  lines: { kind: string; productName: string }[];
}
type DetailJson = Omit<OrderJson, 'lines'> & {
  updatedAt: string;
  picks: PartJson[];
  excludedLines: ExcludedJson[];
  changes: ChangeJson[];
  lines: {
    id: number;
    productId: number;
    qty: string;
    originalQty: string | null;
    total: string | null;
    qtyPicked: string | null;
  }[];
};
interface CardJson {
  id: number;
  total: string | null;
  lineCount: number;
  excluded: { count: number; total: string; lines: { productName: string; qty: string }[] };
}

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
});

/**
 * The board's «Засвар» (ADR-0175): a keeper changes their own warehouse's lines in place — a
 * quantity at the order's old price, a line taken off and kept in red, put back with its frozen
 * prices, a product added at today's — never another warehouse's, never a confirmed part unless a
 * lead, never over a newer change. Reservations follow; the books reconcile. Synthetic data.
 */
describe('sales line edits from the board', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let keeperA: string;
  let lead: string;
  let whA: WarehouseJson;
  let whB: WarehouseJson;
  let shelfA: number;
  let cola: ProductJson;
  let juice: ProductJson;
  let beer: ProductJson;
  let shop: CustomerJson;
  let pipeline: PipelineJson;
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const stage = (name: string) => {
    const found = pipeline.stages.find((entry) => entry.name === name && !entry.archivedAt);
    if (!found) throw new Error(`no stage ${name}`);
    return found;
  };
  const move = (token: string, orderId: number, stageName: string) =>
    http()
      .post(`/api/v1/sales-orders/${orderId}/move`)
      .set(bearer(token))
      .set(idempotency())
      .send({ stageId: stage(stageName).id });
  const part = (token: string, orderId: number, warehouseId: number, verb: string, body = {}) =>
    http()
      .post(`/api/v1/sales-orders/${orderId}/picks/${warehouseId}/${verb}`)
      .set(bearer(token))
      .set(idempotency())
      .send(body);
  const detail = async (token: string, id: number) =>
    (await http().get(`/api/v1/sales-orders/${id}`).set(bearer(token)).expect(200))
      .body as DetailJson;
  const edit = (
    token: string,
    order: DetailJson,
    body: {
      lines?: { lineId: number; qty: string }[];
      exclude?: number[];
      restore?: { excludedId: number; qty?: string | null }[];
      add?: { productUnitId: number; qty: string }[];
    },
  ) =>
    http()
      .patch(`/api/v1/sales-orders/${order.id}/lines`)
      .set(bearer(token))
      .send({
        expectedUpdatedAt: order.updatedAt,
        lines: body.lines ?? [],
        exclude: body.exclude ?? [],
        restore: body.restore ?? [],
        add: body.add ?? [],
      });
  const lineOf = (order: DetailJson, product: ProductJson) => {
    const line = order.lines.find((entry) => entry.productId === product.id);
    if (!line) throw new Error(`no line of ${product.sku}`);
    return line;
  };
  const reserved = async (orderId: number, productId: number) =>
    (
      await sql.query<{ qty: string }>(
        `SELECT coalesce(sum(qty_base), 0)::text AS qty FROM stock_reservations
          WHERE doc_type = 'SO' AND doc_id = $1 AND product_id = $2 AND status = 'ACTIVE'`,
        [orderId, productId],
      )
    ).rows[0]?.qty;
  const card = async (token: string, orderId: number) => {
    const stages = (
      await http()
        .get(`/api/v1/sales-pipelines/${pipeline.id}/cards`)
        .set(bearer(token))
        .expect(200)
    ).body as { cards: CardJson[] }[];
    return stages.flatMap((entry) => entry.cards).find((entry) => entry.id === orderId);
  };
  /** A reserved order of cola (warehouse A) and beer (warehouse B), priced a day ago. */
  const reservedOrder = async (colaQty = '5', beerQty = '3') => {
    const draft = await salesApi(app, admin).draft(
      orderBody(
        shop.id,
        [
          { productUnitId: pcs(cola), qty: colaQty },
          { productUnitId: pcs(beer), qty: beerQty },
        ],
        { pipelineId: pipeline.id },
      ),
    );
    await move(admin, draft.id, 'Нөөцлөх').expect(200);
    return detail(admin, draft.id);
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    whA = await inventory.warehouse('LEA');
    whB = await inventory.warehouse('LEB');
    shelfA = (await inventory.bin(whA.id, 'A-01-01')).id;
    const shelfB = (await inventory.bin(whB.id, 'B-01-01')).id;
    keeperA = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [whA.id] }))
    ).accessToken;
    const leadRole = (
      (
        await http()
          .post('/api/v1/roles')
          .set(bearer(admin))
          .send({
            name: 'Засварын ахлах',
            permissions: ['sales.orders.read', 'sales.orders.pick', 'sales.orders.pickLead'],
          })
          .expect(201)
      ).body as { id: number }
    ).id;
    const leadUser = await seedUser(app, { roles: [], warehouseIds: [whA.id, whB.id] });
    await http()
      .patch(`/api/v1/users/${leadUser.id}`)
      .set(bearer(admin))
      .send({ roleIds: [leadRole] })
      .expect((res) => {
        if (res.status >= 300) throw new Error(`roles ${res.status} ${JSON.stringify(res.body)}`);
      });
    lead = (await login(app, leadUser)).accessToken;

    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Засварын бараа');
    const base = await catalog.uomId('PCS');
    const product = (sku: string, name: string) =>
      catalog.product({ sku, name, categoryId: category, baseUomId: base });
    cola = await product('7931', 'Кола засвар');
    juice = await product('7932', 'Шүүс засвар');
    beer = await product('7933', 'Пиво засвар');
    await inventory.setHome(cola.id, whA.id);
    await inventory.setHome(juice.id, whA.id);
    await inventory.setHome(beer.id, whB.id);
    // Today's prices; cola's goes up tomorrow, the day one order below is priced on.
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Засвар: Ундаа');
    await pricing.terms(cola.id, '1000', profile, null);
    await pricing.terms(juice.id, '700', profile, null);
    await pricing.terms(beer.id, '2000', profile, null);
    await pricing.terms(cola.id, '1500', profile, null, addDays(businessDate(), 1));
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, juice.id, beer.id] })
      .expect(200);
    for (const [item, wh, shelf] of [
      [cola, whA, shelfA],
      [juice, whA, shelfA],
      [beer, whB, shelfB],
    ] as const) {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          reason: 'SURPLUS',
          lines: [{ productUnitId: pcs(item), enteredQty: '50', binId: shelf, unitCost: '500' }],
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
    shop = await partnersApi(app, admin).customer({ name: 'Засварын дэлгүүр' });
    const board = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Засвар' })
          .expect(201)
      ).body as { id: number }
    ).id;
    pipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({
          boardId: board,
          name: 'Засварын борлуулалт',
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          kind: 'SALES',
          roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
          stages: [
            stageBody('Ирсэн', 'NONE'),
            stageBody('Нөөцлөх', 'CONFIRM'),
            stageBody('Бэлдэх', 'PICK'),
            stageBody('Борлуулалт', 'SALE'),
          ],
        })
        .expect(201)
    ).body as PipelineJson;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it("changes a keeper's own quantity at the order's old price, never another warehouse's", async () => {
    let order = await reservedOrder();
    // As if the order had been priced tomorrow, at cola's new 1500: a changed line keeps the
    // order's price date, not today's 1000.
    await sql.query(
      `UPDATE sales_orders SET price_date = $2, total = total + 2500, subtotal = subtotal + 2500
        WHERE id = $1`,
      [order.id, addDays(businessDate(), 1)],
    );
    await sql.query(
      `UPDATE sales_order_lines SET subtotal = 7500, total = 7500 - discount_amount
        WHERE order_id = $1 AND product_id = $2`,
      [order.id, cola.id],
    );
    order = await detail(admin, order.id);
    const before = order.total;
    // Keeper A may not touch warehouse B's beer.
    const forbidden = await edit(keeperA, await detail(keeperA, order.id), {
      lines: [{ lineId: lineOf(order, beer).id, qty: '1' }],
    }).expect(403);
    expect((forbidden.body as ProblemJson).code).toBe('FORBIDDEN');
    const seen = await detail(keeperA, order.id);
    const changed = (
      await edit(keeperA, seen, { lines: [{ lineId: lineOf(seen, cola).id, qty: '3' }] }).expect(
        200,
      )
    ).body as DetailJson;
    const colaLine = lineOf(changed, cola);
    expect(colaLine.qty).toBe('3');
    expect(colaLine.id).toBe(lineOf(seen, cola).id);
    expect(colaLine.total).toBe('4500');
    expect(await reserved(order.id, cola.id)).toBe('3.000');
    const after = await detail(admin, order.id);
    expect(after.total).toBe(String(Number(before) - 3000));
    expect(after.changes.at(-1)?.lines.map((line) => line.kind)).toEqual(['CHANGED']);
  });

  it('takes a line off in red, puts it back with its prices and adds a product at today’s', async () => {
    const order = await reservedOrder('4', '2');
    const colaTotal = lineOf(order, cola).total;
    const seen = await detail(keeperA, order.id);
    const off = (await edit(keeperA, seen, { exclude: [lineOf(seen, cola).id] }).expect(200))
      .body as DetailJson;
    expect(off.lines.map((line) => line.productId)).toEqual([]);
    expect(off.excludedLines).toMatchObject([{ productId: cola.id, qty: '4', total: colaTotal }]);
    expect(await reserved(order.id, cola.id)).toBe('0');
    const shown = await card(admin, order.id);
    expect(shown?.excluded).toMatchObject({ count: 1, total: colaTotal ?? '' });
    expect(shown?.excluded.lines[0]?.productName).toBe('Кола засвар');
    expect(shown?.lineCount).toBe(1);
    expect((await detail(admin, order.id)).total).toBe('4000');
    // Back with its frozen total; juice added at today's price in its home warehouse A.
    const back = (
      await edit(keeperA, off, {
        restore: [{ excludedId: off.excludedLines[0]?.id ?? 0 }],
        add: [{ productUnitId: pcs(juice), qty: '2' }],
      }).expect(200)
    ).body as DetailJson;
    expect(back.excludedLines).toEqual([]);
    expect(lineOf(back, cola).total).toBe(colaTotal);
    expect(lineOf(back, juice).total).toBe('1400');
    expect(await reserved(order.id, juice.id)).toBe('2.000');
    // Beer's home is B: keeper A cannot add it.
    const refused = await edit(keeperA, back, {
      add: [{ productUnitId: pcs(beer), qty: '1' }],
    }).expect(403);
    expect((refused.body as ProblemJson).code).toBe('FORBIDDEN');
    const kinds = (await detail(admin, order.id)).changes.flatMap((change) =>
      change.lines.map((line) => line.kind),
    );
    expect(kinds).toEqual(expect.arrayContaining(['REMOVED', 'ADDED']));
  });

  it('refuses a stale save, an order left empty and a confirmed part unless a lead', async () => {
    const order = await reservedOrder('6', '1');
    const seen = await detail(keeperA, order.id);
    await edit(keeperA, seen, { lines: [{ lineId: lineOf(seen, cola).id, qty: '5' }] }).expect(200);
    const stale = await edit(keeperA, seen, {
      lines: [{ lineId: lineOf(seen, cola).id, qty: '4' }],
    }).expect(409);
    expect((stale.body as ProblemJson).code).toBe('ORDER_CHANGED');
    const all = await detail(admin, order.id);
    const empty = await edit(admin, all, {
      exclude: all.lines.map((line) => line.id),
    }).expect(422);
    expect((empty.body as ProblemJson).code).toBe('VALIDATION_FAILED');
    // Keeper A picks and confirms warehouse A's part; their edit is refused, the lead's opens it.
    await move(admin, order.id, 'Бэлдэх').expect(200);
    await part(keeperA, order.id, whA.id, 'take').expect(200);
    const picking = await detail(keeperA, order.id);
    await part(keeperA, order.id, whA.id, 'pick', {
      lines: [{ lineId: lineOf(picking, cola).id, qty: '5', binId: shelfA }],
    }).expect(200);
    const done = await detail(keeperA, order.id);
    const refused = await edit(keeperA, done, {
      lines: [{ lineId: lineOf(done, cola).id, qty: '2' }],
    }).expect(409);
    expect((refused.body as ProblemJson).code).toBe('LINE_EDIT_PART_DONE');
    expect((refused.body as ProblemJson).params?.warehouse).toBe(whA.name);
    const byLead = (
      await edit(lead, await detail(lead, order.id), {
        lines: [{ lineId: lineOf(done, cola).id, qty: '2' }],
      }).expect(200)
    ).body as DetailJson;
    expect(byLead.picks.find((entry) => entry.warehouseId === whA.id)?.status).toBe('OPEN');
    expect(lineOf(byLead, cola).qtyPicked).toBeNull();
    expect(await reserved(order.id, cola.id)).toBe('2.000');
  });

  it('keeps every line’s first ordered quantity across edits, a take-off and a rewrite (ADR-0178)', async () => {
    const sales = salesApi(app, admin);
    const draft = await sales.draft(
      orderBody(
        shop.id,
        [
          { productUnitId: pcs(cola), qty: '5' },
          { productUnitId: pcs(beer), qty: '3' },
        ],
        { pipelineId: pipeline.id },
      ),
    );
    // A draft is still being written: its last quantities are the first order.
    await sales
      .update(
        draft.id,
        orderBody(
          shop.id,
          [
            { productUnitId: pcs(cola), qty: '4' },
            { productUnitId: pcs(beer), qty: '3' },
          ],
          { pipelineId: pipeline.id },
        ),
      )
      .expect(200);
    await move(admin, draft.id, 'Нөөцлөх').expect(200);
    let order = await detail(keeperA, draft.id);
    expect(lineOf(order, cola).originalQty).toBe('4');

    // 4 → 10 → 12: the first order stays 4, also when the order is read again.
    order = (
      await edit(keeperA, order, { lines: [{ lineId: lineOf(order, cola).id, qty: '10' }] }).expect(
        200,
      )
    ).body as DetailJson;
    expect(lineOf(order, cola)).toMatchObject({ qty: '10', originalQty: '4' });
    order = await detail(keeperA, order.id);
    await edit(keeperA, order, { lines: [{ lineId: lineOf(order, cola).id, qty: '12' }] }).expect(
      200,
    );
    order = await detail(admin, order.id);
    expect(lineOf(order, cola)).toMatchObject({ qty: '12', originalQty: '4' });

    // Taken off, the beer keeps its 3; a product added now has none.
    order = (
      await edit(admin, order, {
        exclude: [lineOf(order, beer).id],
        add: [{ productUnitId: pcs(juice), qty: '2' }],
      }).expect(200)
    ).body as DetailJson;
    const [beerOff] = order.excludedLines;
    expect(beerOff).toMatchObject({ productId: beer.id, originalQty: '3' });
    expect(lineOf(order, juice).originalQty).toBeNull();

    // Put back at 1, it is still the 3 first ordered.
    order = (
      await edit(admin, order, {
        restore: [{ excludedId: beerOff?.id ?? 0, qty: '1' }],
      }).expect(200)
    ).body as DetailJson;
    expect(lineOf(order, beer)).toMatchObject({ qty: '1', originalQty: '3' });

    // The office's whole-order save rewrites the lines and carries the first quantities over.
    const rewritten = (
      await sales
        .update(
          order.id,
          orderBody(
            shop.id,
            [
              { productUnitId: pcs(cola), qty: '7' },
              { productUnitId: pcs(beer), qty: '1' },
              { productUnitId: pcs(juice), qty: '2' },
            ],
            { pipelineId: pipeline.id, expectedUpdatedAt: order.updatedAt },
          ),
        )
        .expect(200)
    ).body as DetailJson;
    expect(lineOf(rewritten, cola)).toMatchObject({ qty: '7', originalQty: '4' });
    expect(lineOf(rewritten, beer).originalQty).toBe('3');
    expect(lineOf(rewritten, juice).originalQty).toBeNull();
    const stored = await sql.query<{ product_id: string; original_qty: string | null }>(
      `SELECT product_id::text, original_qty::text FROM sales_order_lines WHERE order_id = $1
        ORDER BY product_id`,
      [order.id],
    );
    // Cola, juice and beer were created in that order.
    expect(stored.rows).toEqual([
      { product_id: String(cola.id), original_qty: '4.000' },
      { product_id: String(juice.id), original_qty: null },
      { product_id: String(beer.id), original_qty: '3.000' },
    ]);
  });

  it("lets the accountant change a reserved or picking order's customer and payment, credit checked (ADR-0180)", async () => {
    const accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] })))
      .accessToken;
    const partners = partnersApi(app, admin);
    const other = await partners.customer({ name: 'Нягтлангийн дэлгүүр' });
    const held = await partners.customer({ name: 'Хоригтой дэлгүүр' });
    await http()
      .put(`/api/v1/customers/${held.id}/credit`)
      .set(bearer(accountant))
      .send({
        creditLimit: null,
        settlementGroup: 'DAY_20',
        creditHold: true,
        creditHoldReason: 'Шалгалт',
      })
      .expect(200);
    const party = (token: string, order: DetailJson, body: Record<string, unknown>) =>
      http()
        .patch(`/api/v1/sales-orders/${order.id}/party`)
        .set(bearer(token))
        .send({ expectedUpdatedAt: order.updatedAt, ...body });

    let order = await reservedOrder('2', '1');
    expect(order.status).toBe('CONFIRMED');
    const total = order.total;
    await party(keeperA, order, { customerId: other.id, paymentMethod: 'CASH' }).expect(403);
    await party(
      accountant,
      { ...order, updatedAt: new Date(0).toISOString() },
      {
        customerId: other.id,
        paymentMethod: 'CASH',
      },
    ).expect(409);
    // A customer on hold refuses the order's total; nothing changes.
    const blocked = (
      await party(accountant, order, { customerId: held.id, paymentMethod: 'CASH' }).expect(409)
    ).body as ProblemJson;
    expect(blocked.code).toBe('CREDIT_BLOCKED');
    expect((await detail(admin, order.id)).customerId).toBe(shop.id);

    order = (
      await party(accountant, order, {
        customerId: other.id,
        paymentMethod: 'BANK_TRANSFER',
      }).expect(200)
    ).body as DetailJson;
    expect(order.customerId).toBe(other.id);
    expect(order.paymentMethod).toBe('BANK_TRANSFER');
    expect(order.total).toBe(total);
    expect(await reserved(order.id, cola.id)).toBe('2.000');
    const fields = order.changes.at(-1)?.fields?.map((entry) => entry.field) ?? [];
    expect(fields).toEqual(expect.arrayContaining(['customer', 'paymentMethod']));

    // Picking: the payment still changes; a cancelled order no longer does.
    await move(admin, order.id, 'Бэлдэх').expect(200);
    order = await detail(admin, order.id);
    expect(order.status).toBe('PICKING');
    order = (
      await party(accountant, order, { customerId: other.id, paymentMethod: 'CASH' }).expect(200)
    ).body as DetailJson;
    expect(order.paymentMethod).toBe('CASH');
    const draft = await salesApi(app, admin).draft(
      orderBody(shop.id, [{ productUnitId: pcs(juice), qty: '1' }], { pipelineId: pipeline.id }),
    );
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/cancel`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ reason: 'Туршилт' })
      .expect(200);
    const cancelled = await detail(admin, draft.id);
    const late = (
      await party(accountant, cancelled, { customerId: other.id, paymentMethod: 'CASH' }).expect(
        409,
      )
    ).body as ProblemJson;
    expect(late.code).toBe('ORDER_STATE_INVALID');
  });
});
