import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';

interface TransferLineJson {
  id: number;
  productId: number;
  requestUnitId: number;
  unitName: string;
  requestFactor: string;
  requestedQty: string;
  baseUnitId: number;
  baseUnitName: string;
  shippedQtyBase: string | null;
  receivedQtyBase: string | null;
  fromBinId: number | null;
  fromBinCode: string | null;
  toBinId: number | null;
  toBinCode: string | null;
}
interface TransferJson {
  id: number;
  number: string | null;
  origin: string;
  status: string;
  sourceWarehouseId: number;
  destWarehouseId: number;
  shipDate: string | null;
  receiveDate: string | null;
  cancelReason: string | null;
  lines: TransferLineJson[];
}
interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
  errors?: { path: string; constraint: string }[];
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysOf(nested)]);
  }
  return [];
}

/** Two-step transfers through TRANSIT: SPEC §5.4, §6.5, ADR-0035 (owner answers 2026-10-11). */
describe('transfers', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let clerk: string;
  let wh1Worker: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let store: WarehouseJson;
  let cola: ProductJson;
  let water: ProductJson;
  let soap: ProductJson;
  const bins: Record<string, number> = {};
  const year = businessYear(new Date());
  const http = () => request(app.getHttpServer());

  const binId = (code: string) => {
    const id = bins[code];
    if (id === undefined) throw new Error(`no bin ${code}`);
    return id;
  };
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const box = (product: ProductJson) => unitOf(product, 'BOX').id;
  const lineOf = (transfer: TransferJson, product: ProductJson) => {
    const line = transfer.lines.find((row) => row.productId === product.id);
    if (!line) throw new Error(`no line for product ${product.id}`);
    return line;
  };

  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/transfers').set(bearer(token)).set(idempotency()).send(body);
  const step = (token: string, id: number, name: string, body: Record<string, unknown> = {}) => {
    const call = http().post(`/api/v1/transfers/${id}/${name}`).set(bearer(token));
    return (name === 'ship' || name === 'receive' ? call.set(idempotency()) : call).send(body);
  };
  const requested = async (token: string, body: Record<string, unknown>) => {
    const draft = (await create(token, { origin: 'REQUEST', ...body }).expect(201))
      .body as TransferJson;
    return (await step(token, draft.id, 'request').expect(200)).body as TransferJson;
  };

  const binQty = async (bin: number, productId: number) => {
    const { rows } = await sql.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM bin_stock WHERE bin_id = $1 AND product_id = $2`,
      [bin, productId],
    );
    return rows[0]?.on_hand ?? '0';
  };
  const stockOf = async (warehouseId: number, productId: number) => {
    const { rows } = await sql.query<{ on_hand: string; sellable: string; avg_cost: string }>(
      `SELECT on_hand::text, sellable_on_hand::text AS sellable, avg_cost::text FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId],
    );
    return rows[0] ?? { on_hand: '0', sellable: '0', avg_cost: '0' };
  };
  const legsOf = async (transferId: number, productId: number) => {
    const { rows } = await sql.query<{
      movement_type: string;
      leg: number;
      bin: string;
      qty_base: string;
      unit_cost: string;
    }>(
      `SELECT l.movement_type, l.leg, b.code AS bin, l.qty_base::text, l.unit_cost::text
         FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
        WHERE l.doc_type = 'TR' AND l.doc_id = $1 AND l.product_id = $2 ORDER BY l.leg`,
      [transferId, productId],
    );
    return rows;
  };
  /** Quantity and value left in TRANSIT per transfer line (ADR-0035 #4: always zero once received). */
  const transitLeft = async (transferId: number) => {
    const { rows } = await sql.query<{ qty: string; value: string }>(
      `SELECT coalesce(sum(l.qty_base), 0)::text AS qty,
              coalesce(sum(l.qty_base * l.unit_cost), 0)::text AS value
         FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
        WHERE l.doc_type = 'TR' AND l.doc_id = $1 AND b.type = 'TRANSIT'`,
      [transferId],
    );
    return rows[0];
  };
  /** Opening stock through an approved surplus adjustment, at a known cost. */
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
    worker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    store = await inventory.warehouse('STORE1', 'STORE');
    // The supermarket's sales clerk: transfers only, written for the store alone (ADR-0035 #2).
    clerk = (
      await login(app, await seedUser(app, { roles: ['POS_CASHIER'], warehouseIds: [store.id] }))
    ).accessToken;
    wh1Worker = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh1.id] }))
    ).accessToken;
    for (const code of ['A-01-01', 'A-01-02', 'A-02-01']) {
      bins[code] = (await inventory.bin(wh1.id, code)).id;
    }
    bins.WH1_RECEIVING = (await inventory.systemBin(wh1.id, 'RECEIVING')).id;
    bins.WH2_RECEIVING = (await inventory.systemBin(wh2.id, 'RECEIVING')).id;
    bins.SALESFLOOR = (await inventory.systemBin(store.id, 'SALESFLOOR')).id;
    bins.STORE_SHELF = (await inventory.bin(store.id, 'S-01-01')).id;

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
    cola = await product('10', 'Кока кола');
    water = await product('11', 'Ус');
    soap = await product('12', 'Саван');
    await inventory.setHome(cola.id, wh1.id);
    await inventory.setHome(water.id, wh1.id);
    for (const [item, code] of [
      [cola, 'A-01-01'],
      [water, 'A-01-02'],
    ] as const) {
      await http()
        .put('/api/v1/product-locations')
        .set(bearer(admin))
        .send({ warehouseId: wh1.id, productId: item.id, defaultBinId: binId(code) })
        .expect(200);
    }
    await stock(wh1.id, binId('A-01-01'), cola, '480');
    await stock(wh1.id, binId('A-01-02'), water, '240');
    await stock(wh1.id, binId('A-02-01'), water, '24');
    await stock(wh1.id, binId('A-02-01'), soap, '48');
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('requests goods for the supermarket, ships them from the fixed shelf and receives them sellable', async () => {
    const draft = (
      await create(clerk, {
        origin: 'REQUEST',
        sourceWarehouseId: wh1.id,
        destWarehouseId: store.id,
        note: 'Баасан гарагийн нөхөн дүүргэлт',
        lines: [{ productUnitId: box(cola), qty: '2' }],
      }).expect(201)
    ).body as TransferJson;
    expect(draft).toMatchObject({ status: 'DRAFT', number: null, origin: 'REQUEST' });
    expect(lineOf(draft, cola)).toMatchObject({
      unitName: expect.any(String),
      requestFactor: '24',
      requestedQty: '2',
      shippedQtyBase: null,
      fromBinCode: 'A-01-01',
    });

    const sent = (await step(clerk, draft.id, 'request').expect(200)).body as TransferJson;
    expect(sent).toMatchObject({ status: 'REQUESTED', number: `TR-${year}-000001` });
    // The clerk writes only for the store: shipping belongs to the sender.
    const refused = await step(clerk, draft.id, 'ship').expect(403);
    expect((refused.body as ProblemJson).params).toMatchObject({ reason: 'WAREHOUSE_SCOPE' });

    const shipped = (await step(worker, draft.id, 'ship').expect(200)).body as TransferJson;
    expect(shipped).toMatchObject({ status: 'SHIPPED', number: `TR-${year}-000001` });
    expect(shipped.shipDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lineOf(shipped, cola)).toMatchObject({
      shippedQtyBase: '48',
      fromBinCode: 'A-01-01',
      toBinCode: 'SALESFLOOR',
    });
    expect(await legsOf(draft.id, cola.id)).toEqual([
      {
        movement_type: 'TRANSFER_OUT',
        leg: 1,
        bin: 'A-01-01',
        qty_base: '-48.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 2,
        bin: 'TRANSIT',
        qty_base: '48.000',
        unit_cost: '1000.0000',
      },
    ]);
    expect(await stockOf(store.id, cola.id)).toMatchObject({ on_hand: '0' });

    const received = (await step(clerk, draft.id, 'receive').expect(200)).body as TransferJson;
    expect(received).toMatchObject({ status: 'RECEIVED' });
    expect(lineOf(received, cola)).toMatchObject({
      receivedQtyBase: '48',
      toBinCode: 'SALESFLOOR',
    });
    expect((await legsOf(draft.id, cola.id)).slice(2)).toEqual([
      {
        movement_type: 'TRANSFER_OUT',
        leg: 3,
        bin: 'TRANSIT',
        qty_base: '-48.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 4,
        bin: 'SALESFLOOR',
        qty_base: '48.000',
        unit_cost: '1000.0000',
      },
    ]);
    expect(await stockOf(store.id, cola.id)).toEqual({
      on_hand: '48.000',
      sellable: '48.000',
      avg_cost: '1000.0000',
    });
    expect(await binQty(binId('A-01-01'), cola.id)).toBe('432.000');
    expect(await transitLeft(draft.id)).toEqual({ qty: '0.000', value: '0.0000000' });
    // Costs never leave the server on transfers.
    expect(keysOf(received).filter((key) => /cost/i.test(key))).toEqual([]);

    const { rows: audit } = await sql.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity = 'transfers' AND entity_id = $1 ORDER BY id`,
      [String(draft.id)],
    );
    expect(audit.map((row) => row.action)).toEqual(['CREATE', 'REQUEST', 'SHIP', 'RECEIVE']);
  });

  it('returns a shortfall to the sender’s shelf and takes a surplus out of the sender’s stock', async () => {
    const sent = await requested(clerk, {
      sourceWarehouseId: wh1.id,
      destWarehouseId: store.id,
      lines: [
        { productUnitId: box(cola), qty: '2' },
        { productUnitId: pcs(water), qty: '10' },
      ],
    });
    const shipped = (await step(worker, sent.id, 'ship').expect(200)).body as TransferJson;
    expect(lineOf(shipped, water)).toMatchObject({ shippedQtyBase: '10', fromBinCode: 'A-01-02' });

    // One box and 20 pieces of cola arrived (4 short); 12 bottles of water (2 extra).
    const received = (
      await step(clerk, sent.id, 'receive', {
        lines: [
          { lineId: lineOf(shipped, cola).id, productUnitId: pcs(cola), qty: '44' },
          { lineId: lineOf(shipped, water).id, qty: '12' },
        ],
      }).expect(200)
    ).body as TransferJson;
    expect(lineOf(received, cola).receivedQtyBase).toBe('44');
    expect(lineOf(received, water).receivedQtyBase).toBe('12');
    expect((await legsOf(sent.id, cola.id)).slice(2)).toEqual([
      {
        movement_type: 'TRANSFER_OUT',
        leg: 3,
        bin: 'TRANSIT',
        qty_base: '-48.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 4,
        bin: 'SALESFLOOR',
        qty_base: '44.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 6,
        bin: 'A-01-01',
        qty_base: '4.000',
        unit_cost: '1000.0000',
      },
    ]);
    expect((await legsOf(sent.id, water.id)).slice(2)).toEqual([
      {
        movement_type: 'TRANSFER_OUT',
        leg: 3,
        bin: 'TRANSIT',
        qty_base: '-10.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 4,
        bin: 'SALESFLOOR',
        qty_base: '10.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_OUT',
        leg: 5,
        bin: 'A-01-02',
        qty_base: '-2.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 6,
        bin: 'SALESFLOOR',
        qty_base: '2.000',
        unit_cost: '1000.0000',
      },
    ]);
    expect(await binQty(binId('A-01-01'), cola.id)).toBe('388.000');
    expect(await binQty(binId('A-01-02'), water.id)).toBe('228.000');
    expect(await stockOf(store.id, water.id)).toMatchObject({
      on_hand: '12.000',
      sellable: '12.000',
    });
    expect(await transitLeft(sent.id)).toEqual({ qty: '0.000', value: '0.0000000' });
  });

  it('returns everything to the sender when nothing arrives, and takes a surplus from the fullest shelf', async () => {
    const sent = await requested(clerk, {
      sourceWarehouseId: wh1.id,
      destWarehouseId: store.id,
      lines: [
        { productUnitId: pcs(cola), qty: '6' },
        { productUnitId: pcs(soap), qty: '1' },
        { productUnitId: pcs(water), qty: '1' },
      ],
    });
    // Soap has no fixed shelf in WH1: the sender scans the shelf it takes it from.
    const unscanned = await step(worker, sent.id, 'ship').expect(422);
    expect((unscanned.body as ProblemJson).errors?.[0]).toMatchObject({ constraint: 'required' });
    const shipped = (
      await step(worker, sent.id, 'ship', {
        lines: [
          { lineId: lineOf(sent, soap).id, binId: binId('A-02-01') },
          { lineId: lineOf(sent, water).id, binId: binId('A-02-01') },
        ],
      }).expect(200)
    ).body as TransferJson;
    expect(lineOf(shipped, soap)).toMatchObject({ shippedQtyBase: '1', fromBinCode: 'A-02-01' });

    // No cola arrived; 29 bottles of water too many: more than its shelf A-02-01 still holds (23).
    await step(clerk, sent.id, 'receive', {
      lines: [
        { lineId: lineOf(shipped, cola).id, qty: '0' },
        { lineId: lineOf(shipped, water).id, qty: '30' },
      ],
    }).expect(200);
    expect((await legsOf(sent.id, cola.id)).slice(2)).toEqual([
      {
        movement_type: 'TRANSFER_OUT',
        leg: 3,
        bin: 'TRANSIT',
        qty_base: '-6.000',
        unit_cost: '1000.0000',
      },
      {
        movement_type: 'TRANSFER_IN',
        leg: 6,
        bin: 'A-01-01',
        qty_base: '6.000',
        unit_cost: '1000.0000',
      },
    ]);
    expect((await legsOf(sent.id, soap.id)).map((row) => [row.leg, row.bin, row.qty_base])).toEqual(
      [
        [1, 'A-02-01', '-1.000'],
        [2, 'TRANSIT', '1.000'],
        [3, 'TRANSIT', '-1.000'],
        [4, 'SALESFLOOR', '1.000'],
      ],
    );
    expect(
      (await legsOf(sent.id, water.id)).map((row) => [row.leg, row.bin, row.qty_base]),
    ).toEqual([
      [1, 'A-02-01', '-1.000'],
      [2, 'TRANSIT', '1.000'],
      [3, 'TRANSIT', '-1.000'],
      [4, 'SALESFLOOR', '1.000'],
      [5, 'A-01-02', '-29.000'],
      [6, 'SALESFLOOR', '29.000'],
    ]);
    expect(await binQty(binId('A-01-01'), cola.id)).toBe('388.000');
    expect(await binQty(binId('A-02-01'), water.id)).toBe('23.000');
    expect(await binQty(binId('A-01-02'), water.id)).toBe('199.000');
    expect(await transitLeft(sent.id)).toEqual({ qty: '0.000', value: '0.0000000' });
  });

  it('refuses a product homed elsewhere into a wholesale warehouse, never into the store', async () => {
    const refused = await create(admin, {
      origin: 'REQUEST',
      sourceWarehouseId: wh1.id,
      destWarehouseId: wh2.id,
      lines: [{ productUnitId: box(cola), qty: '1' }],
    }).expect(409);
    expect(refused.body as ProblemJson).toMatchObject({ code: 'PRODUCT_NOT_IN_WAREHOUSE' });
    // Soap has no home: any wholesale warehouse may take it.
    const allowed = await requested(admin, {
      sourceWarehouseId: wh1.id,
      destWarehouseId: wh2.id,
      lines: [{ productUnitId: pcs(soap), qty: '2' }],
    });
    // Its home is set after the request: shipping checks again.
    await inventoryApi(app, admin).setHome(soap.id, wh1.id);
    const blocked = await step(worker, allowed.id, 'ship', {
      lines: [{ lineId: lineOf(allowed, soap).id, binId: binId('A-02-01') }],
    }).expect(409);
    expect((blocked.body as ProblemJson).code).toBe('PRODUCT_NOT_IN_WAREHOUSE');
    await step(admin, allowed.id, 'cancel', { reason: 'Харьяа агуулах өөрчлөгдсөн' }).expect(200);
    await inventoryApi(app, admin).setHome(soap.id, null);
  });

  it('lets the supermarket push its returns, numbered when shipped and received at the fixed shelf', async () => {
    const push = (
      await create(clerk, {
        origin: 'PUSH',
        sourceWarehouseId: store.id,
        destWarehouseId: wh1.id,
        lines: [{ productUnitId: pcs(cola), qty: '4' }],
      }).expect(201)
    ).body as TransferJson;
    expect(lineOf(push, cola).fromBinCode).toBe('SALESFLOOR');
    const notRequested = await step(clerk, push.id, 'request').expect(422);
    expect((notRequested.body as ProblemJson).errors?.[0]).toMatchObject({ path: 'origin' });

    const shipped = (await step(clerk, push.id, 'ship').expect(200)).body as TransferJson;
    expect(shipped.number).toMatch(new RegExp(`^TR-${year}-\\d{6}$`));
    expect(lineOf(shipped, cola).toBinCode).toBe('A-01-01');
    // The store's clerk cannot receive at the warehouse; its worker can.
    await step(clerk, push.id, 'receive').expect(403);
    await step(wh1Worker, push.id, 'receive').expect(200);
    expect((await legsOf(push.id, cola.id)).map((row) => [row.leg, row.bin, row.qty_base])).toEqual(
      [
        [1, 'SALESFLOOR', '-4.000'],
        [2, 'TRANSIT', '4.000'],
        [3, 'TRANSIT', '-4.000'],
        [4, 'A-01-01', '4.000'],
      ],
    );
  });

  it('keeps every step to its side and its state', async () => {
    // The clerk asks only for the store.
    await create(clerk, {
      origin: 'REQUEST',
      sourceWarehouseId: wh1.id,
      destWarehouseId: wh2.id,
      lines: [],
    }).expect(403);
    const same = await create(admin, {
      origin: 'REQUEST',
      sourceWarehouseId: wh1.id,
      destWarehouseId: wh1.id,
    }).expect(422);
    expect((same.body as ProblemJson).code).toBe('VALIDATION_FAILED');

    const draft = (
      await create(clerk, {
        origin: 'REQUEST',
        sourceWarehouseId: wh1.id,
        destWarehouseId: store.id,
        lines: [{ productUnitId: pcs(water), qty: '5' }],
      }).expect(201)
    ).body as TransferJson;
    const duplicate = await http()
      .post(`/api/v1/transfers/${draft.id}/lines`)
      .set(bearer(clerk))
      .send({ productUnitId: box(water), qty: '1' })
      .expect(422);
    expect((duplicate.body as ProblemJson).errors?.[0]).toMatchObject({ constraint: 'duplicate' });
    const edited = (
      await http()
        .patch(`/api/v1/transfer-lines/${lineOf(draft, water).id}`)
        .set(bearer(clerk))
        .send({ productUnitId: box(water), qty: '1' })
        .expect(200)
    ).body as TransferJson;
    expect(lineOf(edited, water)).toMatchObject({ requestedQty: '1', requestFactor: '24' });
    // The source cannot ship a request that was never sent.
    expect((await step(worker, draft.id, 'ship').expect(409)).body).toMatchObject({
      code: 'DOC_STATE_INVALID',
    });
    await step(clerk, draft.id, 'request').expect(200);
    // A sent request is frozen.
    await http()
      .patch(`/api/v1/transfer-lines/${lineOf(draft, water).id}`)
      .set(bearer(clerk))
      .send({ qty: '2' })
      .expect(409);
    // Nothing shipped is refused; the source declines with a reason, which keeps the number.
    const nothing = await step(worker, draft.id, 'ship', {
      lines: [{ lineId: lineOf(draft, water).id, qty: '0' }],
    }).expect(409);
    expect((nothing.body as ProblemJson).code).toBe('TRANSFER_NOTHING_SHIPPED');
    await step(wh1Worker, draft.id, 'cancel').expect(422);
    const declined = (
      await step(wh1Worker, draft.id, 'cancel', { reason: 'Үлдэгдэл хүрэлцэхгүй' }).expect(200)
    ).body as TransferJson;
    expect(declined).toMatchObject({ status: 'CANCELLED', cancelReason: 'Үлдэгдэл хүрэлцэхгүй' });
    expect(declined.number).toMatch(/^TR-/);
    await step(worker, draft.id, 'ship').expect(409);

    // Shipped once; a retried click replays, a second shipment is refused; a shipment is never cancelled.
    const sent = await requested(clerk, {
      sourceWarehouseId: wh1.id,
      destWarehouseId: store.id,
      lines: [{ productUnitId: pcs(water), qty: '3' }],
    });
    const key = idempotency();
    const first = await http()
      .post(`/api/v1/transfers/${sent.id}/ship`)
      .set(bearer(worker))
      .set(key)
      .send({})
      .expect(200);
    const replay = await http()
      .post(`/api/v1/transfers/${sent.id}/ship`)
      .set(bearer(worker))
      .set(key)
      .send({})
      .expect(200);
    expect(replay.body).toEqual(first.body);
    expect((await step(worker, sent.id, 'ship').expect(409)).body).toMatchObject({
      code: 'DOC_ALREADY_POSTED',
    });
    expect((await step(clerk, sent.id, 'cancel').expect(409)).body).toMatchObject({
      code: 'DOC_STATE_INVALID',
    });
    // A count must be exact in base units.
    const inexact = await step(clerk, sent.id, 'receive', {
      lines: [{ lineId: lineOf(sent, water).id, productUnitId: box(water), qty: '0.3' }],
    }).expect(422);
    expect((inexact.body as ProblemJson).code).toBe('UNIT_FACTOR_INEXACT');
    await step(clerk, sent.id, 'receive').expect(200);
    expect((await step(clerk, sent.id, 'receive').expect(409)).body).toMatchObject({
      code: 'DOC_ALREADY_POSTED',
    });

    const incoming = await http()
      .get('/api/v1/transfers')
      .query({ warehouseId: store.id, direction: 'INCOMING', status: 'RECEIVED' })
      .set(bearer(clerk))
      .expect(200);
    const rows = (incoming.body as { data: { destWarehouseId: number; lineCount: number }[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.destWarehouseId === store.id && row.lineCount > 0)).toBe(true);
    const outgoing = await http()
      .get('/api/v1/transfers')
      .query({ warehouseId: store.id, direction: 'OUTGOING' })
      .set(bearer(clerk))
      .expect(200);
    expect(
      (outgoing.body as { data: { sourceWarehouseId: number }[] }).data.every(
        (row) => row.sourceWarehouseId === store.id,
      ),
    ).toBe(true);
  });
});
