import type { NestExpressApplication } from '@nestjs/platform-express';
import { addDays, addMonths, businessMonthStart, businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';

interface LineJson {
  id: number;
  productId: number;
  requestedQty: string;
  shippedQtyBase: string | null;
  countedQtyBase: string | null;
  unrequested: boolean;
  receivedQtyBase: string | null;
  baseUnitId: number;
}
interface GroupJson {
  id: number;
  number: string | null;
  status: string;
  requestId: number | null;
  sourceWarehouseId: number;
  sourceWarehouseName: string;
  countReturnReason: string | null;
  lines: LineJson[];
}
interface RequestJson {
  id: number;
  destWarehouseId: number;
  destWarehouseName: string;
  status: string;
  note: string | null;
  requestedAt: string | null;
  groups: GroupJson[];
}
interface RowJson {
  productId: number;
  homeWarehouseId: number | null;
  homeOnHand: string;
  storeOnHand: string;
  lastMonthOut: string;
  units: { id: number; isBase: boolean }[];
  line: { transferId: number; lineId: number; productUnitId: number; qty: string } | null;
}
interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
}

/**
 * Transfer requests from the staff app (ADR-0116): one request for a store, grouped by the
 * products' home warehouses; each group shipped by its keeper, counted by the store and confirmed
 * by the keeper, the ledger moving at the confirmation with ADR-0035's legs.
 */
describe('transfer requests', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let seller: string;
  let keeper1: string;
  let keeper2: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let store: WarehouseJson;
  let cola: ProductJson;
  let water: ProductJson;
  let juice: ProductJson;
  let soap: ProductJson;
  const bins = {} as { A1: number; A2: number; B1: number; FLOOR: number };
  const year = businessYear(new Date());
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const box = (product: ProductJson) => unitOf(product, 'BOX').id;
  const seq = (number: string | null) => Number.parseInt((number ?? '').slice(-6), 10);

  const get = async (id: number, token = seller) =>
    (await http().get(`/api/v1/transfer-requests/${id}`).set(bearer(token)).expect(200))
      .body as RequestJson;
  const groupOf = (detail: RequestJson, warehouse: WarehouseJson) => {
    const group = detail.groups.find((row) => row.sourceWarehouseId === warehouse.id);
    if (!group) throw new Error(`no group from ${warehouse.code}`);
    return group;
  };
  const lineOf = (group: GroupJson, product: ProductJson) => {
    const line = group.lines.find((row) => row.productId === product.id);
    if (!line) throw new Error(`no line for product ${product.id}`);
    return line;
  };
  const step = (token: string, id: number, name: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/v1/transfer-requests/${id}/${name}`).set(bearer(token)).send(body);
  const groupStep = (
    token: string,
    id: number,
    name: string,
    body: Record<string, unknown> = {},
  ) => {
    const call = http().post(`/api/v1/transfers/${id}/${name}`).set(bearer(token));
    return (
      ['ship', 'receive', 'confirm', 'count-lines'].includes(name) ? call.set(idempotency()) : call
    ).send(body);
  };
  const counts = (token: string, id: number, entries: Record<string, unknown>[]) =>
    http().put(`/api/v1/transfers/${id}/counts`).set(bearer(token)).send({ entries });
  const legsOf = async (transferId: number, productId: number) => {
    const { rows } = await sql.query<{ leg: number; bin: string; qty_base: string }>(
      `SELECT l.leg, b.code AS bin, l.qty_base::text
         FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
        WHERE l.doc_type = 'TR' AND l.doc_id = $1 AND l.product_id = $2 ORDER BY l.leg`,
      [transferId, productId],
    );
    return rows.map((row) => [row.leg, row.bin, row.qty_base]);
  };
  const binQty = async (bin: number, productId: number) => {
    const { rows } = await sql.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM bin_stock WHERE bin_id = $1 AND product_id = $2`,
      [bin, productId],
    );
    return rows[0]?.on_hand ?? '0';
  };
  const stock = async (warehouseId: number, bin: number, product: ProductJson, qty: string) => {
    const created = await http()
      .post('/api/v1/adjustments')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        warehouseId,
        reason: 'SURPLUS',
        lines: [{ productUnitId: pcs(product), enteredQty: qty, binId: bin, unitCost: '1000' }],
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
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    store = await inventory.warehouse('S1', 'STORE');
    seller = (
      await login(app, await seedUser(app, { roles: ['POS_CASHIER'], warehouseIds: [store.id] }))
    ).accessToken;
    keeper1 = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh1.id] }))
    ).accessToken;
    keeper2 = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh2.id] }))
    ).accessToken;
    bins.A1 = (await inventory.bin(wh1.id, 'A-01-01')).id;
    bins.A2 = (await inventory.bin(wh1.id, 'A-02-01')).id;
    bins.B1 = (await inventory.bin(wh2.id, 'B-01-01')).id;
    bins.FLOOR = (await inventory.systemBin(store.id, 'SALESFLOOR')).id;

    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа');
    const boxUom = await catalog.uomId('BOX');
    const base = await catalog.uomId('PCS');
    const product = (sku: string, name: string) =>
      catalog.product({
        sku,
        name,
        categoryId: category,
        baseUomId: base,
        units: [{ uomId: boxUom, factorToBase: '24' }],
      });
    cola = await product('20', 'Кока кола');
    water = await product('21', 'Ус');
    juice = await product('22', 'Жүүс');
    soap = await product('23', 'Саван');
    await inventory.homeShelf(cola.id, wh1.id, bins.A1);
    await inventory.homeShelf(juice.id, wh1.id, bins.A1);
    await inventory.homeShelf(water.id, wh2.id, bins.B1);
    await stock(wh1.id, bins.A1, cola, '480');
    await stock(wh1.id, bins.A1, juice, '100');
    await stock(wh1.id, bins.A2, soap, '48');
    await stock(wh2.id, bins.B1, water, '240');
    await stock(store.id, bins.FLOOR, cola, '12');
    // Last month the till sold 2 colas at the store: a POS_SALE row with its caches, as the pos
    // module's posting leaves them (test data only; the ledger is append-only for everyone).
    const soldOn = addDays(addMonths(businessMonthStart(), -1), 14);
    await sql.query(
      `INSERT INTO stock_ledger (posted_at, effective_date, warehouse_id, bin_id, product_id, qty_base,
         unit_cost, movement_type, doc_type, doc_id, doc_line_id, leg, entered_qty, product_unit_id, factor_snapshot)
       VALUES (now(), $1::date, $2, $3, $4, -2, 1000, 'POS_SALE', 'POS', 1, 1, 1, 2, $5, 1)`,
      [soldOn, store.id, bins.FLOOR, cola.id, pcs(cola)],
    );
    await sql.query(
      `UPDATE bin_stock SET on_hand = on_hand - 2 WHERE bin_id = $1 AND product_id = $2`,
      [bins.FLOOR, cola.id],
    );
    await sql.query(
      `UPDATE warehouse_stock SET on_hand = on_hand - 2, sellable_on_hand = sellable_on_hand - 2
        WHERE warehouse_id = $1 AND product_id = $2`,
      [store.id, cola.id],
    );
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('tells each user which stores they may request for, and today', async () => {
    const context = async (token: string) =>
      (await http().get('/api/v1/transfer-requests/context').set(bearer(token)).expect(200))
        .body as { storeWarehouses: { id: number; name: string }[]; today: string };
    expect(await context(seller)).toEqual({
      storeWarehouses: [{ id: store.id, name: store.name }],
      today: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
    });
    expect((await context(keeper1)).storeWarehouses).toEqual([]);
    expect((await context(admin)).storeWarehouses).toContainEqual({
      id: store.id,
      name: store.name,
    });
  });

  it('shows the store the products with their home, both stocks and last month’s till sales', async () => {
    const page = (
      await http()
        .get('/api/v1/transfer-requests/rows')
        .query({ warehouseId: store.id, q: 'кола' })
        .set(bearer(seller))
        .expect(200)
    ).body as { data: RowJson[]; total: number; outflowFrom: string; outflowTo: string };
    expect(page.total).toBe(1);
    expect(page.data[0]).toMatchObject({
      productId: cola.id,
      homeWarehouseId: wh1.id,
      homeOnHand: '480',
      storeOnHand: '10',
      lastMonthOut: '2',
      line: null,
    });
    expect(page.data[0]?.units.map((unit) => unit.isBase)).toEqual([true, false]);
    expect(page.outflowFrom).toBe(addMonths(businessMonthStart(), -1));
    expect(page.outflowTo).toBe(addDays(businessMonthStart(), -1));
    // A keeper writes for no store; a wholesale warehouse is not a store.
    await http()
      .get('/api/v1/transfer-requests/rows')
      .query({ warehouseId: store.id })
      .set(bearer(keeper1))
      .expect(403);
    const notStore = await http()
      .get('/api/v1/transfer-requests/rows')
      .query({ warehouseId: wh1.id })
      .set(bearer(admin))
      .expect(422);
    expect((notStore.body as ProblemJson).code).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
  });

  it('walks a request from the app through two keepers to the ledger (ADR-0116)', async () => {
    // Refusals first: no home, not a store, not the seller's store.
    const noHome = await http()
      .post('/api/v1/transfer-requests')
      .set(bearer(seller))
      .set(idempotency())
      .send({
        destWarehouseId: store.id,
        lines: [{ productId: soap.id, productUnitId: pcs(soap), qty: '1' }],
      })
      .expect(409);
    expect(noHome.body as ProblemJson).toMatchObject({
      code: 'PRODUCT_NO_HOME',
      params: { productId: soap.id },
    });
    await http()
      .post('/api/v1/transfer-requests')
      .set(bearer(seller))
      .set(idempotency())
      .send({
        destWarehouseId: wh1.id,
        lines: [{ productId: cola.id, productUnitId: pcs(cola), qty: '1' }],
      })
      .expect(422);
    await http()
      .post('/api/v1/transfer-requests')
      .set(bearer(keeper1))
      .set(idempotency())
      .send({
        destWarehouseId: store.id,
        lines: [{ productId: cola.id, productUnitId: pcs(cola), qty: '1' }],
      })
      .expect(403);

    // Two home warehouses in one request: two draft groups, each under the header.
    const key = idempotency();
    const created = await http()
      .post('/api/v1/transfer-requests')
      .set(bearer(seller))
      .set(key)
      .send({
        destWarehouseId: store.id,
        note: 'Баасан гарагийн нөхөн дүүргэлт',
        lines: [
          { productId: cola.id, productUnitId: box(cola), qty: '2' },
          { productId: water.id, productUnitId: pcs(water), qty: '10' },
        ],
      })
      .expect(201);
    const draft = created.body as RequestJson;
    expect(draft).toMatchObject({
      status: 'DRAFT',
      destWarehouseName: store.name,
      note: 'Баасан гарагийн нөхөн дүүргэлт',
      requestedAt: null,
    });
    expect(
      draft.groups.map((group) => [group.sourceWarehouseId, group.status, group.number]),
    ).toEqual([
      [wh1.id, 'DRAFT', null],
      [wh2.id, 'DRAFT', null],
    ]);
    expect(groupOf(draft, wh1).requestId).toBe(draft.id);
    expect(lineOf(groupOf(draft, wh2), water).requestedQty).toBe('10');
    const replay = await http()
      .post('/api/v1/transfer-requests')
      .set(bearer(seller))
      .set(key)
      .send({
        destWarehouseId: store.id,
        note: 'Баасан гарагийн нөхөн дүүргэлт',
        lines: [
          { productId: cola.id, productUnitId: box(cola), qty: '2' },
          { productId: water.id, productUnitId: pcs(water), qty: '10' },
        ],
      })
      .expect(201);
    expect(replay.body).toEqual(created.body);
    const groups = (
      await http()
        .get('/api/v1/transfers')
        .query({ requestId: draft.id })
        .set(bearer(seller))
        .expect(200)
    ).body as { data: { id: number; requestId: number }[] };
    expect(groups.data.map((row) => row.id).sort()).toEqual(
      draft.groups.map((group) => group.id).sort(),
    );

    // Cells saved against the value the page opened with: a stale one is skipped, a product
    // without a home refused, a new product joins its home's group, a zero removes the line and
    // the group left empty is cancelled.
    const saved = (
      await http()
        .put(`/api/v1/transfer-requests/${draft.id}/lines`)
        .set(bearer(seller))
        .send({
          changes: [
            {
              productId: cola.id,
              productUnitId: box(cola),
              qty: '3',
              previousUnitId: box(cola),
              previousQty: '2',
            },
            {
              productId: water.id,
              productUnitId: pcs(water),
              qty: '11',
              previousUnitId: pcs(water),
              previousQty: '9',
            },
            {
              productId: soap.id,
              productUnitId: pcs(soap),
              qty: '1',
              previousUnitId: null,
              previousQty: null,
            },
            {
              productId: juice.id,
              productUnitId: pcs(juice),
              qty: '4',
              previousUnitId: null,
              previousQty: null,
            },
          ],
        })
        .expect(200)
    ).body as { applied: number; conflicts: unknown[]; refused: unknown[] };
    expect(saved).toEqual({
      applied: 2,
      conflicts: [{ productId: water.id, productUnitId: pcs(water), qty: '10' }],
      refused: [{ productId: soap.id, reason: 'NO_HOME' }],
    });
    await http()
      .put(`/api/v1/transfer-requests/${draft.id}/lines`)
      .set(bearer(seller))
      .send({
        changes: [
          {
            productId: water.id,
            productUnitId: null,
            qty: null,
            previousUnitId: pcs(water),
            previousQty: '10',
          },
        ],
      })
      .expect(200);
    let detail = await get(draft.id);
    expect(detail.groups.map((group) => group.sourceWarehouseId)).toEqual([wh1.id]);
    expect(groupOf(detail, wh1).lines.map((line) => [line.productId, line.requestedQty])).toEqual([
      [cola.id, '3'],
      [juice.id, '4'],
    ]);
    const { rows: cancelled } = await sql.query<{ status: string }>(
      `SELECT status FROM transfers WHERE request_id = $1 AND source_warehouse_id = $2`,
      [draft.id, wh2.id],
    );
    expect(cancelled).toEqual([{ status: 'CANCELLED' }]);
    const rows = (
      await http()
        .get('/api/v1/transfer-requests/rows')
        .query({ warehouseId: store.id, requestId: draft.id, filter: 'REQUESTED' })
        .set(bearer(seller))
        .expect(200)
    ).body as { data: RowJson[]; total: number };
    expect(rows.total).toBe(2);
    expect(rows.data.find((row) => row.productId === cola.id)?.line).toMatchObject({
      productUnitId: box(cola),
      qty: '3',
    });
    // Water again: a new group for WH2, since its first one is cancelled.
    await http()
      .put(`/api/v1/transfer-requests/${draft.id}/lines`)
      .set(bearer(seller))
      .send({
        changes: [
          {
            productId: water.id,
            productUnitId: pcs(water),
            qty: '10',
            previousUnitId: null,
            previousQty: null,
          },
        ],
      })
      .expect(200);
    detail = await get(draft.id);
    expect(detail.groups.map((group) => group.sourceWarehouseId)).toEqual([wh1.id, wh2.id]);

    // Sent: both groups numbered one after the other; taken back and sent again under them.
    const sent = (await step(seller, draft.id, 'request').expect(200)).body as RequestJson;
    expect(sent.status).toBe('REQUESTED');
    expect(sent.requestedAt).toEqual(expect.any(String));
    const first = groupOf(sent, wh1).number;
    expect(first).toMatch(new RegExp(`^TR-${year}-\\d{6}$`));
    expect(seq(groupOf(sent, wh2).number)).toBe(seq(first) + 1);
    expect((await step(seller, draft.id, 'request').expect(200)).body).toMatchObject({
      status: 'REQUESTED',
    });
    await http()
      .put(`/api/v1/transfer-requests/${draft.id}/lines`)
      .set(bearer(seller))
      .send({
        changes: [
          {
            productId: cola.id,
            productUnitId: box(cola),
            qty: '4',
            previousUnitId: box(cola),
            previousQty: '3',
          },
        ],
      })
      .expect(409);
    const reopened = (await step(seller, draft.id, 'reopen').expect(200)).body as RequestJson;
    expect(reopened).toMatchObject({ status: 'DRAFT', requestedAt: null });
    expect(reopened.groups.map((group) => [group.status, group.number])).toEqual([
      ['DRAFT', first],
      ['DRAFT', groupOf(sent, wh2).number],
    ]);
    await step(keeper1, draft.id, 'reopen').expect(403);
    const again = (await step(seller, draft.id, 'request').expect(200)).body as RequestJson;
    expect(again.groups.map((group) => group.number)).toEqual([first, groupOf(sent, wh2).number]);
    const toShip = (
      await http()
        .get('/api/v1/transfers')
        .query({ direction: 'OUTGOING', status: 'REQUESTED' })
        .set(bearer(keeper1))
        .expect(200)
    ).body as { data: { id: number }[] };
    expect(toShip.data.map((row) => row.id)).toEqual([groupOf(again, wh1).id]);

    // Each keeper ships their own group; WH1 ships the cola short (2 boxes of 3).
    const g1 = groupOf(again, wh1);
    const g2 = groupOf(again, wh2);
    await groupStep(keeper2, g1.id, 'ship').expect(403);
    const shipped1 = (
      await groupStep(keeper1, g1.id, 'ship', {
        lines: [{ lineId: lineOf(g1, cola).id, qty: '2' }],
      }).expect(200)
    ).body as GroupJson;
    expect(lineOf(shipped1, cola).shippedQtyBase).toBe('48');
    expect(lineOf(shipped1, juice).shippedQtyBase).toBe('4');
    expect((await get(draft.id)).status).toBe('REQUESTED');
    // The store cannot take the request back once a group is shipped, nor withdraw it.
    expect((await step(seller, draft.id, 'reopen').expect(200)).body).toMatchObject({
      groups: [
        expect.objectContaining({ status: 'SHIPPED' }),
        expect.objectContaining({ status: 'DRAFT' }),
      ],
    });
    await step(seller, draft.id, 'request').expect(200);
    expect((await step(seller, draft.id, 'cancel').expect(409)).body).toMatchObject({
      code: 'DOC_STATE_INVALID',
    });
    await groupStep(keeper2, g2.id, 'ship').expect(200);
    expect((await get(draft.id)).status).toBe('SHIPPED');
    expect((await step(seller, draft.id, 'reopen').expect(409)).body).toMatchObject({
      code: 'DOC_STATE_INVALID',
    });

    // The store counts WH1's group: 44 colas (4 short), no juice at all, 3 soaps nobody asked for.
    await counts(keeper1, g1.id, [{ lineId: lineOf(g1, cola).id, qty: '44' }]).expect(403);
    const partly = (
      await counts(seller, g1.id, [
        { lineId: lineOf(g1, cola).id, productUnitId: pcs(cola), qty: '44' },
      ]).expect(200)
    ).body as GroupJson;
    expect(lineOf(partly, cola).countedQtyBase).toBe('44');
    expect(lineOf(partly, juice).countedQtyBase).toBeNull();
    expect((await groupStep(seller, g1.id, 'finish-count').expect(409)).body).toMatchObject({
      code: 'TRANSFER_LINES_UNCOUNTED',
      params: { count: 1 },
    });
    await counts(seller, g1.id, [{ lineId: lineOf(g1, juice).id, qty: '0' }]).expect(200);
    const extraKey = idempotency();
    const withSoap = await http()
      .post(`/api/v1/transfers/${g1.id}/count-lines`)
      .set(bearer(seller))
      .set(extraKey)
      .send({ productId: soap.id, productUnitId: pcs(soap), qty: '3' })
      .expect(200);
    expect(
      (
        await http()
          .post(`/api/v1/transfers/${g1.id}/count-lines`)
          .set(bearer(seller))
          .set(extraKey)
          .send({ productId: soap.id, productUnitId: pcs(soap), qty: '3' })
          .expect(200)
      ).body,
    ).toEqual(withSoap.body);
    const soapLine = lineOf(withSoap.body as GroupJson, soap);
    expect(soapLine).toMatchObject({
      unrequested: true,
      requestedQty: '0',
      shippedQtyBase: '0',
      countedQtyBase: '3',
    });
    const counted1 = (await groupStep(seller, g1.id, 'finish-count').expect(200)).body as GroupJson;
    expect(counted1.status).toBe('COUNTED');
    expect((await get(draft.id)).status).toBe('SHIPPED');
    const attention = async (token: string) =>
      (await http().get('/api/v1/inventory/attention').set(bearer(token)).expect(200)).body as {
        transfersToConfirm: number;
        transfersToReceive: number;
      };
    expect(await attention(keeper1)).toMatchObject({ transfersToConfirm: 1 });
    expect(await attention(keeper2)).toMatchObject({ transfersToConfirm: 0 });
    expect(await attention(seller)).toMatchObject({ transfersToReceive: 1, transfersToConfirm: 0 });

    // WH1's keeper confirms: the shortfall returns to the shelf, the juice goes back whole, the soap
    // leaves its shelf for the store. Nobody else may confirm; a request is never received directly.
    await groupStep(keeper2, g1.id, 'confirm').expect(403);
    await groupStep(seller, g1.id, 'confirm').expect(403);
    expect((await groupStep(seller, g1.id, 'receive').expect(409)).body).toMatchObject({
      code: 'DOC_STATE_INVALID',
    });
    const confirmKey = idempotency();
    const confirmed = await http()
      .post(`/api/v1/transfers/${g1.id}/confirm`)
      .set(bearer(keeper1))
      .set(confirmKey)
      .send({})
      .expect(200);
    expect(confirmed.body as GroupJson).toMatchObject({ status: 'RECEIVED' });
    expect(
      (
        await http()
          .post(`/api/v1/transfers/${g1.id}/confirm`)
          .set(bearer(keeper1))
          .set(confirmKey)
          .send({})
          .expect(200)
      ).body,
    ).toEqual(confirmed.body);
    expect(await legsOf(g1.id, cola.id)).toEqual([
      [1, 'A-01-01', '-48.000'],
      [2, 'TRANSIT', '48.000'],
      [3, 'TRANSIT', '-48.000'],
      [4, 'SALESFLOOR', '44.000'],
      [6, 'A-01-01', '4.000'],
    ]);
    expect(await legsOf(g1.id, juice.id)).toEqual([
      [1, 'A-01-01', '-4.000'],
      [2, 'TRANSIT', '4.000'],
      [3, 'TRANSIT', '-4.000'],
      [6, 'A-01-01', '4.000'],
    ]);
    expect(await legsOf(g1.id, soap.id)).toEqual([
      [5, 'A-02-01', '-3.000'],
      [6, 'SALESFLOOR', '3.000'],
    ]);
    expect(await binQty(bins.A1, cola.id)).toBe('436.000');
    expect(await binQty(bins.A1, juice.id)).toBe('100.000');
    expect(await binQty(bins.A2, soap.id)).toBe('45.000');
    expect(await binQty(bins.FLOOR, soap.id)).toBe('3.000');
    expect((await get(draft.id)).status).toBe('SHIPPED');

    // WH2's group: 12 bottles arrived (2 extra); its keeper confirms and the request is received.
    await counts(seller, g2.id, [{ lineId: lineOf(g2, water).id, qty: '12' }]).expect(200);
    await groupStep(seller, g2.id, 'finish-count').expect(200);
    await groupStep(keeper1, g2.id, 'confirm').expect(403);
    await groupStep(keeper2, g2.id, 'confirm').expect(200);
    expect(await legsOf(g2.id, water.id)).toEqual([
      [1, 'B-01-01', '-10.000'],
      [2, 'TRANSIT', '10.000'],
      [3, 'TRANSIT', '-10.000'],
      [4, 'SALESFLOOR', '10.000'],
      [5, 'B-01-01', '-2.000'],
      [6, 'SALESFLOOR', '2.000'],
    ]);
    const done = await get(draft.id);
    expect(done.status).toBe('RECEIVED');
    expect(done.groups.map((group) => group.status)).toEqual(['RECEIVED', 'RECEIVED']);

    const list = (
      await http()
        .get('/api/v1/transfer-requests')
        .query({ warehouseId: store.id })
        .set(bearer(seller))
        .expect(200)
    ).body as {
      data: {
        id: number;
        status: string;
        groupCount: number;
        lineCount: number;
        numbers: string[];
      }[];
    };
    expect(list.data.find((row) => row.id === draft.id)).toMatchObject({
      status: 'RECEIVED',
      groupCount: 2,
      lineCount: 4,
      numbers: [first, groupOf(sent, wh2).number],
    });
    // The direction alone means the seller's own store; the keeper sees none there.
    const mine = (await http().get('/api/v1/transfer-requests').set(bearer(keeper1)).expect(200))
      .body as { data: unknown[] };
    expect(mine.data).toEqual([]);

    const { rows: audit } = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'transfer_requests' AND entity_id = $1 ORDER BY id`,
      [String(draft.id)],
    );
    expect(audit.map((row) => row.action)).toEqual([
      'CREATE',
      'UPDATE',
      'UPDATE',
      'UPDATE',
      'REQUEST',
      'RETURN',
      'REQUEST',
      'RETURN',
      'REQUEST',
    ]);
  });

  it('cancels a request as a whole while nothing is shipped, and refuses an empty one', async () => {
    const draft = (
      await http()
        .post('/api/v1/transfer-requests')
        .set(bearer(seller))
        .set(idempotency())
        .send({
          destWarehouseId: store.id,
          lines: [{ productId: cola.id, productUnitId: pcs(cola), qty: '6' }],
        })
        .expect(201)
    ).body as RequestJson;
    await http()
      .put(`/api/v1/transfer-requests/${draft.id}/lines`)
      .set(bearer(seller))
      .send({
        changes: [
          {
            productId: cola.id,
            productUnitId: null,
            qty: null,
            previousUnitId: pcs(cola),
            previousQty: '6',
          },
        ],
      })
      .expect(200);
    expect((await step(seller, draft.id, 'request').expect(409)).body).toMatchObject({
      code: 'TRANSFER_REQUEST_EMPTY',
    });
    // Still a draft: it can be filled again.
    expect((await get(draft.id)).status).toBe('DRAFT');
    const sent = (
      await http()
        .post('/api/v1/transfer-requests')
        .set(bearer(seller))
        .set(idempotency())
        .send({
          destWarehouseId: store.id,
          lines: [{ productId: cola.id, productUnitId: pcs(cola), qty: '6' }],
        })
        .expect(201)
    ).body as RequestJson;
    await step(seller, sent.id, 'request').expect(200);
    await step(keeper1, sent.id, 'cancel').expect(403);
    const cancelled = (
      await step(seller, sent.id, 'cancel', { reason: 'Хэрэггүй болсон' }).expect(200)
    ).body as RequestJson;
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.groups).toEqual([]);
    const { rows } = await sql.query<{ status: string; cancel_reason: string }>(
      `SELECT status, cancel_reason FROM transfers WHERE request_id = $1`,
      [sent.id],
    );
    expect(rows).toEqual([{ status: 'CANCELLED', cancel_reason: 'Хэрэггүй болсон' }]);
  });
});
