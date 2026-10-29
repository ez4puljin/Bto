import type { NestExpressApplication } from '@nestjs/platform-express';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
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
  shippedBase: string;
  arrivedBase: string | null;
  estimatedCost: string | null;
  finalAmount: string | null;
  priceDiffCount: number | null;
  receiptId: number | null;
  canEdit: boolean;
  canShip: boolean;
  canCount: boolean;
  canPrice: boolean;
  canMoveNext: boolean;
  canMoveBack: boolean;
}
interface OrderJson {
  id: number;
  number: string;
  status: string;
  updatedAt: string;
  archivedAt: string | null;
  canArchive: boolean;
  suppliers: SupplierJson[];
}
interface RowJson {
  productId: number;
  units: { id: number; name: string; factor: string }[];
  homeWarehouseId: number | null;
  onHand: string;
  minQty: string | null;
  lastMonthOut: string;
  sales: { avg12: string; avg3: string; lastMonth: string; sameMonthLastYear: string };
  lastBasePrice?: string | null;
  line: { productUnitId: number; qty: string; qtyBase: string; shippedQty: string | null } | null;
  editable: boolean;
  canShip: boolean;
  receipt: {
    lineId: number;
    expectedBase: string | null;
    arrivedBase: string | null;
    note: string | null;
    confirmed: boolean;
    canCount: boolean;
    previousUnitPrice?: string | null;
  } | null;
  extra: boolean;
}
interface RowsJson {
  data: RowJson[];
  total: number;
  rights: { order: boolean; shipped: boolean; count: boolean; price: boolean };
  receipt: { id: number; costingVersion: number } | null;
  extra: RowJson[];
}
interface ReceiptLineJson {
  id: number;
  productId: number;
  productUnitId: number;
  warehouseId: number;
  enteredQty: string;
  qtyBase: string;
  expectedQty: string | null;
  checkedAt: string | null;
  note: string | null;
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
interface HistoryJson {
  data: {
    kind: string;
    userId: number | null;
    productId: number | null;
    supplierId: number | null;
    from: string | null;
    to: string | null;
    detail: string | null;
  }[];
  nextCursor: string | null;
}

/**
 * Purchase orders → receipts (slice 1, ADR-0115; slice 1b, ADR-0118): an order by supplier,
 * quantities typed by the orderer, a manager or a keeper (own warehouse, «Бэлдэж» only), saved
 * cell by cell against the value the page opened with; the shipped quantities typed in «Ачигдаж
 * байна»; «Ирсэн» makes a draft receipt expecting the shipped quantities at the last prices; each
 * warehouse's keeper counts (boxes × pieces on the order page, or the scanner screen) and confirms
 * their lines, the last confirmation posts onto the sellable «Тавиургүй» shelf; only the
 * accountant's price check (within 1₮ of the delivery note) makes the supplier's bill; the history
 * shows every step; a received order is archived. Synthetic data only.
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
  let keeper2Id: number;
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
    ).body as RowsJson;
  const rowOf = (page: RowsJson, productId: number) => {
    const row = page.data.find((candidate) => candidate.productId === productId);
    if (!row) throw new Error(`no row of ${productId}`);
    return row;
  };
  const save = (token: string, id: number, supplierId: number, changes: unknown[]) =>
    http()
      .put(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/lines`)
      .set(bearer(token))
      .send({ changes });
  const arrivals = (token: string, id: number, supplierId: number, changes: unknown[]) =>
    http()
      .put(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/arrivals`)
      .set(bearer(token))
      .send({ changes });
  const move = (token: string, id: number, supplierId: number, to: string) =>
    http()
      .post(`/api/v1/purchase-orders/${id}/suppliers/${supplierId}/status`)
      .set(bearer(token))
      .set(idempotency())
      .send({ to });
  const receipt = async (token: string, id: number) =>
    (await http().get(`/api/v1/receipts/${id}`).set(bearer(token)).expect(200)).body as ReceiptJson;
  const lineOf = (detail: ReceiptJson, productId: number) => {
    const line = detail.lines.find((row) => row.productId === productId);
    if (!line) throw new Error(`no line of ${productId}`);
    return line;
  };
  const count = (token: string, lineId: number, enteredQty: string) =>
    http().patch(`/api/v1/receipt-lines/${lineId}`).set(bearer(token)).send({ enteredQty });
  const confirm = (token: string, id: number) =>
    http().post(`/api/v1/receipts/${id}/post`).set(bearer(token)).set(idempotency());
  const history = async (token: string, id: number, query = '') =>
    (
      await http()
        .get(`/api/v1/purchase-orders/${id}/history${query}`)
        .set(bearer(token))
        .expect(200)
    ).body as HistoryJson;
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
  const ordered = (product: ProductJson, qty: string, unit = 'PCS') => ({
    productId: product.id,
    productUnitId: unitOf(product, unit).id,
    qty,
    previousUnitId: null,
    previousQty: null,
  });

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
    const keeper2User = await as(['WAREHOUSE'], [wh2.id]);
    keeper2 = keeper2User.token;
    keeper2Id = keeper2User.id;
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
    expect(created.canArchive).toBe(true); // nothing ordered yet
    const id = created.id;

    // The grid lists the supplier's main products with what Bto knows beside them.
    const grid = await rows(manager, id, supplierA);
    expect(grid.data.map((row) => row.productId).sort()).toEqual(
      [juice.id, flour.id, salt.id].sort(),
    );
    expect(grid.rights).toEqual({ order: true, shipped: false, count: false, price: false });
    expect(grid.receipt).toBeNull();
    const juiceRow = rowOf(grid, juice.id);
    expect(juiceRow).toMatchObject({
      homeWarehouseId: wh1.id,
      onHand: '10',
      minQty: '30',
      lastMonthOut: '0',
      sales: { avg12: '0', avg3: '0', lastMonth: '0', sameMonthLastYear: '0' },
      lastBasePrice: '1200.00',
      line: null,
      editable: true,
      canShip: false,
      receipt: null,
      extra: false,
    });
    // Keepers never see prices; the below-minimum filter keeps juice (10 < 30); the warehouse filter PW2 keeps salt.
    expect((await rows(keeper1, id, supplierA)).data[0]).not.toHaveProperty('lastBasePrice');
    expect((await rows(manager, id, supplierA, '?filter=BELOW_MIN')).data).toHaveLength(1);
    expect(
      (await rows(manager, id, supplierA, `?warehouseId=${wh2.id}`)).data.map((r) => r.productId),
    ).toEqual([salt.id]);

    const box = unitOf(juice, 'BOX').id;
    const before = (await order(manager, id)).updatedAt;
    // The orderer types juice in boxes; keeper 2 types salt (their warehouse) but not flour.
    expect(
      (await save(orderer, id, supplierA, [ordered(juice, '5', 'BOX')]).expect(200)).body,
    ).toEqual({ applied: 1, conflicts: [], refused: [] });
    expect(
      (await save(keeper2, id, supplierA, [ordered(salt, '40'), ordered(flour, '20')]).expect(200))
        .body,
    ).toEqual({ applied: 1, conflicts: [], refused: [{ productId: flour.id, reason: 'SCOPE' }] });
    // A stale page: the manager opened juice empty and is skipped, the orderer's 5 boxes stay.
    expect(
      (
        await save(manager, id, supplierA, [
          ordered(juice, '9', 'BOX'),
          ordered(flour, '20'),
        ]).expect(200)
      ).body,
    ).toEqual({
      applied: 1,
      conflicts: [{ productId: juice.id, field: 'ORDERED', productUnitId: box, qty: '5' }],
      refused: [],
    });
    // The version the page polls moved with the saves.
    const version = (
      await http().get(`/api/v1/purchase-orders/${id}/version`).set(bearer(office)).expect(200)
    ).body as { updatedAt: string; receiptsUpdatedAt: string | null };
    expect(version.updatedAt > before).toBe(true);
    expect(version.receiptsUpdatedAt).toBeNull();
    let detail = supplierOf(await order(manager, id), supplierA);
    expect(detail).toMatchObject({ lineCount: 3, ordererId, canEdit: true, canMoveNext: true });
    // Estimated cost: 60 juice × 1,200₮ (the others have no price yet).
    expect(detail.estimatedCost).toBe('72000.00');
    expect((await order(manager, id)).canArchive).toBe(false);

    // «Илгээсэн»: keepers may no longer type, the orderer still may; nobody but a manager steps back;
    // shipped quantities are not taken yet.
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
    const shipped = (qty: string | null, previousQty: string | null = null) => ({
      productId: juice.id,
      field: 'SHIPPED',
      productUnitId: null,
      qty,
      previousUnitId: null,
      previousQty,
    });
    expect(
      ((await save(orderer, id, supplierA, [shipped('4')]).expect(409)).body as { params: unknown })
        .params,
    ).toMatchObject({ reason: 'SHIPPED' });

    // «Ачигдаж байна»: the orderer types what the supplier shipped (4 of the 5 boxes of juice);
    // a keeper may not; a stale shipped cell is a conflict; a product not ordered is refused.
    await move(orderer, id, supplierA, 'SHIPPING').expect(200);
    expect((await rows(orderer, id, supplierA)).rights).toMatchObject({
      order: true,
      shipped: true,
    });
    await save(keeper2, id, supplierA, [shipped('3')]).expect(409);
    expect(
      (
        await save(orderer, id, supplierA, [
          shipped('4'),
          { ...shipped('1'), productId: soap.id },
        ]).expect(200)
      ).body,
    ).toEqual({ applied: 1, conflicts: [], refused: [{ productId: soap.id, reason: 'NO_LINE' }] });
    expect((await save(orderer, id, supplierA, [shipped('3')]).expect(200)).body).toEqual({
      applied: 0,
      conflicts: [{ productId: juice.id, field: 'SHIPPED', productUnitId: box, qty: '4' }],
      refused: [],
    });
    expect(rowOf(await rows(manager, id, supplierA), juice.id).line?.shippedQty).toBe('4');
    expect(supplierOf(await order(manager, id), supplierA).shippedBase).toBe('48');
    await move(orderer, id, supplierA, 'IN_TRANSIT').expect(200);
    // An empty supplier cannot move on; the order shows the lowest status.
    await move(manager, id, supplierB, 'SENT').expect(409);
    expect((await order(manager, id)).status).toBe('PREPARING');

    // «Ирсэн» makes the draft receipt: the shipped quantity expected (the ordered one where none
    // was typed), the last prices filled in.
    await move(orderer, id, supplierA, 'ARRIVED').expect(200);
    detail = supplierOf(await order(manager, id), supplierA);
    expect(detail.status).toBe('ARRIVED');
    expect(detail.arrivedBase).toBe('0');
    const receiptId = detail.receiptId as number;
    let draft = await receipt(admin, receiptId);
    expect(draft).toMatchObject({ status: 'DRAFT', origin: 'ORDER', originRef: created.number });
    const juiceLine = lineOf(draft, juice.id);
    expect(juiceLine).toMatchObject({
      expectedQty: '4',
      enteredQty: '0',
      checkedAt: null,
      warehouseId: wh1.id,
      docUnitPrice: '14400.00',
      note: null,
    });
    expect(lineOf(draft, salt.id).expectedQty).toBe('40');
    // The order's draft is cancelled only through the order.
    await http().post(`/api/v1/receipts/${receiptId}/cancel`).set(bearer(admin)).expect(409);

    // On the order page: keeper 1 counts juice as 4 boxes + 2 loose pieces (50) with a note on the
    // difference; the line is now counted in pieces, its expectation and price converted.
    const page1 = await rows(keeper1, id, supplierA);
    expect(page1.rights).toMatchObject({ order: false, shipped: false, count: true, price: false });
    expect(page1.receipt).toMatchObject({ id: receiptId, costingVersion: 0 });
    expect(rowOf(page1, juice.id).receipt).toMatchObject({
      lineId: juiceLine.id,
      expectedBase: '48',
      arrivedBase: null,
      canCount: true,
    });
    expect(rowOf(await rows(keeper2, id, supplierA), juice.id).receipt?.canCount).toBe(false);
    expect(
      (
        await arrivals(keeper1, id, supplierA, [
          {
            lineId: juiceLine.id,
            arrivedQtyBase: '50',
            note: 'Нэг хайрцаг задгай ирсэн',
            previousArrivedQtyBase: null,
          },
        ]).expect(200)
      ).body,
    ).toEqual({ applied: 1, conflicts: [], refused: [] });
    draft = await receipt(admin, receiptId);
    expect(lineOf(draft, juice.id)).toMatchObject({
      productUnitId: unitOf(juice, 'PCS').id,
      enteredQty: '50',
      qtyBase: '50',
      expectedQty: '48',
      docUnitPrice: '1200.00',
      note: 'Нэг хайрцаг задгай ирсэн',
    });
    expect(lineOf(draft, juice.id).checkedAt).not.toBeNull();
    // Keeper 2 may not count PW1's line; a stale page is told what the line holds now.
    expect(
      (
        await arrivals(keeper2, id, supplierA, [
          { lineId: juiceLine.id, arrivedQtyBase: '49', previousArrivedQtyBase: null },
        ]).expect(200)
      ).body,
    ).toEqual({ applied: 0, conflicts: [], refused: [{ lineId: juiceLine.id, reason: 'SCOPE' }] });
    expect(
      (
        await arrivals(keeper1, id, supplierA, [
          { lineId: juiceLine.id, arrivedQtyBase: '49', previousArrivedQtyBase: null },
        ]).expect(200)
      ).body,
    ).toEqual({
      applied: 0,
      conflicts: [{ lineId: juiceLine.id, arrivedQtyBase: '50', note: 'Нэг хайрцаг задгай ирсэн' }],
      refused: [],
    });
    // Keeper 1's other line comes through the scanner screen: flour «ирээгүй».
    await confirm(keeper1, receiptId).expect(409); // flour unchecked
    await count(keeper1, lineOf(draft, flour.id).id, '0').expect(200);
    await http()
      .patch(`/api/v1/receipts/${receiptId}`)
      .set(bearer(keeper1))
      .send({ noteTotalQty: '83', noteTotalAmount: '57600' })
      .expect(200);
    draft = (await confirm(keeper1, receiptId).expect(200)).body as ReceiptJson;
    expect(draft.status).toBe('DRAFT');
    expect(draft.confirmations.map((row) => row.warehouseId)).toEqual([wh1.id]);
    // PW1's lines are frozen now, on both screens.
    await count(keeper1, lineOf(draft, juice.id).id, '5').expect(409);
    expect(
      (
        await arrivals(keeper1, id, supplierA, [
          { lineId: juiceLine.id, arrivedQtyBase: '50', previousArrivedQtyBase: '50' },
        ]).expect(200)
      ).body,
    ).toEqual({
      applied: 0,
      conflicts: [],
      refused: [{ lineId: juiceLine.id, reason: 'CONFIRMED' }],
    });

    // A manager counts any line: 35 salt; keeper 2 scans in a product not on the order.
    expect(
      (
        await arrivals(manager, id, supplierA, [
          { lineId: lineOf(draft, salt.id).id, arrivedQtyBase: '35', previousArrivedQtyBase: null },
        ]).expect(200)
      ).body,
    ).toMatchObject({ applied: 1 });
    await http()
      .post(`/api/v1/receipts/${receiptId}/lines`)
      .set(bearer(keeper2))
      .send({ productUnitId: unitOf(soap, 'PCS').id, enteredQty: '6' })
      .expect(201);
    const page2 = await rows(manager, id, supplierA);
    expect(page2.extra.map((row) => [row.productId, row.extra])).toEqual([[soap.id, true]]);
    expect(supplierOf(await order(manager, id), supplierA).arrivedBase).toBe('91');
    // The note says 83 pieces; 50 + 35 + 6 = 91 are counted.
    expect(((await confirm(keeper2, receiptId).expect(422)).body as { code: string }).code).toBe(
      'RECEIPT_NOTE_QTY_MISMATCH',
    );
    await http()
      .patch(`/api/v1/receipts/${receiptId}`)
      .set(bearer(keeper2))
      .send({ noteTotalQty: '91' })
      .expect(200);
    const posted = (await confirm(keeper2, receiptId).expect(200)).body as ReceiptJson;
    expect(posted).toMatchObject({ status: 'POSTED', costingStatus: 'PENDING' });
    // On sale at once, on the «Тавиургүй» shelf; nothing booked for the supplier yet.
    expect(lineOf(posted, juice.id).binCode).toBe('NOSHELF');
    expect(await sellable(juice.id, wh1.id)).toBe('60.000');
    expect(await sellable(salt.id, wh2.id)).toBe('35.000');
    expect(supplierOf(await order(manager, id), supplierA).status).toBe('ACCOUNTING');
    expect(await supplierBalance(supplierA)).toBe('12000.00');

    // The accountant's price check, from the order page: the previous price beside the new one.
    const page3 = await rows(accountant, id, supplierA);
    expect(page3.rights).toMatchObject({ count: false, price: true });
    expect(rowOf(page3, juice.id).receipt?.previousUnitPrice).toBe('1200.00');
    expect(page3.receipt?.costingVersion).toBe(0);
    const costing = (
      await http().get(`/api/v1/receipts/${receiptId}/costing`).set(bearer(accountant)).expect(200)
    ).body as {
      lines: { lineId: number; productId: number; previousUnitPrice: string | null }[];
    };
    expect(costing.lines.map((line) => line.productId).sort()).toEqual(
      [juice.id, salt.id, soap.id].sort(),
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
        (
          await http()
            .put(`/api/v1/receipts/${receiptId}/costs`)
            .set(bearer(accountant))
            .set(idempotency())
            .send(prices('3000'))
            .expect(422)
        ).body as { code: string }
      ).code,
    ).toBe('RECEIPT_NOTE_AMOUNT_MISMATCH');
    // The accountant corrects the note's total (off by 0.50₮, within the tolerance).
    await http()
      .put(`/api/v1/receipts/${receiptId}/costs`)
      .set(bearer(accountant))
      .set(idempotency())
      .send({ ...prices('3000'), noteTotalAmount: '60600.50' })
      .expect(200);
    detail = supplierOf(await order(accountant, id), supplierA);
    expect(detail).toMatchObject({
      status: 'RECEIVED',
      finalAmount: '60600.00',
      priceDiffCount: 1, // juice: 1,152₮ a piece against 1,200₮ before
      canPrice: false,
    });
    // The bill: 12,000 before plus 60,600 now.
    expect(await supplierBalance(supplierA)).toBe('72600.00');
    // Supplier B is still «Бэлдэж»: the order stays there.
    expect((await order(office, id)).status).toBe('PREPARING');

    // The history holds every step, newest first, and filters by product and by user.
    const all = await history(office, id);
    const kinds = all.data.map((row) => row.kind);
    for (const kind of [
      'CREATED',
      'ORDER_QTY',
      'STATUS',
      'SHIPPED_QTY',
      'ARRIVED_QTY',
      'LINE_NOTE',
      'LINE_ADDED',
      'RECEIPT_CONFIRMED',
      'RECEIPT_POSTED',
      'PRICES',
    ]) {
      expect(kinds).toContain(kind);
    }
    expect(all.data.filter((row) => row.kind === 'STATUS')).toHaveLength(6);
    expect(
      all.data.find((row) => row.kind === 'SHIPPED_QTY' && row.productId === juice.id),
    ).toMatchObject({ from: null, to: expect.stringMatching(/^4 /) as string });
    expect(
      all.data.filter((row) => row.kind === 'ARRIVED_QTY').map((row) => [row.productId, row.to]),
    ).toEqual(
      expect.arrayContaining([
        [juice.id, '50'],
        [flour.id, '0'],
        [salt.id, '35'],
      ]),
    );
    const juiceHistory = await history(office, id, `?productId=${juice.id}`);
    expect(juiceHistory.data.length).toBeGreaterThan(0);
    expect(juiceHistory.data.every((row) => row.productId === juice.id)).toBe(true);
    expect(juiceHistory.data.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['ORDER_QTY', 'SHIPPED_QTY', 'ARRIVED_QTY', 'LINE_NOTE', 'PRICES']),
    );
    const keeper2History = await history(office, id, `?userId=${keeper2Id}`);
    expect(keeper2History.data.every((row) => row.userId === keeper2Id)).toBe(true);
    expect(keeper2History.data.map((row) => row.kind)).toEqual(
      expect.arrayContaining(['ORDER_QTY', 'LINE_ADDED', 'RECEIPT_CONFIRMED', 'RECEIPT_POSTED']),
    );
    // The two Excel files.
    for (const path of ['history.xlsx', 'export.xlsx']) {
      const file = await http()
        .get(`/api/v1/purchase-orders/${id}/${path}`)
        .set(bearer(accountant))
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toContain(XLSX_CONTENT_TYPE);
      expect((file.body as Buffer).length).toBeGreaterThan(1000);
    }

    // Archiving waits for the whole order: supplier B still prepares, so it is refused; without
    // supplier B the order is received, archived, out of the list, and back again.
    expect(
      (
        (
          await http()
            .post(`/api/v1/purchase-orders/${id}/archive`)
            .set(bearer(manager))
            .set(idempotency())
            .expect(409)
        ).body as { code: string }
      ).code,
    ).toBe('PO_NOT_ARCHIVABLE');
    await http()
      .delete(`/api/v1/purchase-orders/${id}/suppliers/${supplierB}`)
      .set(bearer(manager))
      .expect(200);
    expect((await order(manager, id)).status).toBe('RECEIVED');
    await http()
      .post(`/api/v1/purchase-orders/${id}/archive`)
      .set(bearer(office))
      .set(idempotency())
      .expect(403);
    const archived = (
      await http()
        .post(`/api/v1/purchase-orders/${id}/archive`)
        .set(bearer(manager))
        .set(idempotency())
        .expect(200)
    ).body as OrderJson;
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.suppliers[0]?.canMoveBack).toBe(false);
    const listed = async (query: string) =>
      (
        (await http().get(`/api/v1/purchase-orders${query}`).set(bearer(office)).expect(200))
          .body as { data: { id: number }[] }
      ).data.map((row) => row.id);
    expect(await listed('')).not.toContain(id);
    expect(await listed('?archived=true')).toContain(id);
    await http()
      .post(`/api/v1/purchase-orders/${id}/unarchive`)
      .set(bearer(manager))
      .set(idempotency())
      .expect(200);
    expect(await listed('')).toContain(id);
    expect((await history(office, id)).data.slice(0, 2).map((row) => row.kind)).toEqual([
      'UNARCHIVED',
      'ARCHIVED',
    ]);
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
      ordered(salt, '10'),
      ordered(juice, '1', 'BOX'),
    ]).expect(200);
    await move(manager, created.id, supplierA, 'SENT').expect(200);
    await move(manager, created.id, supplierA, 'SHIPPING').expect(200);
    // Juice was not shipped at all: it is left out of the receipt.
    await save(manager, created.id, supplierA, [
      {
        productId: juice.id,
        field: 'SHIPPED',
        productUnitId: null,
        qty: '0',
        previousUnitId: null,
        previousQty: null,
      },
    ]).expect(200);
    for (const to of ['IN_TRANSIT', 'ARRIVED']) {
      await move(manager, created.id, supplierA, to).expect(200);
    }
    const first = supplierOf(await order(manager, created.id), supplierA).receiptId as number;
    expect((await receipt(admin, first)).lines.map((line) => line.productId)).toEqual([salt.id]);
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

  it('refuses «Ирсэн» when the supplier shipped nothing at all', async () => {
    const created = (
      await http()
        .post('/api/v1/purchase-orders')
        .set(bearer(manager))
        .set(idempotency())
        .send({ supplierIds: [supplierA] })
        .expect(201)
    ).body as OrderJson;
    await save(manager, created.id, supplierA, [ordered(salt, '3')]).expect(200);
    for (const to of ['SENT', 'SHIPPING'])
      await move(manager, created.id, supplierA, to).expect(200);
    await save(manager, created.id, supplierA, [
      {
        productId: salt.id,
        field: 'SHIPPED',
        productUnitId: null,
        qty: '0',
        previousUnitId: null,
        previousQty: null,
      },
    ]).expect(200);
    await move(manager, created.id, supplierA, 'IN_TRANSIT').expect(200);
    expect(
      ((await move(manager, created.id, supplierA, 'ARRIVED').expect(409)).body as { code: string })
        .code,
    ).toBe('PO_SUPPLIER_EMPTY');
  });
});
