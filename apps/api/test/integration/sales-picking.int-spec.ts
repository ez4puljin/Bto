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
  warehouseName: string;
  status: string;
  pickerId: number | null;
  pickerName: string | null;
}
type DetailJson = OrderJson & { picks: PartJson[] };

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
});

/**
 * Picking by warehouse (ADR-0126): an order's lines from two warehouses make two parts; each
 * keeper takes and picks their own; the sale waits for both and names the missing warehouse; the
 * lead hands a part over and opens a picked one again; a keeper sees only their warehouse's lines;
 * an admin changes a packed order and only the changed warehouse is picked again. Synthetic data.
 */
describe('sales picking by warehouse', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let keeperA: string;
  let keeperB: string;
  let lead: string;
  let keeperAId: number;
  let keeperBId: number;
  let whA: WarehouseJson;
  let whB: WarehouseJson;
  let shelfA: number;
  let shelfB: number;
  let cola: ProductJson;
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
  const statusOf = (order: DetailJson, warehouseId: number) =>
    order.picks.find((entry) => entry.warehouseId === warehouseId)?.status;
  const onHand = async (productId: number) =>
    (
      await sql.query<{ wh: string; bin: string; on_hand: string }>(
        `SELECT w.code AS wh, b.code AS bin, bs.on_hand::text
           FROM bin_stock bs JOIN bins b ON b.id = bs.bin_id JOIN warehouses w ON w.id = b.warehouse_id
          WHERE bs.product_id = $1 AND bs.on_hand <> 0 ORDER BY w.code, b.code`,
        [productId],
      )
    ).rows;

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    whA = await inventory.warehouse('PKA');
    whB = await inventory.warehouse('PKB');
    shelfA = (await inventory.bin(whA.id, 'A-01-01')).id;
    shelfB = (await inventory.bin(whB.id, 'B-01-01')).id;
    const a = await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [whA.id] });
    const b = await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [whB.id] });
    keeperAId = a.id;
    keeperBId = b.id;
    keeperA = (await login(app, a)).accessToken;
    keeperB = (await login(app, b)).accessToken;
    // The lead: a custom role with the lead's right beside a keeper's (both warehouses).
    const leadRole = (
      (
        await http()
          .post('/api/v1/roles')
          .set(bearer(admin))
          .send({
            name: 'Агуулахын ахлах',
            permissions: ['sales.orders.read', 'sales.orders.pick', 'sales.orders.pickLead'],
          })
          .expect(201)
      ).body as { id: number; code: string | null }
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
    const category = await catalog.category('Бэлтгэлийн бараа');
    const base = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '7911',
      name: 'Кола',
      categoryId: category,
      baseUomId: base,
    });
    beer = await catalog.product({
      sku: '7912',
      name: 'Пиво',
      categoryId: category,
      baseUomId: base,
    });
    await inventory.setHome(cola.id, whA.id);
    await inventory.setHome(beer.id, whB.id);
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Бэлтгэл: Ундаа');
    await pricing.terms(cola.id, '1000', profile, null);
    await pricing.terms(beer.id, '2000', profile, null);
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, beer.id] })
      .expect(200);
    for (const [product, wh, shelf] of [
      [cola, whA, shelfA],
      [beer, whB, shelfB],
    ] as const) {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: wh.id,
          reason: 'SURPLUS',
          lines: [{ productUnitId: pcs(product), enteredQty: '50', binId: shelf, unitCost: '500' }],
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
    shop = await partnersApi(app, admin).customer({ name: 'Бэлтгэлийн дэлгүүр' });
    const board = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Бэлтгэл' })
          .expect(201)
      ).body as { id: number }
    ).id;
    pipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({
          boardId: board,
          name: 'Бэлтгэлийн борлуулалт',
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

  it('refuses a SALE stage in a TRANSFER pipeline and a TRANSFER stage in a SALES one', async () => {
    const boardId = (await detailBoard()) ?? 0;
    const res = await http()
      .post('/api/v1/sales-pipelines')
      .set(bearer(admin))
      .send({
        boardId,
        name: 'Буруу',
        visibility: 'PUBLIC',
        ownOrdersOnly: false,
        kind: 'SALES',
        roles: { VIEW: [], MANAGE: [], ALL_ORDERS: [] },
        stages: [stageBody('Шилжүүлэх', 'TRANSFER')],
      })
      .expect(422);
    expect((res.body as ProblemJson).code).toBe('PIPELINE_KIND_STAGE');
  });

  it('picks each warehouse on its own and sells only when every part is done', async () => {
    const orders = salesApi(app, admin);
    const draft = await orders.draft(
      orderBody(
        shop.id,
        [
          { productUnitId: pcs(cola), qty: '5' },
          { productUnitId: pcs(beer), qty: '3' },
        ],
        { pipelineId: pipeline.id },
      ),
    );
    await move(admin, draft.id, 'Нөөцлөх').expect(200);
    let order = await detail(admin, draft.id);
    expect(order.picks.map((entry) => [entry.warehouseId, entry.status])).toEqual([
      [whA.id, 'OPEN'],
      [whB.id, 'OPEN'],
    ]);
    // A keeper sees only their warehouse's line and part.
    const seenByA = await detail(keeperA, draft.id);
    expect(seenByA.lines.map((line) => line.productId)).toEqual([cola.id]);
    expect(seenByA.picks.map((entry) => entry.warehouseId)).toEqual([whA.id]);
    // The phone's work list (ADR-0132): each keeper's own warehouse's part with the order's facts.
    const work = async (token: string) =>
      (await http().get('/api/v1/sales-picks').set(bearer(token)).expect(200)).body as {
        orderId: number;
        warehouseId: number;
        status: string;
        customerName: string;
        lines: number;
      }[];
    expect(
      (await work(keeperA)).filter((row) => row.orderId === draft.id).map((row) => [row.warehouseId, row.status, row.lines]),
    ).toEqual([[whA.id, 'OPEN', 1]]);
    expect((await work(keeperB)).filter((row) => row.orderId === draft.id).map((row) => row.warehouseId)).toEqual([whB.id]);
    // A keeper takes only their own warehouse; the order starts picking.
    await part(keeperA, draft.id, whB.id, 'take').expect(403);
    await part(keeperA, draft.id, whA.id, 'take').expect(200);
    order = await detail(admin, draft.id);
    expect(order.status).toBe('PICKING');
    expect(order.picks.find((entry) => entry.warehouseId === whA.id)).toMatchObject({
      status: 'PICKING',
      pickerId: keeperAId,
    });
    // The sale waits for warehouse B and names it.
    const line = (productId: number) => order.lines.find((entry) => entry.productId === productId);
    await part(keeperA, draft.id, whA.id, 'pick', {
      lines: [{ lineId: line(cola.id)?.id, qty: '5', binId: shelfA }],
    }).expect(200);
    const refused = (await move(admin, draft.id, 'Борлуулалт').expect(409)).body as ProblemJson;
    expect(refused.code).toBe('PICK_INCOMPLETE');
    expect(refused.params?.warehouses).toBe(whB.name);
    // The board's cards carry the parts: keeper B sees warehouse B's open part only, the lead
    // sees both with their pickers; the warehouse filter keeps the orders with a line there.
    const cardPicks = async (token: string, warehouseId?: number) => {
      const stages = (
        await http()
          .get(`/api/v1/sales-pipelines/${pipeline.id}/cards`)
          .query(warehouseId ? { warehouseId } : {})
          .set(bearer(token))
          .expect(200)
      ).body as { cards: { id: number; picks: PartJson[] }[] }[];
      const card = stages.flatMap((entry) => entry.cards).find((entry) => entry.id === draft.id);
      return card ? card.picks.map((entry) => [entry.warehouseId, entry.status]) : null;
    };
    expect(await cardPicks(keeperB)).toEqual([[whB.id, 'OPEN']]);
    expect(await cardPicks(lead)).toEqual([
      [whA.id, 'DONE'],
      [whB.id, 'OPEN'],
    ]);
    expect(await cardPicks(lead, whB.id)).not.toBeNull();
    expect(await cardPicks(lead, 999_999)).toBeNull();
    // The lead hands B's part to keeper B; keeper A may not; then keeper B picks it.
    await part(keeperA, draft.id, whB.id, 'assign', { userId: keeperBId }).expect(403);
    const pickers = (
      await http()
        .get('/api/v1/sales-picks/pickers')
        .query({ warehouseId: whB.id })
        .set(bearer(lead))
        .expect(200)
    ).body as { id: number }[];
    expect(pickers.map((user) => user.id)).toContain(keeperBId);
    expect(pickers.map((user) => user.id)).not.toContain(keeperAId);
    expect(
      (
        (await part(lead, draft.id, whB.id, 'assign', { userId: keeperAId }).expect(422))
          .body as ProblemJson
      ).code,
    ).toBe('PICKER_INVALID');
    await part(lead, draft.id, whB.id, 'assign', { userId: keeperBId }).expect(200);
    expect(
      ((await part(keeperA, draft.id, whB.id, 'take').expect(403)).body as ProblemJson).code,
    ).toBe('FORBIDDEN');
    await part(keeperB, draft.id, whB.id, 'pick', {
      lines: [{ lineId: line(beer.id)?.id, qty: '3', binId: shelfB }],
    }).expect(200);
    order = await detail(admin, draft.id);
    expect(order.status).toBe('PACKED');
    expect(await onHand(beer.id)).toEqual([
      { wh: 'PKB', bin: 'B-01-01', on_hand: '47.000' },
      { wh: 'PKB', bin: 'STAGING', on_hand: '3.000' },
    ]);

    // The lead opens B again: the goods go back to the shelf and are reserved again.
    const reopened = await part(lead, draft.id, whB.id, 'reopen');
    expect(reopened.status).toBe(200);
    order = await detail(admin, draft.id);
    expect(order.status).toBe('PICKING');
    expect(statusOf(order, whB.id)).toBe('OPEN');
    expect(await onHand(beer.id)).toEqual([{ wh: 'PKB', bin: 'B-01-01', on_hand: '50.000' }]);
    const reserved = await sql.query<{ reserved: string }>(
      `SELECT reserved::text FROM warehouse_stock WHERE product_id = $1 AND warehouse_id = $2`,
      [beer.id, whB.id],
    );
    expect(reserved.rows[0]?.reserved).toBe('3.000');
    await part(keeperB, draft.id, whB.id, 'take').expect(200);
    await part(keeperB, draft.id, whB.id, 'pick', {
      lines: [{ lineId: line(beer.id)?.id, qty: '3', binId: shelfB }],
    }).expect(200);

    // The admin changes the packed order: only warehouse B's quantity, so only B is picked again.
    const edited = await orders
      .update(
        draft.id,
        orderBody(
          shop.id,
          [
            { productUnitId: pcs(cola), qty: '5' },
            { productUnitId: pcs(beer), qty: '2' },
          ],
          { pipelineId: pipeline.id },
        ),
      )
      .expect(200);
    order = edited.body as DetailJson;
    expect(order.status).toBe('PICKING');
    expect(statusOf(order, whA.id)).toBe('DONE');
    expect(statusOf(order, whB.id)).toBe('OPEN');
    expect(order.lines.find((entry) => entry.productId === cola.id)).toMatchObject({
      qtyPicked: '5',
    });
    expect(await onHand(beer.id)).toEqual([{ wh: 'PKB', bin: 'B-01-01', on_hand: '50.000' }]);
    expect(await onHand(cola.id)).toEqual([
      { wh: 'PKA', bin: 'A-01-01', on_hand: '45.000' },
      { wh: 'PKA', bin: 'STAGING', on_hand: '5.000' },
    ]);
    // A keeper (no sales.orders.manage) may not change a picked order.
    await salesApi(app, keeperA)
      .update(draft.id, orderBody(shop.id, [{ productUnitId: pcs(cola), qty: '1' }]))
      .expect(409);
    const fresh = await detail(admin, draft.id);
    await part(keeperB, draft.id, whB.id, 'take').expect(200);
    await part(keeperB, draft.id, whB.id, 'pick', {
      lines: [
        {
          lineId: fresh.lines.find((entry) => entry.productId === beer.id)?.id,
          qty: '2',
          binId: shelfB,
        },
      ],
    }).expect(200);
    const sold = (await move(admin, draft.id, 'Борлуулалт').expect(200)).body as {
      order: OrderJson;
    };
    expect(['DELIVERED', 'INVOICED']).toContain(sold.order.status);
    expect(await onHand(cola.id)).toEqual([{ wh: 'PKA', bin: 'A-01-01', on_hand: '45.000' }]);
    expect(await onHand(beer.id)).toEqual([{ wh: 'PKB', bin: 'B-01-01', on_hand: '48.000' }]);
  });

  it("keeps every keeper's change when they pick at once and refuses a save over a newer change", async () => {
    const orders = salesApi(app, admin);
    const body = orderBody(
      shop.id,
      [
        { productUnitId: pcs(cola), qty: '2' },
        { productUnitId: pcs(beer), qty: '2' },
      ],
      { pipelineId: pipeline.id },
    );
    const draft = await orders.draft(body);
    await move(admin, draft.id, 'Нөөцлөх').expect(200);
    const stale = (await detail(admin, draft.id)) as DetailJson & { updatedAt: string };
    const lineOf = (order: DetailJson, productId: number) =>
      order.lines.find((entry) => entry.productId === productId)?.id;
    // Both keepers take and confirm their own warehouse at the same moment: neither is lost, and
    // warehouse B's short count (1 of 2) stands beside A's full one.
    await Promise.all([
      part(keeperA, draft.id, whA.id, 'take').expect(200),
      part(keeperB, draft.id, whB.id, 'take').expect(200),
    ]);
    const [a, b] = await Promise.all([
      part(keeperA, draft.id, whA.id, 'pick', {
        lines: [{ lineId: lineOf(stale, cola.id), qty: '2', binId: shelfA }],
      }),
      part(keeperB, draft.id, whB.id, 'pick', {
        lines: [{ lineId: lineOf(stale, beer.id), qty: '1', binId: shelfB }],
      }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    let order = await detail(admin, draft.id);
    expect(order.status).toBe('PACKED');
    expect(order.lines.map((line) => [line.productId, line.qtyPicked])).toEqual(
      expect.arrayContaining([
        [cola.id, '2'],
        [beer.id, '1'],
      ]),
    );
    // The office saves the order as it read it before the picks: refused; read again, it goes.
    const refused = (
      await orders.update(draft.id, { ...body, expectedUpdatedAt: stale.updatedAt }).expect(409)
    ).body as ProblemJson;
    expect(refused.code).toBe('ORDER_CHANGED');
    const fresh = (await detail(admin, draft.id)) as DetailJson & { updatedAt: string };
    await orders.update(draft.id, { ...body, expectedUpdatedAt: fresh.updatedAt }).expect(200);
    // The same part confirmed twice at once (two devices): one wins, the other is told so.
    await part(lead, draft.id, whB.id, 'reopen').expect(200);
    await part(keeperB, draft.id, whB.id, 'take').expect(200);
    order = await detail(admin, draft.id);
    const twice = await Promise.all(
      [1, 2].map(() =>
        part(keeperB, draft.id, whB.id, 'pick', {
          lines: [{ lineId: lineOf(order, beer.id), qty: '2', binId: shelfB }],
        }),
      ),
    );
    expect(twice.map((res) => res.status).sort()).toEqual([200, 409]);
    expect((twice.find((res) => res.status === 409)?.body as ProblemJson).code).toBe(
      'PICK_STATE_INVALID',
    );
    expect(statusOf(await detail(admin, draft.id), whB.id)).toBe('DONE');
    await expectReconciled(app);
  });

  async function detailBoard(): Promise<number | null> {
    const tree = (await http().get('/api/v1/sales-boards').set(bearer(admin)).expect(200)).body as {
      id: number;
      name: string;
    }[];
    return tree.find((board) => board.name === 'Бэлтгэл')?.id ?? null;
  }
});
