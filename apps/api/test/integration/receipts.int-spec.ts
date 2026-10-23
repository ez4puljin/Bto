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
  warehouseId: number;
  warehouseName: string;
  binCode: string;
}
interface ReceiptJson {
  id: number;
  number: string | null;
  status: string;
  costingStatus: string | null;
  warehouses: { id: number; name: string }[];
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
const COST_KEYS =
  /^(unitCost|provisionalUnitCost|amount|total|avgCost|value.*|absorbed|variance|doc.*|discount.*|net.*|totals)$/;

/**
 * Goods receipts and the accountant's costing (SPEC §5.4, ADR-0033): each line goes to its
 * product's home warehouse and fixed shelf there, so one receipt may fill several wholesale
 * warehouses, written by any holder of the receipt right whatever their scope (ADR-0099 #1–#2).
 */
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
  const homeOf = async (productId: number) =>
    (
      await sql.query<{ warehouse_id: string }>(
        `SELECT warehouse_id::text FROM product_locations WHERE product_id = $1 AND is_home`,
        [productId],
      )
    ).rows.map((row) => Number.parseInt(row.warehouse_id, 10));
  const shelf = (code: string) => {
    const id = shelves[code];
    if (id === undefined) throw new Error(`no shelf ${code}`);
    return id;
  };
  let food: number;
  const product = async (sku: string, name: string) => {
    const catalog = catalogApi(app, admin);
    return catalog.product({ sku, name, categoryId: food, baseUomId: await catalog.uomId('PCS') });
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
    shelves['B-01-01'] = (await inventory.bin(wh2.id, 'B-01-01')).id;
    supplierId = (await partnersApi(app, admin).supplier({ name: 'МСМ ХХК' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа');
    food = await catalog.category('Хүнс');
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
    await inventory.homeShelf(cola.id, wh1.id, shelf('A-01-01'));
    // Rice lives in WH1 without a fixed shelf there.
    await inventory.setHome(rice.id, wh1.id);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('receives counted goods onto their shelf and numbers the receipt', async () => {
    const created = await create(worker, {
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
        warehouseId: wh1.id,
        warehouseName: wh1.name,
        binCode: 'A-01-01',
      }),
    ]);
    expect(draft.warehouses).toEqual([{ id: wh1.id, name: wh1.name }]);
    // Rice has no fixed shelf: it lands in its home's receiving area.
    const withRice = await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '5' })
      .expect(201);
    const riceLine = (withRice.body as ReceiptJson).lines[1];
    expect(riceLine).toMatchObject({ warehouseId: wh1.id, binCode: 'RECEIVING' });
    await http()
      .patch(`/api/v1/receipt-lines/${riceLine?.id}`)
      .set(bearer(worker))
      .send({ enteredQty: '6' })
      .expect(200);
    // The shelf is no longer chosen on the line.
    await http()
      .patch(`/api/v1/receipt-lines/${riceLine?.id}`)
      .set(bearer(worker))
      .send({ binId: shelf('A-01-02') })
      .expect(422);
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
    expect(pending.body.data).toEqual([expect.objectContaining({ id: draft.id, lineCount: 2 })]);

    const again = await postReceipt(worker, draft.id).expect(409);
    expect(again.body.code).toBe('DOC_ALREADY_POSTED');
    await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1' })
      .expect(409);
  });

  it('refuses receipts outside the rules', async () => {
    // The warehouse and the shelf follow the product: a request names neither (ADR-0099 #1).
    await create(worker, { warehouseId: wh1.id, supplierId }).expect(422);
    await create(worker, {
      supplierId,
      lines: [{ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1', binId: shelf('A-01-02') }],
    }).expect(422);
    // A home-less product is received into a wholesale warehouse only.
    const store = await inventoryApi(app, admin).warehouse('STORE1', 'STORE');
    const loose = await product('13', 'Давс');
    const kind = await create(worker, {
      supplierId,
      lines: [{ productUnitId: unitOf(loose, 'PCS').id, enteredQty: '1', warehouseId: store.id }],
    }).expect(422);
    expect(kind.body.code).toBe('WAREHOUSE_KIND_NOT_ALLOWED');
    expect(await homeOf(loose.id)).toEqual([]);
    const draft = (await create(worker, { supplierId }).expect(201)).body as ReceiptJson;
    expect(draft.warehouses).toEqual([]);
    expect((await postReceipt(worker, draft.id).expect(422)).body.code).toBe('VALIDATION_FAILED');
    await create(accountant, { supplierId }).expect(403);

    // A home moved after the line was entered stops the posting.
    const moved = await product('14', 'Шилжсэн бараа');
    await inventoryApi(app, admin).setHome(moved.id, wh1.id);
    const stale = (
      await create(worker, {
        supplierId,
        lines: [{ productUnitId: unitOf(moved, 'PCS').id, enteredQty: '1' }],
      }).expect(201)
    ).body as ReceiptJson;
    await inventoryApi(app, admin).setHome(moved.id, wh2.id);
    expect((await postReceipt(worker, stale.id).expect(409)).body).toMatchObject({
      code: 'PRODUCT_NOT_IN_WAREHOUSE',
      params: { warehouse: wh2.name },
    });
    await http().post(`/api/v1/receipts/${stale.id}/cancel`).set(bearer(worker)).expect(200);

    // A supplier deactivated after the draft stops the posting.
    const old = (await partnersApi(app, admin).supplier({ name: 'Хуучин' })).id;
    const late = (
      await create(worker, {
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
      categoryId: food,
      baseUomId: await catalogApi(app, admin).uomId('PCS'),
      units: [{ uomId: await catalogApi(app, admin).uomId('BOX'), factorToBase: '24' }],
    });
    await inventoryApi(app, admin).homeShelf(tea.id, wh1.id, shelf('A-01-02'));
    const receipt = (
      await create(worker, {
        supplierId,
        lines: [
          { productUnitId: unitOf(tea, 'BOX').id, enteredQty: '2' },
          { productUnitId: unitOf(tea, 'BOX').id, enteredQty: '1' },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    expect(receipt.lines.map((line) => line.binCode)).toEqual(['A-01-02', 'A-01-02']);
    await postReceipt(worker, receipt.id).expect(200);

    const seen = await http().get(`/api/v1/receipts/${receipt.id}`).set(bearer(worker)).expect(200);
    expect(keysOf(seen.body).filter((key) => COST_KEYS.test(key))).toEqual([]);
    await http().get(`/api/v1/receipts/${receipt.id}/costing`).set(bearer(worker)).expect(403);
    // The list's payable is cost data too.
    const listed = await http()
      .get('/api/v1/receipts')
      .query({ productId: tea.id })
      .set(bearer(worker))
      .expect(200);
    expect(keysOf(listed.body).filter((key) => COST_KEYS.test(key))).toEqual([]);

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

  it('corrects the delivery note of a draft, never of a posted receipt (ADR-0047 #1)', async () => {
    interface HeaderJson extends ReceiptJson {
      supplierId: number;
      supplierDocNo: string | null;
      supplierDocDate: string | null;
      note: string | null;
    }
    const draft = (
      await create(worker, {
        supplierId,
        supplierDocNo: 'П-1',
        note: 'Анхны',
      }).expect(201)
    ).body as HeaderJson;
    const patch = (token: string, body: Record<string, unknown>) =>
      http().patch(`/api/v1/receipts/${draft.id}`).set(bearer(token)).send(body);

    const nomin = (await partnersApi(app, admin).supplier({ name: 'Номин' })).id;
    const corrected = (
      await patch(worker, {
        supplierId: nomin,
        supplierDocNo: 'П-2',
        supplierDocDate: '2026-10-12',
        note: null,
      }).expect(200)
    ).body as HeaderJson;
    expect(corrected).toMatchObject({
      supplierId: nomin,
      supplierDocNo: 'П-2',
      supplierDocDate: '2026-10-12',
      note: null,
    });
    // An empty text clears; fields left out stay.
    expect(
      (await patch(worker, { supplierDocNo: '', supplierDocDate: null }).expect(200)).body,
    ).toMatchObject({ supplierId: nomin, supplierDocNo: null, supplierDocDate: null });

    const closed = (await partnersApi(app, admin).supplier({ name: 'Хаагдсан' })).id;
    await http()
      .patch(`/api/v1/suppliers/${closed}`)
      .set(bearer(admin))
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect((await patch(worker, { supplierId: closed }).expect(409)).body.code).toBe(
      'SUPPLIER_INACTIVE',
    );
    // Any holder of the receipt right corrects it, whatever their warehouse scope (ADR-0099 #2).
    const elsewhere = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh2.id] }))
    ).accessToken;
    expect((await patch(elsewhere, { note: 'Өөр агуулах' }).expect(200)).body).toMatchObject({
      note: 'Өөр агуулах',
    });
    await patch(accountant, { note: 'Нягтлан' }).expect(403);

    await http()
      .post(`/api/v1/receipts/${draft.id}/lines`)
      .set(bearer(worker))
      .send({ productUnitId: unitOf(rice, 'PCS').id, enteredQty: '1' })
      .expect(201);
    await postReceipt(worker, draft.id).expect(200);
    expect((await patch(worker, { note: 'Хожуу' }).expect(409)).body.code).toBe(
      'DOC_ALREADY_POSTED',
    );
  });

  it('receives one note into the home of each product, whoever posts it (ADR-0099 #1–#2)', async () => {
    const inventory = inventoryApi(app, admin);
    const flour = await product('20', 'Гурил');
    await inventory.homeShelf(flour.id, wh2.id, shelf('B-01-01'));
    const salt = await product('21', 'Давс 1кг');
    // A clerk who writes only WH2 still receives the whole note.
    const scoped = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh2.id] }))
    ).accessToken;

    // A product without a home needs the warehouse it is received into.
    const homeless = await create(scoped, {
      supplierId,
      lines: [{ productUnitId: unitOf(salt, 'PCS').id, enteredQty: '3' }],
    }).expect(409);
    expect(homeless.body).toMatchObject({
      code: 'PRODUCT_NO_HOME',
      params: { productId: salt.id },
    });
    expect(await homeOf(salt.id)).toEqual([]);

    const draft = (
      await create(scoped, {
        supplierId,
        supplierDocNo: 'ХА-1',
        lines: [
          { productUnitId: unitOf(cola, 'PCS').id, enteredQty: '12' },
          { productUnitId: unitOf(flour, 'PCS').id, enteredQty: '5' },
          { productUnitId: unitOf(salt, 'PCS').id, enteredQty: '3', warehouseId: wh2.id },
        ],
      }).expect(201)
    ).body as ReceiptJson;
    // The named warehouse became the salt's home.
    expect(await homeOf(salt.id)).toEqual([wh2.id]);
    // A product with a home goes there, whatever warehouse the line names.
    const withMore = (
      await http()
        .post(`/api/v1/receipts/${draft.id}/lines`)
        .set(bearer(scoped))
        .send({ productUnitId: unitOf(cola, 'PCS').id, enteredQty: '1', warehouseId: wh2.id })
        .expect(201)
    ).body as ReceiptJson;
    expect(withMore.lines.map((line) => [line.productId, line.warehouseId, line.binCode])).toEqual([
      [cola.id, wh1.id, 'A-01-01'],
      [flour.id, wh2.id, 'B-01-01'],
      [salt.id, wh2.id, 'RECEIVING'],
      [cola.id, wh1.id, 'A-01-01'],
    ]);
    expect(withMore.warehouses).toEqual([
      { id: wh1.id, name: wh1.name },
      { id: wh2.id, name: wh2.name },
    ]);
    const colaBefore = await stock(cola.id);

    const posted = (await postReceipt(scoped, draft.id).expect(200)).body as ReceiptJson;
    expect(posted.number).toMatch(new RegExp(`^GR-${businessYear()}-\\d{6}$`));
    const ledger = await sql.query<{ warehouse_id: string; product_id: string; qty_base: string }>(
      `SELECT warehouse_id::text, product_id::text, qty_base::text FROM stock_ledger
        WHERE doc_type = 'GR' AND doc_id = $1 ORDER BY doc_line_id`,
      [draft.id],
    );
    expect(ledger.rows).toEqual([
      { warehouse_id: String(wh1.id), product_id: String(cola.id), qty_base: '12.000' },
      { warehouse_id: String(wh2.id), product_id: String(flour.id), qty_base: '5.000' },
      { warehouse_id: String(wh2.id), product_id: String(salt.id), qty_base: '3.000' },
      { warehouse_id: String(wh1.id), product_id: String(cola.id), qty_base: '1.000' },
    ]);
    const balances = await sql.query<{ warehouse_id: string; product_id: string; on_hand: string }>(
      `SELECT warehouse_id::text, product_id::text, on_hand::text FROM warehouse_stock
        WHERE product_id = ANY($1::bigint[]) ORDER BY product_id, warehouse_id`,
      [[flour.id, salt.id]],
    );
    expect(balances.rows).toEqual([
      { warehouse_id: String(wh2.id), product_id: String(flour.id), on_hand: '5.000' },
      { warehouse_id: String(wh2.id), product_id: String(salt.id), on_hand: '3.000' },
    ]);
    const colaAfter = await stock(cola.id);
    expect(Number.parseFloat(colaAfter?.on_hand ?? '0')).toBe(
      Number.parseFloat(colaBefore?.on_hand ?? '0') + 13,
    );

    // The warehouse filter finds the receipt from each of its warehouses, never from another.
    const listed = async (warehouseId: number) =>
      (
        (
          await http()
            .get('/api/v1/receipts')
            .query({ warehouseId, limit: 100 })
            .set(bearer(worker))
            .expect(200)
        ).body as { data: { id: number }[] }
      ).data.map((row) => row.id);
    expect(await listed(wh1.id)).toContain(draft.id);
    expect(await listed(wh2.id)).toContain(draft.id);
    const empty = await inventory.warehouse('WH3');
    expect(await listed(empty.id)).toEqual([]);
  });
});
