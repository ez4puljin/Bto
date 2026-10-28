import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface SupplierJson {
  supplierId: number;
  status: string;
  ordererId: number | null;
  lineCount: number;
  estimatedCost: string | null;
  receiptId: number | null;
  canEdit: boolean;
  canMoveNext: boolean;
  canMoveBack: boolean;
}
interface OrderJson {
  id: number;
  number: string;
  status: string;
  suppliers: SupplierJson[];
}
interface RowJson {
  productId: number;
  units: { id: number; name: string; factor: string }[];
  homeWarehouseId: number | null;
  onHand: string;
  minQty: string | null;
  lastMonthOut: string;
  lastBasePrice?: string | null;
  line: { productUnitId: number; qty: string; qtyBase: string } | null;
  editable: boolean;
}
interface ReceiptLineJson {
  id: number;
  productId: number;
  warehouseId: number;
  enteredQty: string;
  expectedQty: string | null;
  checkedAt: string | null;
  binCode: string;
  docUnitPrice?: string | null;
}
interface ReceiptJson {
  id: number;
  number: string | null;
  status: string;
  costingStatus: string | null;
  origin: string;
  originRef: string | null;
  confirmations: { warehouseId: number }[];
  lines: ReceiptLineJson[];
}

/**
 * Purchase orders → receipts (slice 1, ADR-0115): an order by supplier, quantities typed by the
 * orderer, a manager or a keeper (own warehouse, «Бэлдэж» only), saved cell by cell against the
 * value the page opened with; «Ирсэн» makes a draft receipt expecting the ordered quantities at
 * the last prices; each warehouse's keeper checks and confirms their lines, the last confirmation
 * posts onto the sellable «Тавиургүй» shelf; only the accountant's price check (within 1₮ of the
 * delivery note) makes the supplier's bill. Synthetic data only.
 */
describe('purchase orders and receiving', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let manager: string;
  let orderer: string;
  let ordererId: number;
  let keeper1: string;
  let keeper2: string;
  let accountant: string;
  let office: string;
  let wh1: WarehouseJson;
  let wh2: WarehouseJson;
  let supplierA: number;
  let supplierB: number;
  let juice: ProductJson;
  let flour: ProductJson;
  let salt: ProductJson;
  let soap: ProductJson;
  const http = () => request(app.getHttpServer());

  const order = async (token: string, id: number) =>
    (await http().get(`/api/v1/purchase-orders/${id}`).set(bearer(token)).expect(200))
      .body as OrderJson;
  const supplierOf = (detail: OrderJson, supplierId: number) => {
    const row = detail.suppliers.find((supplier) => supplier.supplierId === supplierId);
    if (!row) throw new Error(`no supplier ${supplierId}`);
    return row;
  };
  const rows = async (token: string, id: number, supplierId: number, query = '') =>
    (
      await http()
        .get(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/rows${query}`)
        .set(bearer(token))
        .expect(200)
    ).body as { data: RowJson[]; total: number };
  const save = (token: string, id: number, supplierId: number, changes: unknown[]) =>
    http()
      .put(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/lines`)
      .set(bearer(token))
      .send({ changes });
  const move = (token: string, id: number, supplierId: number, to: string) =>
    http()
      .post(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/status`)
      .set(bearer(token))
      .set(idempotency())
      .send({ to });
  const receipt = async (token: string, id: number) =>
    (await http().get(`/api/v1/receipts/${id}`).set(bearer(token)).expect(200))
      .body as ReceiptJson;
  const lineOf = (detail: ReceiptJson, productId: number) => {
    const line = detail.lines.find((row) => row.productId === productId);
    if (!line) throw new Error(`no line of ${productId}`);
    return line;
  };
  const count = (token: string, lineId: number, enteredQty: string) =>
    http().patch(`/api/v1/receipt-lines/${lineId}`).set(bearer(token)).send({ enteredQty });
  const confirm = (token: string, id: number) =>
    http().post(`/api/v1/receipts/${id}/post`).set(bearer(token)).set(idempotency());
  const sellable = async (productId: number, warehouseId: number) =>
    (
      await sql.query<{ sellable_on_hand: string }>(
        `SELECT sellable_on_hand::text FROM warehouse_stock WHERE product_id = $1 AND warehouse_id = $2`,
        [productId, warehouseId],
      )
    ).rows[0]?.sellable_on_hand ?? '0';
  const supplierBalance = async (supplierId: number) =>
    (
      (
        await http()
          .get(`/api/v1/supplier-balances/${supplierId}`)
          .set(bearer(accountant))
          .expect(200)
      ).body as { balance: string }
    ).balance;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    wh1 = await inventory.warehouse('PW1');
    wh2 = await inventory.warehouse('PW2');
    const as = async (roles: string[], warehouseIds?: number[]) => {
      const user = await seedUser(app, { roles, ...(warehouseIds ? { warehouseIds } : {}) });
      return { id: user.id, token: (await login(app, user)).accessToken };
    };
    manager = (await as(['PROCUREMENT'])).token;
    const ordererUser = await as(['WAREHOUSE']);
    orderer = ordererUser.token;
    ordererId = ordererUser.id;
    keeper1 = (await as(['WAREHOUSE'], [wh1.id])).token;
    keeper2 = (await as(['WAREHOUSE'], [wh2.id])).token;
    accountant = (await as(['ACCOUNTANT'])).token;
    office = (await as(['OFFICE'])).token;
    const partners = partnersApi(app, admin);
    supplierA = (await partners.supplier({ name: 'Туршилтын нийлүүлэгч А' })).id;
    supplierB = (await partners.supplier({ name: 'Туршилтын нийлүүлэгч Б' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Туршилт');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    const make = (sku: string, name: string, boxOf?: string) =>
      catalog.product({
        sku,
        name,
        categoryId: category,
        baseUomId: pcs,
        ...(boxOf ? { units: [{ uomId: box, factorToBase: boxOf }] } : {}),
      });
    juice = await make('9101', 'Туршилтын жүүс', '12');
    flour = await make('9102', 'Туршилтын гурил');
    salt = await make('9103', 'Туршилтын давс');
    soap = await make('9104', 'Туршилтын саван');
    // Juice and flour live in PW1, salt in PW2; soap is supplier B's.
    await inventory.setHome(juice.id, wh1.id);
    await inventory.setHome(flour.id, wh1.id);
    await inventory.setHome(salt.id, wh2.id);
    await inventory.setHome(soap.id, wh2.id);
    for (const [productId, supplierId] of [
      [juice.id, supplierA],
      [flour.id, supplierA],
      [salt.id, supplierA],
      [soap.id, supplierB],
    ] as const) {
      await http()
        .post('/api/v1/product-suppliers')
        .set(bearer(admin))
        .send({ productId, supplierId })
        .expect(201);
    }
    await http()
      .put(`/api/v1/procurement/supplier-orderers/${supplierA}`)
      .set(bearer(manager))
      .send({ userId: ordererId })
      .expect(200);
    // A minimum for juice in its home: 30 pieces.
    await http()
      .put('/api/v1/product-locations')
      .set(bearer(admin))
      .send({ warehouseId: wh1.id, productId: juice.id, minQty: '30' })
      .expect(200);
    // An earlier receipt gives juice a last price: 1,200₮ per piece.
    const earlier = (
      await http()
        .post('/api/v1/receipts')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          supplierId: supplierA,
          noteTotalQty: '10',
          noteTotalAmount: '12000',
          lines: [{ productUnitId: unitOf(juice, 'PCS').id, enteredQty: '10', docAmount: '12000' }],
        })
        .expect(201)
    ).body as ReceiptJson;
    await confirm(admin, earlier.id).expect(200);
    await http()
      .put(`/api/v1/receipts/${earlier.id}/costs`)
      .set(bearer(admin))
      .set(idempotency())
      .send({
        costingVersion: 0,
        lines: [{ lineId: earlier.lines[0]?.id, amount: '12000' }],
      })
      .expect(200);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('runs an order from «Бэлдэж» to «Орлого авсан» with each role in its place', async () => {
    // Only a manager creates an order; it is numbered at once.
    await http()
      .post('/api/v1/purchase-orders')
      .set(bearer(orderer))
      .set(idempotency())
      .send({ supplierIds: [supplierA] })
      .expect(403);
    const created = (
      await http()
        .post('/api/v1/purchase-orders')
        .set(bearer(manager))
        .set(idempotency())
        .send({ supplierIds: [supplierA, supplierB], note: 'Туршилтын захиалга' })
        .expect(201)
    ).body as OrderJson;
    expect(created.number).toMatch(new RegExp(`^PO-${businessYear()}-\\d{6}$`));
    expect(created.status).toBe('PREPARING');
    const id = created.id;

    // The grid lists the supplier's main products with what Bto knows beside them.
    const grid = await rows(manager, id, supplierA);
    expect(grid.data.map((row) => row.productId).sort()).toEqual(
      [juice.id, flour.id, salt.id].sort(),
    );
    const juiceRow = grid.data.find((row) => row.productId === juice.id);
    expect(juiceRow).toMatchObject({
      homeWarehouseId: wh1.id,
      onHand: '10',
      minQty: '30',
      lastMonthOut: '0',
      lastBasePrice: '1200.00',
      line: null,
      editable: true,
    });
    // Keepers never see prices; the below-minimum filter keeps juice (10 < 30).
    expect((await rows(keeper1, id, supplierA)).data[0]).not.toHaveProperty('lastBasePrice');
    expect((await rows(manager, id, supplierA, '?filter=BELOW_MIN')).data).toHaveLength(1);

    const box = unitOf(juice, 'BOX').id;
    // The orderer types juice in boxes; keeper 2 types salt (their warehouse) but not flour.
    expect(
      (await save(orderer, id, supplierA, [
        { productId: juice.id, productUnitId: box, qty: '5', previousUnitId: null, previousQty: null },
      ]).expect(200)).body,
    ).toEqual({ applied: 1, conflicts: [], refused: [] });
    expect(
      (
        await save(keeper2, id, supplierA, [
          {
            productId: salt.id,
            productUnitId: unitOf(salt, 'PCS').id,
            qty: '40',
            previousUnitId: null,
            previousQty: null,
          },
          {
            productId: flour.id,
            productUnitId: unitOf(flour, 'PCS').id,
            qty: '20',
            previousUnitId: null,
            previousQty: null,
          },
        ]).expect(200)
      ).body,
    ).toEqual({ applied: 1, conflicts: [], refused: [{ productId: flour.id, reason: 'SCOPE' }] });
    // A stale page: the manager opened juice empty and is skipped, the orderer's 5 boxes stay.
    expect(
      (
        await save(manager, id, supplierA, [
          { productId: juice.id, productUnitId: box, qty: '9', previousUnitId: null, previousQty: null },
          {
            productId: flour.id,
            productUnitId: unitOf(flour, 'PCS').id,
            qty: '20',
            previousUnitId: null,
            previousQty: null,
          },
        ]).expect(200)
      ).body,
    ).toEqual({
      applied: 1,
      conflicts: [{ productId: juice.id, productUnitId: box, qty: '5' }],
      refused: [],
    });
    let detail = supplierOf(await order(manager, id), supplierA);
    expect(detail).toMatchObject({ lineCount: 3, ordererId, canEdit: true, canMoveNext: true });
    // Estimated cost: 60 juice × 1,200₮ (the others have no price yet).
    expect(detail.estimatedCost).toBe('72000.00');

    // «Илгээсэн»: keepers may no longer type, the orderer still may; nobody but a manager steps back.
    await move(orderer, id, supplierA, 'SENT').expect(200);
    await save(keeper2, id, supplierA, [
      {
        productId: salt.id,
        productUnitId: unitOf(salt, 'PCS').id,
        qty: '50',
        previousUnitId: unitOf(salt, 'PCS').id,
        previousQty: '40',
      },
    ]).expect(409);
    await move(orderer, id, supplierA, 'PREPARING').expect(403);
    await move(orderer, id, supplierA, 'IN_TRANSIT').expect(200);
    // An empty supplier cannot move on; the order shows the lowest status.
    await move(manager, id, supplierB, 'SENT').expect(409);
    expect((await order(manager, id)).status).toBe('PREPARING');

    // «Ирсэн» makes the draft receipt: the ordered quantities expected, the last prices filled in.
    await move(orderer, id, supplierA, 'ARRIVED').expect(200);
    detail = supplierOf(await order(manager, id), supplierA);
    expect(detail.status).toBe('ARRIVED');
    const receiptId = detail.receiptId as number;
    let draft = await receipt(admin, receiptId);
    expect(draft).toMatchObject({ status: 'DRAFT', origin: 'ORDER', originRef: created.number });
    expect(lineOf(draft, juice.id)).toMatchObject({
      expectedQty: '5',
      enteredQty: '0',
      checkedAt: null,
      warehouseId: wh1.id,
      docUnitPrice: '14400.00',
    });
    // The order's draft is cancelled only through the order.
    await http()
      .post(`/api/v1/receipts/${receiptId}/cancel`)
      .set(bearer(admin))
      .expect(409);

    // Keeper 1 checks their lines; keeper 2 has not counted salt yet.
    await count(keeper1, lineOf(draft, juice.id).id, '4').expect(200);
    await confirm(keeper1, receiptId).expect(409); // flour unchecked
    await count(keeper1, lineOf(draft, flour.id).id, '0').expect(200); // «ирээгүй»
    await http()
      .patch(`/api/v1/receipts/${receiptId}`)
      .set(bearer(keeper1))
      .send({ noteTotalQty: '83', noteTotalAmount: '57600' })
      .expect(200);
    draft = (await confirm(keeper1, receiptId).expect(200)).body as ReceiptJson;
    expect(draft.status).toBe('DRAFT');
    expect(draft.confirmations.map((row) => row.warehouseId)).toEqual([wh1.id]);
    // PW1's lines are frozen now.
    await count(keeper1, lineOf(draft, juice.id).id, '5').expect(409);

    // Keeper 2's count: 35 salt, plus a product not on the order scanned in.
    await count(keeper2, lineOf(draft, salt.id).id, '35').expect(200);
    await http()
      .post(`/api/v1/receipts/${receiptId}/lines`)
      .set(bearer(keeper2))
      .send({ productUnitId: unitOf(soap, 'PCS').id, enteredQty: '6' })
      .expect(201);
    // The note says 83 pieces; 48 + 35 + 6 = 89 are counted.
    expect(
      ((await confirm(keeper2, receiptId).expect(422)).body as { code: string }).code,
    ).toBe('RECEIPT_NOTE_QTY_MISMATCH');
    await http()
      .patch(`/api/v1/receipts/${receiptId}`)
      .set(bearer(keeper2))
      .send({ noteTotalQty: '89' })
      .expect(200);
    const posted = (await confirm(keeper2, receiptId).expect(200)).body as ReceiptJson;
    expect(posted).toMatchObject({ status: 'POSTED', costingStatus: 'PENDING' });
    // On sale at once, on the «Тавиургүй» shelf; nothing booked for the supplier yet.
    expect(lineOf(posted, juice.id).binCode).toBe('NOSHELF');
    expect(await sellable(juice.id, wh1.id)).toBe('58.000');
    expect(await sellable(salt.id, wh2.id)).toBe('35.000');
    expect(supplierOf(await order(manager, id), supplierA).status).toBe('ACCOUNTING');
    expect(await supplierBalance(supplierA)).toBe('12000.00');

    // The accountant's price check: the previous price beside the new one.
    const costing = (
      await http().get(`/api/v1/receipts/${receiptId}/costing`).set(bearer(accountant)).expect(200)
    ).body as {
      lines: { lineId: number; productId: number; previousUnitPrice: string | null }[];
    };
    expect(costing.lines.map((line) => line.productId).sort()).toEqual(
      [juice.id, salt.id, soap.id].sort(),
    );
    expect(costing.lines.find((line) => line.productId === juice.id)?.previousUnitPrice).toBe(
      '14400.00',
    );
    const lineId = (productId: number) =>
      costing.lines.find((line) => line.productId === productId)?.lineId;
    const prices = (soapAmount: string) => ({
      costingVersion: 0,
      lines: [
        { lineId: lineId(juice.id), amount: '57600' },
        { lineId: lineId(salt.id), amount: '0', freeGoods: true },
        { lineId: lineId(soap.id), amount: soapAmount },
      ],
    });
    // 57,600 + 3,000 = 60,600 against a note of 57,600: refused beyond 1₮.
    expect(
      (
        (await http()
          .put(`/api/v1/receipts/${receiptId}/costs`)
          .set(bearer(accountant))
          .set(idempotency())
          .send(prices('3000'))
          .expect(422)).body as { code: string }
      ).code,
    ).toBe('RECEIPT_NOTE_AMOUNT_MISMATCH');
    // The accountant corrects the note's total (off by 0.50₮, within the tolerance).
    await http()
      .put(`/api/v1/receipts/${receiptId}/costs`)
      .set(bearer(accountant))
      .set(idempotency())
      .send({ ...prices('3000'), noteTotalAmount: '60600.50' })
      .expect(200);
    expect(supplierOf(await order(manager, id), supplierA).status).toBe('RECEIVED');
    // The bill: 12,000 before plus 60,600 now.
    expect(await supplierBalance(supplierA)).toBe('72600.00');
    // Supplier B is still «Бэлдэж»: the order stays there.
    expect((await order(office, id)).status).toBe('PREPARING');
  });

  it('steps back from «Ирсэн» by cancelling the untouched draft, never after a confirmation', async () => {
    const created = (
      await http()
        .post('/api/v1/purchase-orders')
        .set(bearer(manager))
        .set(idempotency())
        .send({ supplierIds: [supplierA] })
        .expect(201)
    ).body as OrderJson;
    await save(manager, created.id, supplierA, [
      {
        productId: salt.id,
        productUnitId: unitOf(salt, 'PCS').id,
        qty: '10',
        previousUnitId: null,
        previousQty: null,
      },
    ]).expect(200);
    for (const to of ['SENT', 'IN_TRANSIT', 'ARRIVED']) {
      await move(manager, created.id, supplierA, to).expect(200);
    }
    const first = supplierOf(await order(manager, created.id), supplierA).receiptId as number;
    await move(manager, created.id, supplierA, 'IN_TRANSIT').expect(200);
    expect((await receipt(admin, first)).status).toBe('CANCELLED');
    await move(manager, created.id, supplierA, 'ARRIVED').expect(200);
    const second = supplierOf(await order(manager, created.id), supplierA).receiptId as number;
    expect(second).not.toBe(first);
    const draft = await receipt(admin, second);
    await count(keeper2, lineOf(draft, salt.id).id, '10').expect(200);
    await http()
      .patch(`/api/v1/receipts/${second}`)
      .set(bearer(keeper2))
      .send({ noteTotalQty: '10', noteTotalAmount: '0' })
      .expect(200);
    await confirm(keeper2, second).expect(200);
    // Posted now: the order can no longer step back.
    await move(manager, created.id, supplierA, 'ARRIVED').expect(409);
    expect(supplierOf(await order(manager, created.id), supplierA).status).toBe('ACCOUNTING');
  });
});
