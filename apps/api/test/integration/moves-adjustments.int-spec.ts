import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface MoveJson {
  id: number;
  number: string | null;
  status: string;
  lines: { fromBinCode: string; toBinCode: string; qtyBase: string }[];
}
interface AdjustmentJson {
  id: number;
  number: string | null;
  status: string;
  reason: string;
  lines: { id: number; qtyBase: string; binCode: string }[];
}
interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysOf(nested)]);
  }
  return [];
}

/** Bin moves (BM-) and adjustments (ADJ-): SPEC §5.4, owner answers 2026-10-11. */
describe('bin moves and adjustments', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let cola: ProductJson;
  let rice: ProductJson;
  const bins: Record<string, number> = {};
  const year = businessYear(new Date());
  const http = () => request(app.getHttpServer());

  const move = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/bin-moves').set(bearer(token)).set(idempotency()).send(body);
  const adjust = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/adjustments').set(bearer(token)).set(idempotency()).send(body);
  const action = (token: string, id: number, name: string, body: Record<string, unknown> = {}) => {
    const call = http().post(`/api/v1/adjustments/${id}/${name}`).set(bearer(token));
    return (name === 'post' ? call.set(idempotency()) : call).send(body);
  };
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const binId = (code: string) => {
    const id = bins[code];
    if (id === undefined) throw new Error(`no bin ${code}`);
    return id;
  };
  const binQty = async (bin: number, productId: number) => {
    const { rows } = await sql.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM bin_stock WHERE bin_id = $1 AND product_id = $2`,
      [bin, productId],
    );
    return rows[0]?.on_hand ?? '0';
  };
  const warehouseQty = async (warehouseId: number, productId: number) => {
    const { rows } = await sql.query<{ on_hand: string; avg_cost: string }>(
      `SELECT on_hand::text, avg_cost::text FROM warehouse_stock
        WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, productId],
    );
    return rows[0];
  };
  const ledgerOf = async (docType: string, docId: number) => {
    const { rows } = await sql.query<{
      movement_type: string;
      leg: number;
      qty_base: string;
      unit_cost: string;
    }>(
      `SELECT movement_type, leg, qty_base::text, unit_cost::text FROM stock_ledger
        WHERE doc_type = $1 AND doc_id = $2 ORDER BY id`,
      [docType, docId],
    );
    return rows;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    for (const code of ['A-01-01', 'A-01-02']) bins[code] = (await inventory.bin(wh1.id, code)).id;
    bins.RECEIVING = (await inventory.systemBin(wh1.id, 'RECEIVING')).id;
    bins.WH2 = (await inventory.bin(wh2.id, 'B-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа');
    const box = await catalog.uomId('BOX');
    const base = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: category,
      baseUomId: base,
      units: [{ uomId: box, factorToBase: '24' }],
    });
    rice = await catalog.product({
      sku: '11',
      name: 'Будаа',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(cola.id, wh1.id);

    // 2 boxes of cola into the receiving area (no fixed shelf yet), costed at 1 000 a piece.
    const supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(worker))
      .set(idempotency())
      .send({
        supplierId,
        lines: [{ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2' }],
      })
      .expect(201);
    const receiptId = (receipt.body as { id: number }).id;
    await http()
      .post(`/api/v1/receipts/${receiptId}/post`)
      .set(bearer(worker))
      .set(idempotency())
      .expect(200);
    const lineId = (receipt.body as { lines: { id: number }[] }).lines[0]?.id;
    await http()
      .put(`/api/v1/receipts/${receiptId}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ costingVersion: 0, lines: [{ lineId, amount: '48000' }] })
      .expect(200);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('puts goods away and moves them between shelves without changing the warehouse total', async () => {
    const putaway = await move(worker, {
      warehouseId: wh1.id,
      lines: [
        {
          productUnitId: unitOf(cola, 'BOX').id,
          enteredQty: '1',
          fromBinId: bins.RECEIVING,
          toBinId: bins['A-01-01'],
        },
      ],
    }).expect(201);
    const first = putaway.body as MoveJson;
    expect(first).toMatchObject({ status: 'POSTED', number: `BM-${year}-000001` });
    expect(first.lines).toEqual([
      expect.objectContaining({ fromBinCode: 'RECEIVING', toBinCode: 'A-01-01', qtyBase: '24' }),
    ]);
    expect(await ledgerOf('BM', first.id)).toEqual([
      { movement_type: 'PUTAWAY_OUT', leg: 1, qty_base: '-24.000', unit_cost: '1000.0000' },
      { movement_type: 'PUTAWAY_IN', leg: 2, qty_base: '24.000', unit_cost: '1000.0000' },
    ]);

    const shelfMove = await move(worker, {
      warehouseId: wh1.id,
      note: 'Доод тавиур руу',
      lines: [
        {
          productUnitId: pcs(cola),
          enteredQty: '12',
          fromBinId: bins['A-01-01'],
          toBinId: bins['A-01-02'],
        },
      ],
    }).expect(201);
    const second = shelfMove.body as MoveJson;
    expect(second.number).toBe(`BM-${year}-000002`);
    expect((await ledgerOf('BM', second.id)).map((row) => row.movement_type)).toEqual([
      'BIN_MOVE_OUT',
      'BIN_MOVE_IN',
    ]);
    expect(await binQty(binId('RECEIVING'), cola.id)).toBe('24.000');
    expect(await binQty(binId('A-01-01'), cola.id)).toBe('12.000');
    expect(await binQty(binId('A-01-02'), cola.id)).toBe('12.000');
    expect((await warehouseQty(wh1.id, cola.id))?.on_hand).toBe('48.000');

    const list = await http()
      .get('/api/v1/bin-moves')
      .query({ warehouseId: wh1.id })
      .set(bearer(worker))
      .expect(200);
    expect((list.body as { data: { id: number; lineCount: number }[] }).data).toEqual([
      expect.objectContaining({ id: second.id, lineCount: 1 }),
      expect.objectContaining({ id: first.id, lineCount: 1 }),
    ]);
    await http().get(`/api/v1/bin-moves/${first.id}`).set(bearer(worker)).expect(200);
  });

  it('refuses a move beyond the shelf stock, to the same bin or across warehouses', async () => {
    const tooMuch = await move(worker, {
      warehouseId: wh1.id,
      lines: [
        {
          productUnitId: pcs(cola),
          enteredQty: '13',
          fromBinId: bins['A-01-02'],
          toBinId: bins['A-01-01'],
        },
      ],
    }).expect(409);
    expect(tooMuch.body as ProblemJson).toMatchObject({
      code: 'STOCK_INSUFFICIENT',
      params: { binCode: 'A-01-02', available: '12', requested: '13' },
    });
    const line = { productUnitId: pcs(cola), enteredQty: '1', fromBinId: bins['A-01-01'] };
    await move(worker, {
      warehouseId: wh1.id,
      lines: [{ ...line, toBinId: bins['A-01-01'] }],
    }).expect(422);
    await move(worker, { warehouseId: wh1.id, lines: [{ ...line, toBinId: bins.WH2 }] }).expect(
      422,
    );
    await move(worker, { warehouseId: wh1.id, lines: [] }).expect(422);
    // The refused moves used no number.
    const next = await move(worker, {
      warehouseId: wh1.id,
      lines: [{ ...line, toBinId: bins['A-01-02'] }],
    }).expect(201);
    expect((next.body as MoveJson).number).toBe(`BM-${year}-000003`);
  });

  it('lets the warehouse submit a write-off and only an approver post it', async () => {
    const created = await adjust(worker, {
      warehouseId: wh1.id,
      reason: 'DAMAGED',
      note: 'Савны ёроол цоорсон',
      lines: [{ productUnitId: pcs(cola), enteredQty: '2', binId: bins['A-01-01'] }],
    }).expect(201);
    const draft = created.body as AdjustmentJson;
    expect(draft).toMatchObject({ status: 'DRAFT', number: null, reason: 'DAMAGED' });
    await action(admin, draft.id, 'post').expect(409);
    const submitted = await action(worker, draft.id, 'submit').expect(200);
    expect((submitted.body as AdjustmentJson).status).toBe('SUBMITTED');
    await action(worker, draft.id, 'post').expect(403);
    // A submitted adjustment is frozen for the approver.
    await http()
      .patch(`/api/v1/adjustment-lines/${draft.lines[0]?.id}`)
      .set(bearer(worker))
      .send({ enteredQty: '3' })
      .expect(409);

    const posted = await action(admin, draft.id, 'post').expect(200);
    expect(posted.body as AdjustmentJson).toMatchObject({
      status: 'POSTED',
      number: `ADJ-${year}-000001`,
    });
    expect(await ledgerOf('ADJ', draft.id)).toEqual([
      { movement_type: 'ADJUSTMENT', leg: 1, qty_base: '-2.000', unit_cost: '1000.0000' },
    ]);
    expect(await warehouseQty(wh1.id, cola.id)).toEqual({
      on_hand: '46.000',
      avg_cost: '1000.0000',
    });
    expect(keysOf(posted.body).filter((key) => /cost|amount|value|avg/i.test(key))).toEqual([]);
    await action(admin, draft.id, 'post').expect(409);
    await action(worker, draft.id, 'cancel').expect(409);
  });

  it('keeps a shortage beyond the stock submitted until the warehouse corrects it', async () => {
    const created = await adjust(worker, {
      warehouseId: wh1.id,
      reason: 'SHORTAGE',
      lines: [{ productUnitId: pcs(cola), enteredQty: '100', binId: bins['A-01-02'] }],
    }).expect(201);
    const id = (created.body as AdjustmentJson).id;
    const lineId = (created.body as AdjustmentJson).lines[0]?.id;
    await action(worker, id, 'submit').expect(200);
    const refused = await action(admin, id, 'post').expect(409);
    expect((refused.body as ProblemJson).code).toBe('STOCK_INSUFFICIENT');
    const kept = await http().get(`/api/v1/adjustments/${id}`).set(bearer(worker)).expect(200);
    expect((kept.body as AdjustmentJson).status).toBe('SUBMITTED');

    await action(worker, id, 'return').expect(403);
    const returned = await action(admin, id, 'return').expect(200);
    expect((returned.body as AdjustmentJson).status).toBe('DRAFT');
    await http()
      .patch(`/api/v1/adjustment-lines/${lineId}`)
      .set(bearer(worker))
      .send({ enteredQty: '1', note: 'Дахин тоолсон' })
      .expect(200);
    await action(worker, id, 'submit').expect(200);
    const posted = await action(admin, id, 'post').expect(200);
    expect((posted.body as AdjustmentJson).number).toBe(`ADJ-${year}-000002`);
    expect(await binQty(binId('A-01-02'), cola.id)).toBe('12.000');
  });

  it('records found goods only in the product’s home warehouse', async () => {
    const refused = await adjust(worker, {
      warehouseId: wh2.id,
      reason: 'SURPLUS',
      lines: [{ productUnitId: pcs(cola), enteredQty: '1', binId: bins.WH2 }],
    }).expect(409);
    expect((refused.body as ProblemJson).code).toBe('PRODUCT_NOT_IN_WAREHOUSE');

    // A write-off may hold the product; turning it into a surplus may not.
    const writeOff = await adjust(worker, {
      warehouseId: wh2.id,
      reason: 'EXPIRED',
      lines: [{ productUnitId: pcs(cola), enteredQty: '1', binId: bins.WH2 }],
    }).expect(201);
    const switched = await http()
      .patch(`/api/v1/adjustments/${(writeOff.body as AdjustmentJson).id}`)
      .set(bearer(worker))
      .send({ reason: 'SURPLUS' })
      .expect(409);
    expect((switched.body as ProblemJson).code).toBe('PRODUCT_NOT_IN_WAREHOUSE');
    await action(worker, (writeOff.body as AdjustmentJson).id, 'cancel').expect(200);

    // Rice has no home warehouse: found rice is welcome anywhere, at the average (0 so far).
    const found = await adjust(worker, {
      warehouseId: wh2.id,
      reason: 'SURPLUS',
      lines: [{ productUnitId: pcs(rice), enteredQty: '5', binId: bins.WH2 }],
    }).expect(201);
    const id = (found.body as AdjustmentJson).id;
    await action(worker, id, 'submit').expect(200);
    await action(admin, id, 'post').expect(200);
    expect(await ledgerOf('ADJ', id)).toEqual([
      { movement_type: 'ADJUSTMENT', leg: 1, qty_base: '5.000', unit_cost: '0.0000' },
    ]);
  });

  it('keeps opening stock and costs to their holders', async () => {
    const line = { productUnitId: pcs(cola), enteredQty: '10', binId: bins['A-01-01'] };
    await adjust(worker, { warehouseId: wh1.id, reason: 'OPENING', lines: [line] }).expect(403);
    await adjust(worker, {
      warehouseId: wh1.id,
      reason: 'SURPLUS',
      lines: [{ ...line, unitCost: '900' }],
    }).expect(403);

    const surplus = await adjust(worker, {
      warehouseId: wh1.id,
      reason: 'SURPLUS',
      lines: [line],
    }).expect(201);
    const id = (surplus.body as AdjustmentJson).id;
    const lineId = (surplus.body as AdjustmentJson).lines[0]?.id;
    await action(worker, id, 'submit').expect(200);
    const outsider = await adjust(worker, {
      warehouseId: wh1.id,
      reason: 'DAMAGED',
      lines: [{ ...line, enteredQty: '1' }],
    }).expect(201);
    await action(admin, id, 'post', {
      costs: [{ lineId: (outsider.body as AdjustmentJson).lines[0]?.id, unitCost: '1' }],
    }).expect(422);

    // The approver prices the found goods: 45 at 1 000 + 10 at 1 550 → 55 at 1 100.
    await action(admin, id, 'post', { costs: [{ lineId, unitCost: '1550' }] }).expect(200);
    expect(await ledgerOf('ADJ', id)).toEqual([
      { movement_type: 'ADJUSTMENT', leg: 1, qty_base: '10.000', unit_cost: '1550.0000' },
    ]);
    expect(await warehouseQty(wh1.id, cola.id)).toEqual({
      on_hand: '55.000',
      avg_cost: '1100.0000',
    });

    const opening = await adjust(admin, {
      warehouseId: wh1.id,
      reason: 'OPENING',
      lines: [{ ...line, enteredQty: '1' }],
    }).expect(201);
    await action(admin, (opening.body as AdjustmentJson).id, 'submit').expect(200);
    await action(admin, (opening.body as AdjustmentJson).id, 'post').expect(200);
  });

  it('lists adjustments by warehouse and status', async () => {
    const page = await http()
      .get('/api/v1/adjustments')
      .query({ warehouseId: wh2.id, status: 'CANCELLED' })
      .set(bearer(worker))
      .expect(200);
    expect((page.body as { data: { reason: string; lineCount: number }[] }).data).toEqual([
      expect.objectContaining({ reason: 'EXPIRED', lineCount: 1 }),
    ]);
  });
});
