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
  errors?: { path: string; constraint: string }[];
}
interface StageJson {
  id: number;
  name: string;
  position: number;
  action: string;
  cardSort: string;
  archivedAt: string | null;
  canView: boolean;
  canEdit: boolean;
  canMove: boolean;
}
interface PipelineJson {
  id: number;
  boardId: number;
  name: string;
  canManage: boolean;
  seesAll: boolean;
  stages: StageJson[];
}
interface CardsJson {
  stageId: number;
  count: number;
  total: string;
  cards: {
    id: number;
    number: string | null;
    status: string;
    customerName: string;
    paymentMethod: string;
    createdByName: string | null;
  }[];
}
interface PageJson {
  data: { id: number; stageName: string | null; archivedAt: string | null }[];
  total: number | null;
}

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const NO_ROLES = { VIEW: [], MANAGE: [], ALL_ORDERS: [] };
const stageBody = (name: string, action: string, fields: Record<string, unknown> = {}) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
  ...fields,
});
/** A stage as the whole save sends it back: its id, settings and roles. */
const kept = (stage: StageJson & { printPickList?: boolean; printDeliveryNote?: boolean }) => ({
  id: stage.id,
  name: stage.name,
  action: stage.action,
  printPickList: stage.printPickList ?? false,
  printDeliveryNote: stage.printDeliveryNote ?? false,
  roles: (stage as unknown as { roles: typeof ROLES }).roles,
});

/**
 * Order pipelines (ADR-0056, ADR-0057): configuring a pipeline and its stages with rights by role,
 * where new orders land, moving cards with the stage actions (reserve, pick, sale, cancel),
 * editing a reserved order, the picked counts and the stock they move; the cards in each stage's
 * sort, the filters, archiving finished orders and pipelines that show each user their own
 * orders. Synthetic data only.
 */
describe('sales boards', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let office: string;
  let office2: string;
  let picker: string;
  let accountant: string;
  let wh: WarehouseJson;
  let shelf: number;
  let cola: ProductJson;
  let water: ProductJson;
  let shop: CustomerJson;
  let other: CustomerJson;
  let boardId: number;
  let pipeline: PipelineJson;
  let roleIds: { office: number; warehouse: number; accountant: number };
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const stage = (name: string, of: PipelineJson = pipeline) => {
    const found = of.stages.find((entry) => entry.name === name && entry.archivedAt === null);
    if (!found) throw new Error(`no stage ${name}`);
    return found;
  };
  const api = (token: string) => ({
    pipeline: async (id: number) =>
      (await http().get(`/api/v1/sales-pipelines/${id}`).set(bearer(token)).expect(200))
        .body as PipelineJson,
    cards: async (id: number, query: Record<string, unknown> = {}) =>
      (
        await http()
          .get(`/api/v1/sales-pipelines/${id}/cards`)
          .query(query)
          .set(bearer(token))
          .expect(200)
      ).body as CardsJson[],
    list: async (query: Record<string, unknown>) =>
      (await http().get('/api/v1/sales-orders').query(query).set(bearer(token)).expect(200))
        .body as PageJson,
    move: (orderId: number, stageId: number, reason?: string) =>
      http()
        .post(`/api/v1/sales-orders/${orderId}/move`)
        .set(bearer(token))
        .set(idempotency())
        .send({ stageId, ...(reason ? { reason } : {}) }),
    createPipeline: (body: Record<string, unknown>) =>
      http().post('/api/v1/sales-pipelines').set(bearer(token)).send(body),
  });
  const cardsOf = (all: CardsJson[], stageId: number) =>
    all.find((entry) => entry.stageId === stageId);
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
    office2 = (await login(app, await seedUser(app, { roles: ['OFFICE'] }))).accessToken;
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
    other = await partnersApi(app, admin).customer({ name: 'Өөр хүнсний төв' });
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('is configured by an admin: a pipeline, its stages, rights and where new orders land', async () => {
    boardId = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Мөрөн' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const body = {
      boardId,
      name: '  Мөрөн Борлуулалт  ',
      visibility: 'PUBLIC',
      ownOrdersOnly: false,
      roles: NO_ROLES,
      stages: [
        stageBody('ХТ Захиалга', 'NONE'),
        stageBody('Нярав Хяналт', 'CONFIRM', {
          printPickList: true,
          roles: {
            VIEW: [],
            EDIT: [roleIds.accountant],
            MOVE: [roleIds.accountant, roleIds.office],
          },
        }),
        stageBody('Бэлдэх', 'PICK', { roles: { VIEW: [], EDIT: [], MOVE: [roleIds.warehouse] } }),
        stageBody('Борлуулалт', 'SALE', { printDeliveryNote: true }),
        stageBody('Цуцалсан', 'CANCEL'),
        stageBody('Хаалттай', 'NONE', {
          roles: { VIEW: [roleIds.accountant], EDIT: [], MOVE: [] },
        }),
      ],
    };
    await api(office).createPipeline(body).expect(403);
    // A role that does not exist is a field error, not a crash.
    expect(
      (
        (
          await api(admin)
            .createPipeline({
              ...body,
              stages: [stageBody('X', 'NONE', { roles: { VIEW: [999999], EDIT: [], MOVE: [] } })],
            })
            .expect(422)
        ).body as ProblemJson
      ).errors,
    ).toEqual([expect.objectContaining({ path: 'roles' })]);
    pipeline = (await api(admin).createPipeline(body).expect(201)).body as PipelineJson;
    expect(pipeline).toMatchObject({ boardId, name: 'Мөрөн Борлуулалт', canManage: true });
    expect(pipeline.stages.map((entry) => `${entry.position}:${entry.name}`)).toEqual([
      '0:ХТ Захиалга',
      '1:Нярав Хяналт',
      '2:Бэлдэх',
      '3:Борлуулалт',
      '4:Цуцалсан',
      '5:Хаалттай',
    ]);
    // Saved whole with the closed stage before the cancelled one.
    const full = (await api(admin).pipeline(pipeline.id)) as PipelineJson & {
      stages: (StageJson & { printPickList: boolean; printDeliveryNote: boolean })[];
    };
    const stages = full.stages.map(kept);
    const closed = stages.pop();
    if (closed) stages.splice(4, 0, closed);
    pipeline = (
      await http()
        .put(`/api/v1/sales-pipelines/${pipeline.id}`)
        .set(bearer(admin))
        .send({ ...body, stages })
        .expect(200)
    ).body as PipelineJson;
    expect(pipeline.stages.map((entry) => entry.name)).toEqual([
      'ХТ Захиалга',
      'Нярав Хяналт',
      'Бэлдэх',
      'Борлуулалт',
      'Хаалттай',
      'Цуцалсан',
    ]);
    // The office's orders land in «ХТ Захиалга».
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(office))
      .send({ channel: 'ADMIN', pipelineId: pipeline.id, stageId: stage('ХТ Захиалга').id })
      .expect(403);
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'ADMIN', pipelineId: pipeline.id, stageId: stage('ХТ Захиалга').id })
      .expect(200);
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'SALES_REP', pipelineId: pipeline.id, stageId: 999999 })
      .expect(422);
    // Rights as the office and the picker see them.
    const seen = await api(office).pipeline(pipeline.id);
    expect(seen).toMatchObject({ canManage: false, seesAll: true });
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
    const pickerSees = await api(picker).pipeline(pipeline.id);
    expect(stage('Бэлдэх', pickerSees)).toMatchObject({ canMove: true, canEdit: false });
    // A private pipeline only the accountant sees is hidden from the office, its board too.
    const privateBoard = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Нягтлан' })
          .expect(201)
      ).body as { id: number }
    ).id;
    const hidden = (
      await api(admin)
        .createPipeline({
          ...body,
          boardId: privateBoard,
          name: 'Нягтлангийн',
          visibility: 'PRIVATE',
          roles: { ...NO_ROLES, VIEW: [roleIds.accountant] },
          stages: [stageBody('Нэг', 'NONE')],
        })
        .expect(201)
    ).body as PipelineJson;
    const tree = (await http().get('/api/v1/sales-boards').set(bearer(office)).expect(200))
      .body as { name: string; pipelines: { name: string }[] }[];
    expect(tree.map((board) => [board.name, board.pipelines.map((p) => p.name)])).toEqual([
      ['Мөрөн', ['Мөрөн Борлуулалт']],
    ]);
    await http().get(`/api/v1/sales-pipelines/${hidden.id}`).set(bearer(office)).expect(404);
    await http().get(`/api/v1/sales-pipelines/${hidden.id}`).set(bearer(accountant)).expect(200);
  });

  it('runs the stage actions as a card moves: reserve, edit, pick, sale', async () => {
    const orders = salesApi(app, office);
    const draft = await orders.draft(
      orderBody(shop.id, [
        { productUnitId: pcs(cola), qty: '12' },
        { productUnitId: pcs(water), qty: '8' },
      ]),
    );
    expect(draft).toMatchObject({
      boardName: 'Мөрөн',
      pipelineName: 'Мөрөн Борлуулалт',
      stageName: 'ХТ Захиалга',
      status: 'DRAFT',
      canEdit: true,
    });
    // Numbered when created (ADR-0057 #3).
    expect(draft.number).toMatch(/^\d{8}_\d{4}$/);
    expect(draft.moves).toEqual([
      expect.objectContaining({ fromStageId: null, toStageId: stage('ХТ Захиалга').id }),
    ]);
    expect(cardsOf(await api(office).cards(pipeline.id), stage('ХТ Захиалга').id)).toMatchObject({
      count: 1,
      total: '0',
      cards: [
        {
          id: draft.id,
          number: draft.number,
          status: 'DRAFT',
          customerName: 'Самбарын дэлгүүр',
          // The card's label and who entered it (ADR-0058).
          paymentMethod: 'CASH',
          createdByName: expect.any(String),
        },
      ],
    });

    // The picker may not move into «Нярав Хяналт»; the office may, and the draft is reserved.
    await api(picker).move(draft.id, stage('Нярав Хяналт').id).expect(403);
    const reserved = (await api(office).move(draft.id, stage('Нярав Хяналт').id).expect(200))
      .body as { order: OrderJson; print: string[] };
    expect(reserved.print).toEqual(['PICK_LIST']);
    expect(reserved.order).toMatchObject({
      status: 'CONFIRMED',
      stageName: 'Нярав Хяналт',
      number: draft.number,
    });
    expect(reserved.order.lines.map((line) => [line.qtyApproved, line.qtyBackordered])).toEqual([
      ['12', '0'],
      ['5', '3'],
    ]);
    // The activity names who moved it and between which stages (ADR-0059).
    expect(reserved.order.moves.at(-1)).toMatchObject({
      fromStageName: 'ХТ Захиалга',
      toStageName: 'Нярав Хяналт',
      actorName: expect.any(String),
    });
    expect(reserved.order.moves[0]).toMatchObject({
      fromStageName: null,
      toStageName: 'ХТ Захиалга',
    });
    expect(reserved.order.events.at(-1)).toMatchObject({
      toStatus: 'CONFIRMED',
      actorName: expect.any(String),
    });
    expect((await stockOf(cola.id))[0]).toMatchObject({
      bin: 'A-01-01',
      on_hand: '20.000',
      reserved: '12.000',
    });
    // Moving back undoes nothing.
    await api(office).move(draft.id, stage('ХТ Захиалга').id).expect(200);
    expect((await orders.get(draft.id)).status).toBe('CONFIRMED');

    // The reserved order is edited in «ХТ Захиалга» (the office may edit there): 15 cola now.
    const edited = (
      await orders
        .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '15' }]))
        .expect(200)
    ).body as OrderJson;
    expect(edited).toMatchObject({ status: 'CONFIRMED', number: draft.number, total: '15000' });
    expect(edited.lines.map((line) => [line.qtyApproved, line.qtyBackordered])).toEqual([
      ['15', '0'],
    ]);
    expect((await stockOf(cola.id))[0]).toMatchObject({ reserved: '15.000' });
    expect((await stockOf(water.id))[0]).toMatchObject({ reserved: '0.000' });
    // In «Нярав Хяналт» only the accountant edits.
    await api(office).move(draft.id, stage('Нярав Хяналт').id).expect(200);
    expect((await orders.get(draft.id)).canEdit).toBe(false);
    await orders
      .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(403);

    // A sale before picking is refused, naming the warehouse not picked (ADR-0126); «Бэлдэх» starts
    // picking (the picker's stage).
    expect(
      ((await api(office).move(draft.id, stage('Борлуулалт').id).expect(409)).body as ProblemJson)
        .code,
    ).toBe('PICK_INCOMPLETE');
    await api(office).move(draft.id, stage('Бэлдэх').id).expect(403);
    const picking = (await api(picker).move(draft.id, stage('Бэлдэх').id).expect(200)).body as {
      order: OrderJson;
    };
    expect(picking.order.status).toBe('PICKING');
    const info = (
      await http().get(`/api/v1/sales-orders/${draft.id}/pick-info`).set(bearer(picker)).expect(200)
    ).body as unknown[];
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
    await orders
      .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(409);

    // The sale: stock leaves STAGING under the order's number.
    const sold = (await api(office).move(draft.id, stage('Борлуулалт').id).expect(200)).body as {
      order: OrderJson;
      print: string[];
    };
    expect(sold.print).toEqual(['DELIVERY_NOTE']);
    // Finance invoices the sale in the same transaction (ADR-0060 #3): the order ends INVOICED.
    expect(sold.order).toMatchObject({ status: 'INVOICED', stageName: 'Борлуулалт' });
    expect(sold.order.lines[0]).toMatchObject({ qtyDelivered: '14' });
    expect(await stockOf(cola.id)).toEqual([
      { bin: 'A-01-01', on_hand: '6.000', ws: '6.000', reserved: '0.000' },
    ]);
    const history = (
      await http()
        .get('/api/v1/stock/movements')
        .query({ docType: 'SO', productId: cola.id })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { docNumber: string | null }[] };
    expect(history.data.map((row) => row.docNumber)).toEqual([
      draft.number,
      draft.number,
      draft.number,
    ]);
    const events = (await orders.get(draft.id)).events.map((event) => event.toStatus);
    expect(events).toEqual([
      'DRAFT',
      'SUBMITTED',
      'CONFIRMED',
      'PICKING',
      'PACKED',
      'DELIVERED',
      'INVOICED',
    ]);
    expect(cardsOf(await api(office).cards(pipeline.id), stage('Борлуулалт').id)).toMatchObject({
      count: 1,
      total: '15000',
    });

    // Finished, it may leave the board: archived, it is gone from the cards, kept in the list.
    const archived = (
      await http().post(`/api/v1/sales-orders/${draft.id}/archive`).set(bearer(office)).expect(200)
    ).body as OrderJson;
    expect(archived.archivedAt).not.toBeNull();
    expect(cardsOf(await api(office).cards(pipeline.id), stage('Борлуулалт').id)).toMatchObject({
      count: 0,
      total: '0',
    });
    expect(
      (await api(office).list({ pipeline: pipeline.id })).data.map((row) => row.id),
    ).not.toContain(draft.id);
    expect(
      (await api(office).list({ pipeline: pipeline.id, archived: 'only' })).data.map(
        (row) => row.id,
      ),
    ).toEqual([draft.id]);
    await http().post(`/api/v1/sales-orders/${draft.id}/unarchive`).set(bearer(office)).expect(200);
    expect(cardsOf(await api(office).cards(pipeline.id), stage('Борлуулалт').id)?.count).toBe(1);
    // An unfinished order is not archived.
    const open = await orders.draft(orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }]));
    expect(
      (
        (
          await http()
            .post(`/api/v1/sales-orders/${open.id}/archive`)
            .set(bearer(office))
            .expect(409)
        ).body as ProblemJson
      ).params,
    ).toMatchObject({ expected: 'FINISHED' });
    await orders.cancel(open.id, 'Тест').expect(200);
  });

  it('cancels through a CANCEL stage and archives a stage only without unfinished orders', async () => {
    const orders = salesApi(app, office);
    const draft = await orders.draft(orderBody(shop.id, [{ productUnitId: pcs(water), qty: '2' }]));
    await api(office).move(draft.id, stage('Нярав Хяналт').id).expect(200);
    expect((await stockOf(water.id))[0]).toMatchObject({ reserved: '2.000' });
    // The reserved order holds «Нярав Хяналт».
    expect(
      (
        (
          await http()
            .delete(`/api/v1/sales-stages/${stage('Нярав Хяналт').id}`)
            .set(bearer(admin))
            .expect(409)
        ).body as ProblemJson
      ).params,
    ).toMatchObject({ name: 'Нярав Хяналт', count: 1 });
    await api(office).move(draft.id, stage('Цуцалсан').id).expect(422);
    const cancelled = (
      await api(office).move(draft.id, stage('Цуцалсан').id, 'Харилцагч татгалзсан').expect(200)
    ).body as { order: OrderJson };
    expect(cancelled.order).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'Харилцагч татгалзсан',
    });
    expect((await stockOf(water.id))[0]).toMatchObject({ reserved: '0.000' });
    // A channel lands in «ХТ Захиалга».
    expect(
      (
        (
          await http()
            .delete(`/api/v1/sales-stages/${stage('ХТ Захиалга').id}`)
            .set(bearer(admin))
            .expect(409)
        ).body as ProblemJson
      ).params,
    ).toMatchObject({ channel: 'ADMIN', name: 'ХТ Захиалга' });
    // The cancelled stage's finished cards are archived from its menu; the office may not archive
    // the stage itself, the admin may (finished orders do not hold it).
    const archivedCards = (
      await http()
        .post(`/api/v1/sales-stages/${stage('Цуцалсан').id}/archive-cards`)
        .set(bearer(office))
        .expect(200)
    ).body as { archived: number };
    expect(archivedCards.archived).toBeGreaterThanOrEqual(1);
    expect(cardsOf(await api(office).cards(pipeline.id), stage('Цуцалсан').id)?.count).toBe(0);
    await http()
      .delete(`/api/v1/sales-stages/${stage('Хаалттай').id}`)
      .set(bearer(office))
      .expect(403);
    const trimmed = (
      await http()
        .delete(`/api/v1/sales-stages/${stage('Хаалттай').id}`)
        .set(bearer(admin))
        .expect(200)
    ).body as PipelineJson;
    expect(trimmed.stages.find((entry) => entry.name === 'Хаалттай')?.archivedAt).not.toBeNull();
    pipeline = trimmed;
    // An order in no pipeline cannot be moved; one made without a default has none.
    await http()
      .put('/api/v1/sales-settings/channels')
      .set(bearer(admin))
      .send({ channel: 'ADMIN', pipelineId: null, stageId: null })
      .expect(200);
    const loose = await orders.draft(orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }]));
    expect(loose.pipelineId).toBeNull();
    expect(
      ((await api(office).move(loose.id, stage('ХТ Захиалга').id).expect(409)).body as ProblemJson)
        .params,
    ).toMatchObject({ expected: 'ON_BOARD' });
    expect((await api(office).list({ pipeline: 'none' })).data.map((row) => row.id)).toContain(
      loose.id,
    );
    const chosen = await orders.draft(
      orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], { pipelineId: pipeline.id }),
    );
    expect(chosen).toMatchObject({ pipelineId: pipeline.id, stageName: 'ХТ Захиалга' });
    // «+»: a stage without an action, open to the caller's MOVE; never a stage that acts.
    await orders
      .create(
        orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], {
          pipelineId: pipeline.id,
          stageId: stage('Нярав Хяналт').id,
        }),
      )
      .expect(422);
    for (const id of [loose.id, chosen.id]) await orders.cancel(id, 'Тест').expect(200);
  });

  it('shows each stage in its sort, filters the cards and limits a stage to 200 cards', async () => {
    const lane = (
      await api(admin)
        .createPipeline({
          boardId,
          name: 'Эрэмбэ',
          visibility: 'PUBLIC',
          ownOrdersOnly: false,
          roles: NO_ROLES,
          stages: [stageBody('Ирсэн', 'NONE'), stageBody('Олон', 'NONE')],
        })
        .expect(201)
    ).body as PipelineJson;
    const day = (days: number) => addDays(businessDate(), days);
    const made: OrderJson[] = [];
    for (const [customer, days, token] of [
      [shop, 3, office],
      [other, 1, office],
      [shop, 2, admin],
    ] as const) {
      made.push(
        await salesApi(app, token).draft(
          orderBody(customer.id, [{ productUnitId: pcs(water), qty: '1' }], {
            pipelineId: lane.id,
            deliveryDate: day(days),
          }),
        ),
      );
    }
    const ids = (query: Record<string, unknown> = {}) =>
      api(office)
        .cards(lane.id, query)
        .then((all) => cardsOf(all, stage('Ирсэн', lane).id)?.cards.map((card) => card.id));
    const [a, b, c] = made.map((order) => order.id);
    expect(await ids()).toEqual([c, b, a]);
    // The sort belongs to the stage: set by its EDIT holders, the same for everyone.
    await http()
      .put(`/api/v1/sales-stages/${stage('Ирсэн', lane).id}/sort`)
      .set(bearer(accountant))
      .send({ sort: 'DELIVERY' })
      .expect(403);
    const sorted = (
      await http()
        .put(`/api/v1/sales-stages/${stage('Ирсэн', lane).id}/sort`)
        .set(bearer(office))
        .send({ sort: 'DELIVERY' })
        .expect(200)
    ).body as PipelineJson;
    expect(stage('Ирсэн', sorted).cardSort).toBe('DELIVERY');
    expect(await ids()).toEqual([b, c, a]);
    await http()
      .put(`/api/v1/sales-stages/${stage('Ирсэн', lane).id}/sort`)
      .set(bearer(office))
      .send({ sort: 'OLDEST' })
      .expect(200);
    expect(await ids()).toEqual([a, b, c]);
    // Filters: mine, the delivery days, a customer found by name.
    expect(await ids({ mine: 'true' })).toEqual([a, b]);
    expect(await ids({ deliveryFrom: day(2), deliveryTo: day(2) })).toEqual([c]);
    expect(await ids({ q: 'хүнсний' })).toEqual([b]);
    expect(await ids({ q: made[0]?.number ?? '' })).toEqual([a]);
    // 201 drafts in one stage: 200 cards, the count says 201.
    await sql.query(
      `INSERT INTO sales_orders (customer_id, fulfilment, delivery_date, payment_method, pipeline_id, stage_id, stage_entered_at)
       SELECT $1, 'PICKUP', $2::date, 'CASH', $3, $4, now() FROM generate_series(1, 201)`,
      [shop.id, day(1), lane.id, stage('Олон', lane).id],
    );
    const many = cardsOf(await api(office).cards(lane.id), stage('Олон', lane).id);
    expect(many?.count).toBe(201);
    expect(many?.cards).toHaveLength(200);
    const page = await api(office).list({ pipeline: lane.id, stageId: stage('Олон', lane).id });
    expect(page.total).toBe(201);
    for (const order of made) await salesApi(app, admin).cancel(order.id, 'Тест').expect(200);
  });

  it('shows each user their own orders in an own-orders-only pipeline', async () => {
    const own = (
      await api(admin)
        .createPipeline({
          boardId,
          name: 'ХТ-ийн захиалга',
          visibility: 'PUBLIC',
          ownOrdersOnly: true,
          roles: { VIEW: [], MANAGE: [roleIds.accountant], ALL_ORDERS: [roleIds.warehouse] },
          stages: [
            stageBody('Ирсэн', 'NONE'),
            stageBody('Нөөцөлсөн', 'CONFIRM'),
            stageBody('Нууц', 'NONE', {
              roles: { VIEW: [roleIds.accountant], EDIT: [], MOVE: [] },
            }),
          ],
        })
        .expect(201)
    ).body as PipelineJson;
    const mine = await salesApi(app, office).draft(
      orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], { pipelineId: own.id }),
    );
    const theirs = await salesApi(app, office2).draft(
      orderBody(shop.id, [{ productUnitId: pcs(water), qty: '1' }], { pipelineId: own.id }),
    );
    const seenBy = async (token: string) =>
      cardsOf(await api(token).cards(own.id), stage('Ирсэн', own).id)?.cards.map((card) => card.id);
    expect(await seenBy(office)).toEqual([mine.id]);
    expect(await seenBy(office2)).toEqual([theirs.id]);
    expect(await seenBy(admin)).toEqual([theirs.id, mine.id]);
    expect(await seenBy(accountant)).toEqual([theirs.id, mine.id]);
    expect(await seenBy(picker)).toEqual([theirs.id, mine.id]);
    expect((await api(office).pipeline(own.id)).seesAll).toBe(false);
    expect((await api(office).list({ pipeline: own.id })).data.map((row) => row.id)).toEqual([
      mine.id,
    ]);
    // Somebody else's order does not exist for the office: not read, moved, edited or archived.
    await http().get(`/api/v1/sales-orders/${theirs.id}`).set(bearer(office)).expect(404);
    await api(office).move(theirs.id, stage('Нөөцөлсөн', own).id).expect(404);
    await salesApi(app, office)
      .update(theirs.id, orderBody(shop.id, [{ productUnitId: pcs(water), qty: '2' }]))
      .expect(404);
    await salesApi(app, office).cancel(theirs.id, 'Тест').expect(404);
    const printed = (
      await http()
        .get('/api/v1/sales-orders/batch')
        .query({ ids: `${theirs.id},${mine.id}` })
        .set(bearer(office))
        .expect(200)
    ).body as { id: number }[];
    expect(printed.map((order) => order.id)).toEqual([mine.id]);
    // A stage the office may move into but not see: the move answers, then the order is hidden.
    const moved = await api(office).move(mine.id, stage('Нууц', own).id).expect(200);
    expect((moved.body as { order: OrderJson }).order.stageName).toBe('Нууц');
    await http().get(`/api/v1/sales-orders/${mine.id}`).set(bearer(office)).expect(404);
    expect((await api(office).list({ pipeline: own.id })).data).toEqual([]);
    for (const order of [mine, theirs])
      await salesApi(app, admin).cancel(order.id, 'Тест').expect(200);
  });

  it('moves the picked goods into the pipeline’s store on a TRANSFER stage (ADR-0125)', async () => {
    const store = await inventoryApi(app, admin).warehouse('SBS1', 'STORE');
    const body = (transferWarehouseId: number | null, stages: Record<string, unknown>[]) => ({
      boardId,
      name: 'Заал хөдөлгөөн',
      visibility: 'PUBLIC',
      ownOrdersOnly: false,
      kind: 'TRANSFER',
      transferWarehouseId,
      roles: NO_ROLES,
      stages,
    });
    const stages = [
      stageBody('Хүсэлт', 'NONE'),
      stageBody('Нөөцлөх', 'CONFIRM'),
      stageBody('Бэлдэх', 'PICK', { roles: { VIEW: [], EDIT: [], MOVE: [roleIds.warehouse] } }),
      stageBody('Зааланд орсон', 'TRANSFER'),
    ];
    // A TRANSFER stage needs the pipeline's store, and the store is an active STORE warehouse.
    expect(
      ((await api(admin).createPipeline(body(null, stages)).expect(422)).body as ProblemJson).code,
    ).toBe('PIPELINE_TRANSFER_STAGE_NEEDS_STORE');
    expect(
      ((await api(admin).createPipeline(body(wh.id, stages)).expect(422)).body as ProblemJson).code,
    ).toBe('PIPELINE_TRANSFER_WAREHOUSE_INVALID');
    const moving = (await api(admin).createPipeline(body(store.id, stages)).expect(201))
      .body as PipelineJson & { transferWarehouseId: number | null };
    expect(moving.transferWarehouseId).toBe(store.id);
    const binsOf = async (productId: number) =>
      (
        await sql.query<{ wh: string; bin: string; on_hand: string }>(
          `SELECT w.code AS wh, b.code AS bin, bs.on_hand::text
             FROM bin_stock bs JOIN bins b ON b.id = bs.bin_id JOIN warehouses w ON w.id = b.warehouse_id
            WHERE bs.product_id = $1 AND bs.on_hand <> 0 ORDER BY w.code, b.code`,
          [productId],
        )
      ).rows;
    const before = await binsOf(cola.id);
    expect(before).toEqual([{ wh: 'SB1', bin: 'A-01-01', on_hand: expect.any(String) }]);
    const shelfBefore = Number.parseFloat(before[0]?.on_hand ?? '0');

    const orders = salesApi(app, office);
    const draft = await orders.draft(
      orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '4' }], { pipelineId: moving.id }),
    );
    await api(office).move(draft.id, stage('Нөөцлөх', moving).id).expect(200);
    // Not before every warehouse has picked (ADR-0126).
    expect(
      (
        (await api(office).move(draft.id, stage('Зааланд орсон', moving).id).expect(409))
          .body as ProblemJson
      ).code,
    ).toBe('PICK_INCOMPLETE');
    await api(picker).move(draft.id, stage('Бэлдэх', moving).id).expect(200);
    const lineId = (await orders.get(draft.id)).lines[0]?.id;
    await http()
      .post(`/api/v1/sales-orders/${draft.id}/pick`)
      .set(bearer(picker))
      .set(idempotency())
      .send({ lines: [{ lineId, qty: '3', binId: shelf }] })
      .expect(200);
    const moved = (await api(office).move(draft.id, stage('Зааланд орсон', moving).id).expect(200))
      .body as { order: OrderJson; print: string[] };
    // Delivered to the store, not sold: no invoice, the picked quantity delivered.
    expect(moved.order).toMatchObject({ status: 'DELIVERED', stageName: 'Зааланд орсон' });
    expect(moved.order.lines[0]).toMatchObject({ qtyPicked: '3', qtyDelivered: '3' });
    // One received push under the order's number: STAGING emptied, the store's floor filled.
    const pushes = (
      await sql.query<{
        origin: string;
        status: string;
        number: string | null;
        source: number;
        dest: number;
      }>(
        `SELECT origin, status, number, source_warehouse_id::int AS source, dest_warehouse_id::int AS dest
           FROM transfers WHERE note = $1`,
        [draft.number],
      )
    ).rows;
    expect(pushes).toEqual([
      {
        origin: 'PUSH',
        status: 'RECEIVED',
        number: expect.stringMatching(/^TR-/),
        source: wh.id,
        dest: store.id,
      },
    ]);
    expect(await binsOf(cola.id)).toEqual([
      { wh: 'SB1', bin: 'A-01-01', on_hand: (shelfBefore - 3).toFixed(3) },
      { wh: 'SBS1', bin: 'SALESFLOOR', on_hand: '3.000' },
    ]);
    const legs = (
      await http()
        .get('/api/v1/stock/movements')
        .query({ docType: 'TR', productId: cola.id })
        .set(bearer(admin))
        .expect(200)
    ).body as { data: { docNumber: string | null }[] };
    expect(legs.data.map((row) => row.docNumber)).toEqual(Array(4).fill(pushes[0]?.number));
    const detail = await orders.get(draft.id);
    expect(detail.events.map((event) => event.toStatus)).toEqual([
      'DRAFT',
      'SUBMITTED',
      'CONFIRMED',
      'PICKING',
      'PACKED',
      'DELIVERED',
    ]);
    expect(detail.events.at(-1)?.reason).toBe(pushes[0]?.number);
    // Moved again into the same stage: nothing happens twice (the card already sits there).
    await api(office).move(draft.id, stage('Зааланд орсон', moving).id).expect(200);
    expect(await binsOf(cola.id)).toHaveLength(2);
    // The store cannot be taken away while a stage transfers.
    const live = (await api(admin).pipeline(moving.id)).stages
      .filter((entry) => entry.archivedAt === null)
      .map(kept);
    expect(
      (
        (
          await http()
            .put(`/api/v1/sales-pipelines/${moving.id}`)
            .set(bearer(admin))
            .send({ ...body(null, live) })
            .expect(422)
        ).body as ProblemJson
      ).code,
    ).toBe('PIPELINE_TRANSFER_STAGE_NEEDS_STORE');
  });
});
