import type { NestExpressApplication } from '@nestjs/platform-express';
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
  errors?: { path: string; constraint: string }[];
}
interface StageJson {
  id: number;
  name: string;
  position: number;
  action: string;
  archivedAt: string | null;
  canView: boolean;
  canEdit: boolean;
  canMove: boolean;
}
interface BoardJson {
  id: number;
  name: string;
  branchId: number | null;
  canManage: boolean;
  stages: StageJson[];
}
interface CardsJson {
  stageId: number;
  count: number;
  total: string;
  cards: { id: number; number: string | null; status: string; customerName: string }[];
}

/**
 * Order boards (ADR-0056): configuring boards and stages with rights by role, where new orders
 * land, moving cards with the stage actions (reserve, pick, sale, cancel), editing a reserved
 * order, the picked counts and the stock they move. Synthetic data only.
 */
describe('sales boards', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let picker: string;
  let accountant: string;
  let wh: WarehouseJson;
  let shelf: number;
  let cola: ProductJson;
  let water: ProductJson;
  let shop: CustomerJson;
  let board: BoardJson;
  let roleIds: { office: number; warehouse: number; accountant: number };
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const stage = (name: string) => {
    const found = board.stages.find((entry) => entry.name === name);
    if (!found) throw new Error(`no stage ${name}`);
    return found;
  };
  const boards = (token: string) => ({
    get: async (id: number) =>
      (await http().get(`/api/v1/sales-boards/${id}`).set(bearer(token)).expect(200))
        .body as BoardJson,
    cards: async (id: number) =>
      (await http().get(`/api/v1/sales-boards/${id}/cards`).set(bearer(token)).expect(200))
        .body as CardsJson[],
    move: (orderId: number, stageId: number, reason?: string) =>
      http()
        .post(`/api/v1/sales-orders/${orderId}/move`)
        .set(bearer(token))
        .set(idempotency())
        .send({ stageId, ...(reason ? { reason } : {}) }),
  });
  const stageBody = (name: string, action: string, fields: Record<string, unknown> = {}) => ({
    name,
    action,
    printPickList: false,
    printDeliveryNote: false,
    roles: { VIEW: [], EDIT: [], MOVE: [] },
    ...fields,
  });
  const stockOf = async (productId: number) =>
    (
      await sql.query<{ bin: string; on_hand: string; ws: string; reserved: string }>(
        `SELECT b.code AS bin, bs.on_hand::text,
                (SELECT sellable_on_hand::text FROM warehouse_stock WHERE product_id = $1 AND lot_id IS NULL) AS ws,
                (SELECT reserved::text FROM warehouse_stock WHERE product_id = $1 AND lot_id IS NULL) AS reserved
           FROM bin_stock bs JOIN bins b ON b.id = bs.bin_id
          WHERE bs.product_id = $1 AND bs.on_hand <> 0 ORDER BY b.code`,
        [productId],
      )
    ).rows;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    office = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
    picker = (await login(app, await seedUser(app, { roles: ['WAREHOUSE'] }))).accessToken;
    accountant = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] }))).accessToken;
    const roles = (
      (await http().get('/api/v1/roles').set(bearer(admin)).expect(200)).body as {
        data: { id: number; code: string | null }[];
      }
    ).data;
    const roleId = (code: string) => {
      const found = roles.find((role) => role.code === code);
      if (!found) throw new Error(`no role ${code}`);
      return found.id;
    };
    roleIds = {
      office: roleId('OFFICE'),
      warehouse: roleId('WAREHOUSE'),
      accountant: roleId('ACCOUNTANT'),
    };
    const inventory = inventoryApi(app, admin);
    wh = await inventory.warehouse('SB1');
    shelf = (await inventory.bin(wh.id, 'A-01-01')).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Самбарын бараа');
    const base = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '7901',
      name: 'Кола',
      categoryId: category,
      baseUomId: base,
    });
    water = await catalog.product({
      sku: '7902',
      name: 'Ус',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(cola.id, wh.id);
    await inventory.setHome(water.id, wh.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Самбар: Ундаа');
    await pricing.terms(cola.id, '1000', profile, null);
    await pricing.terms(water.id, '500', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, water.id] })
      .expect(200);
    for (const [product, qty] of [
      [cola, '20'],
      [water, '5'],
    ] as const) {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          reason: 'SURPLUS',
          lines: [{ productUnitId: pcs(product), enteredQty: qty, binId: shelf, unitCost: '700' }],
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
    shop = await partnersApi(app, admin).customer({ name: 'Самбарын дэлгүүр' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('is configured by an admin: a board, its stages, rights and where new orders land', async () => {
    await http()
      .post('/api/v1/sales-boards')
      .set(bearer(office))
      .send({ name: 'Мөрөн' })
      .expect(403);
    const created = (
      await http()
        .post('/api/v1/sales-boards')
        .set(bearer(admin))
        .send({ name: '  Мөрөн  ' })
        .expect(201)
    ).body as BoardJson;
    expect(created).toMatchObject({ name: 'Мөрөн', branchId: null, canManage: true, stages: [] });
    const add = (body: Record<string, unknown>) =>
      http().post(`/api/v1/sales-boards/${created.id}/stages`).set(bearer(admin)).send(body);
    await add(stageBody('ХТ Захиалга', 'NONE')).expect(201);
    await add(
      stageBody('Нярав Хяналт', 'CONFIRM', {
        printPickList: true,
        roles: { VIEW: [], EDIT: [roleIds.accountant], MOVE: [roleIds.accountant, roleIds.office] },
      }),
    ).expect(201);
    await add(
      stageBody('Бэлдэх', 'PICK', { roles: { VIEW: [], EDIT: [], MOVE: [roleIds.warehouse] } }),
    ).expect(201);
    await add(stageBody('Борлуулалт', 'SALE', { printDeliveryNote: true })).expect(201);
    await add(stageBody('Цуцалсан', 'CANCEL')).expect(201);
    board = (
      await add(
        stageBody('Хаалттай', 'NONE', {
          roles: { VIEW: [roleIds.accountant], EDIT: [], MOVE: [] },
        }),
      ).expect(201)
    ).body as BoardJson;
    expect(board.stages.map((entry) => `${entry.position}:${entry.name}`)).toEqual([
      '0:ХТ Захиалга',
      '1:Нярав Хяналт',
      '2:Бэлдэх',
      '3:Борлуулалт',
      '4:Цуцалсан',
      '5:Хаалттай',
    ]);
    // A role that does not exist is a field error, not a crash.
    expect(
      (
        (
          await add(
            stageBody('X', 'NONE', { roles: { VIEW: [999999], EDIT: [], MOVE: [] } }),
          ).expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'roles' })]);
    // Reorder: the closed stage before the cancelled one.
    const order = board.stages.map((entry) => entry.id);
    const closed = order.pop() ?? 0;
    order.splice(4, 0, closed);
    board = (
      await http()
        .put(`/api/v1/sales-boards/${created.id}/stage-order`)
        .set(bearer(admin))
        .send({ stageIds: order })
        .expect(200)
    ).body as BoardJson;
    expect(board.stages.map((entry) => entry.name)).toEqual([
      'ХТ Захиалга',
      'Нярав Хяналт',
      'Бэлдэх',
      'Борлуулалт',
      'Хаалттай',
      'Цуцалсан',
    ]);
    await http()
      .put(`/api/v1/sales-boards/${created.id}/stage-order`)
      .set(bearer(admin))
      .send({ stageIds: order.slice(1) })
      .expect(422);
    // The office's orders land in «ХТ Захиалга».
    await http()
      .put('/api/v1/sales-boards/defaults')
      .set(bearer(admin))
      .send({ channel: 'ADMIN', boardId: board.id, stageId: stage('ХТ Захиалга').id })
      .expect(200);
    await http()
      .put('/api/v1/sales-boards/defaults')
      .set(bearer(admin))
      .send({ channel: 'SALES_REP', boardId: board.id, stageId: 999999 })
      .expect(404);
    // Rights as the office and the picker see them.
    const seen = await boards(office).get(board.id);
    expect(seen.canManage).toBe(false);
    expect(
      seen.stages.map((entry) => [entry.name, entry.canView, entry.canEdit, entry.canMove]),
    ).toEqual([
      ['ХТ Захиалга', true, true, true],
      ['Нярав Хяналт', true, false, true],
      ['Бэлдэх', true, true, false],
      ['Борлуулалт', true, true, true],
      ['Хаалттай', false, true, true],
      ['Цуцалсан', true, true, true],
    ]);
    const pickerSees = await boards(picker).get(board.id);
    expect(pickerSees.stages.find((entry) => entry.name === 'Бэлдэх')).toMatchObject({
      canMove: true,
      canEdit: false,
    });
    // A board only the accountant sees is hidden from the office.
    const hidden = (
      await http()
        .post('/api/v1/sales-boards')
        .set(bearer(admin))
        .send({ name: 'Нягтлангийн' })
        .expect(201)
    ).body as BoardJson;
    await http()
      .put(`/api/v1/sales-boards/${hidden.id}/roles`)
      .set(bearer(admin))
      .send({ VIEW: [roleIds.accountant], MANAGE: [] })
      .expect(200);
    const list = (await http().get('/api/v1/sales-boards').set(bearer(office)).expect(200))
      .body as BoardJson[];
    expect(list.map((entry) => entry.name)).toEqual(['Мөрөн']);
    await http().get(`/api/v1/sales-boards/${hidden.id}`).set(bearer(office)).expect(404);
    await http().get(`/api/v1/sales-boards/${hidden.id}`).set(bearer(accountant)).expect(200);
  });

  it('runs the stage actions as a card moves: reserve, edit, pick, sale', async () => {
    const orders = salesApi(app, office);
    const draft = await orders.draft(
      orderBody(shop.id, [
        { productUnitId: pcs(cola), qty: '12' },
        { productUnitId: pcs(water), qty: '8' },
      ]),
    );
    expect(draft).toMatchObject({ boardName: 'Мөрөн', stageName: 'ХТ Захиалга', status: 'DRAFT' });
    expect(draft.moves).toEqual([
      expect.objectContaining({ fromStageId: null, toStageId: stage('ХТ Захиалга').id }),
    ]);
    const first = await boards(office).cards(board.id);
    expect(first.find((entry) => entry.stageId === stage('ХТ Захиалга').id)).toMatchObject({
      count: 1,
      total: '0',
      cards: [{ id: draft.id, number: null, status: 'DRAFT', customerName: 'Самбарын дэлгүүр' }],
    });

    // The picker may not move into «Нярав Хяналт»; the office may, and the draft is reserved.
    await boards(picker).move(draft.id, stage('Нярав Хяналт').id).expect(403);
    const reserved = (await boards(office).move(draft.id, stage('Нярав Хяналт').id).expect(200))
      .body as { order: OrderJson; print: string[] };
    expect(reserved.print).toEqual(['PICK_LIST']);
    expect(reserved.order).toMatchObject({ status: 'CONFIRMED', stageName: 'Нярав Хяналт' });
    expect(reserved.order.number).toMatch(/^SO-/);
    expect(reserved.order.lines.map((line) => [line.qtyApproved, line.qtyBackordered])).toEqual([
      ['12', '0'],
      ['5', '3'],
    ]);
    expect((await stockOf(cola.id))[0]).toMatchObject({
      bin: 'A-01-01',
      on_hand: '20.000',
      reserved: '12.000',
    });
    // Moving back undoes nothing.
    await boards(office).move(draft.id, stage('ХТ Захиалга').id).expect(200);
    expect((await orders.get(draft.id)).status).toBe('CONFIRMED');

    // The reserved order is edited in «ХТ Захиалга» (the office may edit there): 15 cola now.
    const edited = (
      await orders
        .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '15' }]))
        .expect(200)
    ).body as OrderJson;
    expect(edited).toMatchObject({
      status: 'CONFIRMED',
      number: reserved.order.number,
      total: '15000',
    });
    expect(edited.lines.map((line) => [line.qtyApproved, line.qtyBackordered])).toEqual([
      ['15', '0'],
    ]);
    expect((await stockOf(cola.id))[0]).toMatchObject({ reserved: '15.000' });
    expect((await stockOf(water.id))[0]).toMatchObject({ reserved: '0.000' });
    // The accountant may not edit in «Нярав Хяналт»… the office may not either there.
    await boards(office).move(draft.id, stage('Нярав Хяналт').id).expect(200);
    await orders
      .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(403);

    // A sale before picking is refused; «Бэлдэх» starts picking (the picker's stage).
    expect(
      (
        (await boards(office).move(draft.id, stage('Борлуулалт').id).expect(409))
          .body as ProblemJson
      ).code,
    ).toBe('ORDER_STATE_INVALID');
    await boards(office).move(draft.id, stage('Бэлдэх').id).expect(403);
    const picking = (await boards(picker).move(draft.id, stage('Бэлдэх').id).expect(200)).body as {
      order: OrderJson;
    };
    expect(picking.order.status).toBe('PICKING');
    const info = (
      await http().get(`/api/v1/sales-orders/${draft.id}/pick-info`).set(bearer(picker)).expect(200)
    ).body as {
      lineId: number;
      proposedBinId: number | null;
      bins: { code: string; onHand: string }[];
    }[];
    expect(info).toEqual([
      {
        lineId: edited.lines[0]?.id,
        warehouseId: wh.id,
        proposedBinId: shelf,
        bins: [{ id: shelf, code: 'A-01-01', onHand: '20' }],
      },
    ]);
    // The office may not pick; the picker picks 14 of 15 (short by one).
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/pick`)
      .set(bearer(office))
      .set(idempotency())
      .send({ lines: [{ lineId: edited.lines[0]?.id, qty: '14', binId: shelf }] })
      .expect(403);
    const packed = (
      await http()
        .post(`/api/v1/sales-orders/${draft.id}/pick`)
        .set(bearer(picker))
        .set(idempotency())
        .send({ lines: [{ lineId: edited.lines[0]?.id, qty: '14', binId: shelf }] })
        .expect(200)
    ).body as OrderJson;
    expect(packed).toMatchObject({ status: 'PACKED' });
    expect(packed.lines[0]).toMatchObject({
      qtyPicked: '14',
      pickBinCode: 'A-01-01',
      qtyDelivered: null,
    });
    expect(await stockOf(cola.id)).toEqual([
      { bin: 'A-01-01', on_hand: '6.000', ws: '6.000', reserved: '0.000' },
      { bin: 'STAGING', on_hand: '14.000', ws: '6.000', reserved: '0.000' },
    ]);
    const consumed = await sql.query<{ status: string }>(
      `SELECT status FROM stock_reservations WHERE doc_type = 'SO' AND doc_id = $1 ORDER BY id`,
      [draft.id],
    );
    // The first two lines' reservations went with the edit; the edited line's was consumed.
    expect(consumed.rows.map((row) => row.status)).toEqual(['RELEASED', 'RELEASED', 'CONSUMED']);
    // Picked twice is refused; a packed order is not edited.
    expect(
      (
        (
          await http()
            .post(`/api/v1/sales-orders/${draft.id}/pick`)
            .set(bearer(picker))
            .set(idempotency())
            .send({ lines: [{ lineId: edited.lines[0]?.id, qty: '1', binId: shelf }] })
            .expect(409)
        ).body as ProblemJson
      ).code,
    ).toBe('ORDER_STATE_INVALID');
    await orders
      .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(409);

    // The sale: stock leaves STAGING under the order's number.
    const sold = (await boards(office).move(draft.id, stage('Борлуулалт').id).expect(200)).body as {
      order: OrderJson;
      print: string[];
    };
    expect(sold.print).toEqual(['DELIVERY_NOTE']);
    expect(sold.order).toMatchObject({ status: 'DELIVERED', stageName: 'Борлуулалт' });
    expect(sold.order.lines[0]).toMatchObject({ qtyDelivered: '14' });
    expect(await stockOf(cola.id)).toEqual([
      { bin: 'A-01-01', on_hand: '6.000', ws: '6.000', reserved: '0.000' },
    ]);
    const ledger = await sql.query<{
      movement_type: string;
      qty: string;
      doc_number: string | null;
    }>(
      `SELECT movement_type, qty_base::text AS qty FROM stock_ledger WHERE doc_type = 'SO' AND doc_id = $1 ORDER BY id`,
      [draft.id],
    );
    expect(ledger.rows).toEqual([
      { movement_type: 'PICK_OUT', qty: '-14.000' },
      { movement_type: 'PICK_IN', qty: '14.000' },
      { movement_type: 'DELIVERY_ISSUE', qty: '-14.000' },
    ]);
    const history = (
      await http()
        .get('/api/v1/stock/movements')
        .query({ docType: 'SO', productId: cola.id })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { docNumber: string | null }[] };
    expect(history.data.map((row) => row.docNumber)).toEqual([
      reserved.order.number,
      reserved.order.number,
      reserved.order.number,
    ]);
    const events = (await orders.get(draft.id)).events.map((event) => event.toStatus);
    expect(events).toEqual(['DRAFT', 'SUBMITTED', 'CONFIRMED', 'PICKING', 'PACKED', 'DELIVERED']);
    const totals = await boards(office).cards(board.id);
    expect(totals.find((entry) => entry.stageId === stage('Борлуулалт').id)).toMatchObject({
      count: 1,
      total: '15000',
    });
  });

  it('cancels through a CANCEL stage with a reason and refuses archiving a stage in use', async () => {
    const orders = salesApi(app, office);
    const draft = await orders.draft(orderBody(shop.id, [{ productUnitId: pcs(water), qty: '2' }]));
    await boards(office).move(draft.id, stage('Нярав Хяналт').id).expect(200);
    expect((await stockOf(water.id))[0]).toMatchObject({ reserved: '2.000' });
    await boards(office).move(draft.id, stage('Цуцалсан').id).expect(422);
    const cancelled = (
      await boards(office).move(draft.id, stage('Цуцалсан').id, 'Харилцагч татгалзсан').expect(200)
    ).body as { order: OrderJson };
    expect(cancelled.order).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Харилцагч татгалзсан',
    });
    expect((await stockOf(water.id))[0]).toMatchObject({ reserved: '0.000' });
    expect(
      (
        (
          await http()
            .delete(`/api/v1/sales-stages/${stage('Цуцалсан').id}`)
            .set(bearer(admin))
            .expect(409)
        ).body as ProblemJson
      ).code,
    ).toBe('STAGE_IN_USE');
    expect(
      (
        (
          await http()
            .delete(`/api/v1/sales-stages/${stage('ХТ Захиалга').id}`)
            .set(bearer(admin))
            .expect(409)
        ).body as ProblemJson
      ).params,
    ).toEqual({ channel: 'ADMIN' });
    const trimmed = (
      await http()
        .delete(`/api/v1/sales-stages/${stage('Хаалттай').id}`)
        .set(bearer(admin))
        .expect(200)
    ).body as BoardJson;
    expect(trimmed.stages.find((entry) => entry.name === 'Хаалттай')?.archivedAt).not.toBeNull();
    // An order on no board cannot be moved; one made without a default has none.
    await http()
      .put('/api/v1/sales-boards/defaults')
      .set(bearer(admin))
      .send({ channel: 'ADMIN', boardId: null, stageId: null })
      .expect(200);
    const loose = await orders.draft(orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }]));
    expect(loose.boardId).toBeNull();
    expect(
      (
        (await boards(office).move(loose.id, stage('ХТ Захиалга').id).expect(409))
          .body as ProblemJson
      ).params,
    ).toMatchObject({
      expected: 'ON_BOARD',
    });
    const chosen = await orders.draft(
      orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], { boardId: board.id }),
    );
    expect(chosen).toMatchObject({ boardId: board.id, stageName: 'ХТ Захиалга' });
  });
});
