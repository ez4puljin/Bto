import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface LineJson {
  id: number;
  productId: number;
  unitName: string;
  enteredQty: string;
  qtyBase: string;
  binCode: string;
}
interface ReceiptJson {
  id: number;
  number: string | null;
  status: string;
  costingStatus: string | null;
  lines: LineJson[];
}

/** Every key anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysOf(nested)]);
  }
  return [];
}
const COST_KEYS = /^(unitCost|provisionalUnitCost|amount|total|avgCost|value.*|absorbed|variance)$/;

/** Goods receipts and the accountant's costing (SPEC §5.4, ADR-0033). */
describe('goods receipts', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let worker: string;
  let accountant: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let supplierId: number;
  let cola: ProductJson;
  let rice: ProductJson;
  const shelves: Record<string, number> = {};
  const http = () => request(app.getHttpServer());

  const create = (token: string, body: Record<string, unknown>) =>
    http().post('/api/v1/receipts').set(bearer(token)).set(idempotency()).send(body);
  const postReceipt = (token: string, id: number) =>
    http().post(`/api/v1/receipts/${id}/post`).set(bearer(token)).set(idempotency());
  const stock = async (productId: number) => {
    const { rows } = await sql.query<{ on_hand: string; avg_cost: string }>(
      `SELECT on_hand, avg_cost FROM warehouse_stock WHERE product_id = $1`,
      [productId],
    );
    return rows[0];
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string) =>
      (await login(app, await seedUser(app, { roles: [role] }))).accessToken;
    admin = await token('ADMIN');
    worker = await token('WAREHOUSE');
    accountant = await token('ACCOUNTANT');
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('WH1');
    wh2 = await inventory.warehouse('WH2');
    for (const code of ['A-01-01', 'A-01-02'])
      shelves[code] = (await inventory.bin(wh1.id, code)).id;
    supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    cola = await catalog.product({
      sku: '10',
      name: 'Кока кола',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: box, factorToBase: '24' }],
    });
    rice = await catalog.product({
      sku: '11',
      name: 'Будаа',
      categoryId: category,
      baseUomId: pcs,
    });
    await inventory.setHome(cola.id, wh1.id);
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, productId: cola.id, defaultBinId: shelves['A-01-01'] })
      .expect(200);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('receives counted goods onto their shelf and numbers the receipt', async () => {
    const created = await create(worker, {
      warehouseId: wh1.id,
      supplierId,
      supplierDocNo: 'П-123',
      lines: [{ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2' }],
    }).expect(201);
    const draft = created.body as ReceiptJson;
    expect(draft).toMatchObject({ status: 'DRAFT', number: null });
    expect(draft.lines).toEqual([
      expect.objectContaining({
        unitName: 'хайрцаг',
        enteredQty: '2',
        qtyBase: '48',
        binCode: 'A-01-01',
      }),
    ]);
    // Rice has no fixed shelf: it lands in the receiving area unless a shelf is scanned.
    const withRice = await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '5' })
      .expect(201);
    const riceLine = (withRice.body as ReceiptJson).lines[1];
    expect(riceLine?.binCode).toBe('RECEIVING');
    await http()
      .patch(`/api/v1/receipt-lines/${riceLine?.id}`)
      .set(bearer(worker))
      .send({ enteredQty: '6', binId: shelves['A-01-02'] })
      .expect(200);
    const colaLine = draft.lines[0];
    await http()
      .patch(`/api/v1/receipt-lines/${colaLine?.id}`)
      .set(bearer(worker))
      .send({ enteredQty: '3' })
      .expect(200);

    const posted = (await postReceipt(worker, draft.id).expect(200)).body as ReceiptJson;
    expect(posted).toMatchObject({
      status: 'POSTED',
      costingStatus: 'PENDING',
      number: `GR-${businessYear()}-000001`,
    });
    expect(await stock(cola.id)).toMatchObject({ on_hand: '72.000' });
    expect(await stock(rice.id)).toMatchObject({ on_hand: '6.000' });
    const pending = await http()
      .get('/api/v1/receipts')
      .query({ costingPending: 'true' })
      .set(bearer(accountant))
      .expect(200);
    expect(pending.body.data.map((row: { id: number }) => row.id)).toEqual([draft.id]);

    const again = await postReceipt(worker, draft.id).expect(409);
    expect(again.body.code).toBe('DOC_ALREADY_POSTED');
    await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1' })
      .expect(409);
  });

  it('refuses receipts outside the rules', async () => {
    const store = await inventoryApi(app, admin).warehouse('STORE1', 'STORE');
    expect(
      (await create(worker, { warehouseId: store.id, supplierId }).expect(422)).body.code,
    ).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
    const elsewhere = await create(worker, {
      warehouseId: wh2.id,
      supplierId,
      lines: [{ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1' }],
    }).expect(409);
    expect(elsewhere.body).toMatchObject({
      code: 'PRODUCT_NOT_IN_WAREHOUSE',
      params: { warehouse: wh1.name },
    });
    const draft = (await create(worker, { warehouseId: wh1.id, supplierId }).expect(201))
      .body as ReceiptJson;
    expect((await postReceipt(worker, draft.id).expect(422)).body.code).toBe('VALIDATION_FAILED');
    const damaged = await inventoryApi(app, admin).systemBin(wh1.id, 'DAMAGED');
    await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1', binId: damaged.id })
      .expect(422);
    const foreignBin = (await inventoryApi(app, admin).bin(wh2.id, 'Z-01-01')).id;
    await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1', binId: foreignBin })
      .expect(422);
    await create(accountant, { warehouseId: wh1.id, supplierId }).expect(403);
    const scoped = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh2.id] }))
    ).accessToken;
    await create(scoped, { warehouseId: wh1.id, supplierId }).expect(403);

    // A supplier deactivated after the draft stops the posting.
    const old = (await partnersApi(app, admin).supplier({ name: 'Хуучин' })).id;
    const late = (
      await create(worker, {
        warehouseId: wh1.id,
        supplierId: old,
        lines: [{ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1' }],
      }).expect(201)
    ).body as ReceiptJson;
    await http()
      .patch(`/api/v1/suppliers/${old}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect((await postReceipt(worker, late.id).expect(409)).body.code).toBe('SUPPLIER_INACTIVE');
    await http().post(`/api/v1/receipts/${late.id}/cancel`).set(bearer(worker)).expect(200);
  });

  it('lets the accountant cost a receipt while warehouse staff never see costs', async () => {
    const tea = await catalogApi(app, admin).product({
      sku: '12',
      name: 'Цай',
      categoryId: await catalogApi(app, admin).category('Хүнс'),
      baseUomId: await catalogApi(app, admin).uomId('PCS'),
      units: [{ uomId: await catalogApi(app, admin).uomId('BOX'), factorToBase: '24' }],
    });
    const receipt = (
      await create(worker, {
        warehouseId: wh1.id,
        supplierId,
        lines: [
          { productUnitId: unitOf(tea, 'BOX').id, enteredQty: '2', binId: shelves['A-01-02'] },
          { productUnitId: unitOf(tea, 'BOX').id, enteredQty: '1', binId: shelves['A-01-02'] },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    await postReceipt(worker, receipt.id).expect(200);

    const seen = await http().get(`/api/v1/receipts/${receipt.id}`).set(bearer(worker)).expect(200);
    expect(keysOf(seen.body).filter((key) => COST_KEYS.test(key))).toEqual([]);
    await http().get(`/api/v1/receipts/${receipt.id}/costing`).set(bearer(worker)).expect(403);

    const before = await http()
      .get(`/api/v1/receipts/${receipt.id}/costing`)
      .set(bearer(accountant))
      .expect(200);
    expect(before.body).toMatchObject({ costingVersion: 0, costingStatus: 'PENDING', total: null });
    const [paid, bonus] = before.body.lines as { lineId: number; provisionalUnitCost: string }[];
    expect(paid?.provisionalUnitCost).toBe('0');
    const cost = (version: number, lines: Record<string, unknown>[]) =>
      http()
        .put(`/api/v1/receipts/${receipt.id}/costs`)
        .set(bearer(accountant))
        .set(idempotency())
        .send({ costingVersion: version, lines });
    await cost(0, [{ lineId: paid?.lineId, unitPrice: '24000' }]).expect(422);
    const costed = await cost(0, [
      { lineId: paid?.lineId, unitPrice: '24000' },
      { lineId: bonus?.lineId, freeGoods: true },
    ]).expect(200);
    expect(costed.body).toMatchObject({
      costingVersion: 1,
      costingStatus: 'COSTED',
      total: '48000.00',
    });
    expect(costed.body.lines).toEqual([
      expect.objectContaining({ amount: '48000.00', unitCost: '1000', freeGoods: false }),
      expect.objectContaining({ amount: '0.00', unitCost: '0', freeGoods: true }),
    ]);
    // 72 pieces worth 48 000: the average is the exact moving average.
    expect(await stock(tea.id)).toMatchObject({ on_hand: '72.000', avg_cost: '666.6667' });

    expect((await cost(0, []).expect(409)).body).toMatchObject({
      code: 'CONFLICT',
      params: { costingVersion: 1 },
    });
    await cost(1, [
      { lineId: paid?.lineId, amount: '60000' },
      { lineId: bonus?.lineId, freeGoods: true },
    ]).expect(200);
    expect(await stock(tea.id)).toMatchObject({ avg_cost: '833.3334' });
    const { rows } = await sql.query(
      `SELECT version, amount, value_before, value_delta FROM stock_valuation_adjustments
        WHERE doc_id = $1 ORDER BY version, doc_line_id`,
      [receipt.id],
    );
    expect(rows).toEqual([
      { version: 1, amount: '48000.00', value_before: '0.00', value_delta: '48000.00' },
      { version: 1, amount: '0.00', value_before: '0.00', value_delta: '0.00' },
      { version: 2, amount: '60000.00', value_before: '48000.00', value_delta: '12000.00' },
      { version: 2, amount: '0.00', value_before: '0.00', value_delta: '0.00' },
    ]);

    // After the end of the month following the posting month, the costs are closed.
    await sql.query(`UPDATE goods_receipts SET effective_date = '2026-01-15' WHERE id = $1`, [
      receipt.id,
    ]);
    const closed = await cost(2, [
      { lineId: paid?.lineId, amount: '50000' },
      { lineId: bonus?.lineId, freeGoods: true },
    ]).expect(409);
    expect(closed.body).toMatchObject({
      code: 'COSTING_CLOSED',
      params: { deadline: '2026-02-28' },
    });
  });

  it('refuses a posting when a unit was superseded after drafting', async () => {
    const draft = (
      await create(worker, {
        warehouseId: wh1.id,
        supplierId,
        lines: [{ productUnitId: unitOf(cola, 'BOX').id, enteredQty: '1' }],
      }).expect(201)
    ).body as ReceiptJson;
    await http()
      .post(`/api/v1/product-units/${unitOf(cola, 'BOX').id}/supersede`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ factorToBase: '20' })
      .expect(201);
    expect((await postReceipt(worker, draft.id).expect(409)).body.code).toBe('UNIT_SUPERSEDED');
  });
});
