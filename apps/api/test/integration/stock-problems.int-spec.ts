import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { StockProblemSheetsService } from '../../src/modules/stock-problems';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, type WarehouseJson } from '../harness/inventory';
import { type CustomerJson, partnersApi } from '../harness/partners';
import { posStore, saleDoc, saleEvent } from '../harness/pos';
import { pricingApi } from '../harness/pricing';
import { orderBody, type OrderJson, salesApi } from '../harness/sales';

interface ProblemJson {
  code: string;
  params?: Record<string, unknown>;
}
interface EventJson {
  kind: string;
  qtyBase: string;
  saleNumber: string | null;
  orderNumber: string | null;
  customerName: string | null;
  repName: string | null;
  orderedQtyBase: string | null;
}
interface ListedJson {
  warehouseId: number;
  product: { id: number; sku: string; name: string; baseUomName: string };
  onHand: string;
  redQty: string;
  cutQty: string;
  events: EventJson[];
  pending: { id: number; kind: string; issueId: number | null; adjustmentId: number | null } | null;
}
interface ResolutionJson {
  id: number;
  kind: string;
  status: string;
  qtyBase: string | null;
  issueId: number | null;
  issueStatus: string | null;
}
interface SheetLineJson {
  id: number;
  product: { id: number };
  binCode: string | null;
  systemQty: string;
  redQty: string;
  cutQty: string;
  countedQty: string | null;
  onHandAtCount: string | null;
  difference: string | null;
  countedByName: string | null;
  outcome: string | null;
}
interface SheetJson {
  id: number;
  warehouseId: number;
  sheetDate: string;
  status: string;
  lineCount: number;
  countedCount: number;
  builtByName: string | null;
  issueId: number | null;
  adjustmentId: number | null;
  lines?: SheetLineJson[];
}
interface PipelineJson {
  id: number;
  stages: { id: number; name: string }[];
}

const ROLES = { VIEW: [], EDIT: [], MOVE: [] };
const stageBody = (name: string, action: string) => ({
  name,
  action,
  printPickList: false,
  printDeliveryNote: false,
  roles: ROLES,
});

/**
 * «Асуудалтай бараа» (ADR-0230): the list per warehouse from the tills' shortfalls and the orders'
 * cut lines, the two decisions, the warehouses' defaults, the morning sheet with its count and the
 * approval that sends a goods issue and a surplus adjustment, and the scope. Synthetic data only.
 */
describe('stock problems', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let accountant: string;
  let keeperA: string;
  let specialistA: string;
  let specialistB: string;
  let whA: WarehouseJson;
  let whB: WarehouseJson;
  let store: Awaited<ReturnType<typeof posStore>>;
  let shiftClientId: string;
  let cola: ProductJson;
  let beer: ProductJson;
  let tea: ProductJson;
  let water: ProductJson;
  let bread: ProductJson;
  let shop: CustomerJson;
  let keeperParty: CustomerJson;
  let expenseTypeId: number;
  let pipeline: PipelineJson;
  let colaOrder: OrderJson;
  let sheetA: SheetJson;
  const http = () => request(app.getHttpServer());
  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const listOf = async (token: string, warehouseId: number) =>
    (
      (
        await http()
          .get('/api/v1/stock-problems')
          .query({ warehouseId })
          .set(bearer(token))
          .expect(200)
      ).body as { data: ListedJson[] }
    ).data;
  const find = (list: ListedJson[], product: ProductJson) =>
    list.find((row) => row.product.id === product.id);
  const post = (token: string, path: string, body: Record<string, unknown> = {}) =>
    http().post(`/api/v1/stock-problems/${path}`).set(bearer(token)).set(idempotency()).send(body);
  const sheetOf = async (token: string, id: number) =>
    (await http().get(`/api/v1/stock-problems/sheets/${id}`).set(bearer(token)).expect(200))
      .body as SheetJson;
  const lineOf = (sheet: SheetJson, product: ProductJson) => {
    const line = sheet.lines?.find((row) => row.product.id === product.id);
    if (!line) throw new Error(`no line of product ${product.id}`);
    return line;
  };
  const onHand = async (warehouseId: number, productId: number) =>
    (
      await sql.query<{ on_hand: string }>(
        'SELECT on_hand::text FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2',
        [warehouseId, productId],
      )
    ).rows[0]?.on_hand;
  const move = (orderId: number, stageName: string) =>
    http()
      .post(`/api/v1/sales-orders/${orderId}/move`)
      .set(bearer(admin))
      .set(idempotency())
      .send({ stageId: pipeline.stages.find((stage) => stage.name === stageName)?.id });
  /** An order confirmed through the pipeline: its lines are reserved, the rest is cut. */
  const confirmedOrder = async (product: ProductJson, qty: string): Promise<OrderJson> => {
    const orders = salesApi(app, admin);
    const draft = await orders.draft(
      orderBody(shop.id, [{ productUnitId: pcs(product), qty }], { pipelineId: pipeline.id }),
    );
    await move(draft.id, 'Нөөцлөх').expect(200);
    return orders.get(draft.id);
  };
  /** The keeper ticks every line of a sent issue and confirms it: the goods leave. */
  const confirmIssue = async (issueId: number) => {
    const issue = (await http().get(`/api/v1/issues/${issueId}`).set(bearer(keeperA)).expect(200))
      .body as { status: string; lines: { id: number }[] };
    expect(issue.status).toBe('SENT');
    for (const line of issue.lines) {
      await http()
        .patch(`/api/v1/issue-lines/${line.id}/check`)
        .set(bearer(keeperA))
        .send({ checked: true })
        .expect(200);
    }
    const confirmed = await http()
      .post(`/api/v1/issues/${issueId}/confirm`)
      .set(bearer(keeperA))
      .set(idempotency())
      .expect(200);
    expect((confirmed.body as { status: string }).status).toBe('POSTED');
  };
  const tillSale = async (qty: string) => {
    const doc = saleDoc(
      [{ product: bread, qty }],
      {
        tillCode: store.till.code,
        shiftClientId,
        cashierUserId: store.cashierId,
        number: store.nextNumber(),
      },
      store.retailPrice,
    );
    const [outcome] = await store.replay([saleEvent(doc)]);
    expect(outcome?.status).toBe('APPLIED');
    return doc.number;
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string, warehouseIds?: number[]) =>
      (await login(app, await seedUser(app, { roles: [role], warehouseIds }))).accessToken;
    admin = await token('ADMIN');
    accountant = await token('ACCOUNTANT');
    const inventory = inventoryApi(app, admin);
    whA = await inventory.warehouse('SPA');
    whB = await inventory.warehouse('SPB');
    const shelfA = (await inventory.bin(whA.id, 'A-01-01')).id;
    keeperA = await token('WAREHOUSE', [whA.id]);
    specialistA = await token('PRODUCT_SPECIALIST', [whA.id]);
    specialistB = await token('PRODUCT_SPECIALIST', [whB.id]);
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Асуудалтай бараа');
    const base = await catalog.uomId('PCS');
    const product = (sku: string, name: string) =>
      catalog.product({ sku, name, categoryId: category, baseUomId: base });
    cola = await product('7811', 'Кола АБ');
    beer = await product('7812', 'Пиво АБ');
    tea = await product('7813', 'Цай АБ');
    water = await product('7814', 'Ус АБ');
    const pricing = pricingApi(app, admin);
    const profile = await pricing.profile('Асуудалтай: Ундаа');
    for (const item of [cola, beer, tea, water]) {
      await inventory.homeShelf(item.id, whA.id, shelfA);
      await pricing.terms(item.id, '1000', profile, null);
    }
    await http()
      .post('/api/v1/pricing/sale-ready')
      .set(bearer(admin))
      .set(idempotency())
      .send({ productIds: [cola.id, beer.id, tea.id, water.id] })
      .expect(200);
    for (const [item, qty] of [
      [cola, '50'],
      [beer, '50'],
      [tea, '8'],
      [water, '20'],
    ] as const) {
      const created = await http()
        .post('/api/v1/adjustments')
        .set(bearer(admin))
        .set(idempotency())
        .send({
          warehouseId: whA.id,
          reason: 'SURPLUS',
          lines: [{ productUnitId: pcs(item), enteredQty: qty, binId: shelfA, unitCost: '500' }],
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
    const partners = partnersApi(app, admin);
    shop = await partners.customer({ name: 'Дэлгүүр АБ' });
    keeperParty = await partners.customer({ name: 'Нярав А' });
    const types = (
      await http().get('/api/v1/issues/expense-types').set(bearer(accountant)).expect(200)
    ).body as { id: number; code: string | null }[];
    expenseTypeId = types.find((type) => type.code !== 'DAMAGE_CHARGE')?.id ?? 0;
    const board = (
      (
        await http()
          .post('/api/v1/sales-boards')
          .set(bearer(admin))
          .send({ name: 'Асуудалтай' })
          .expect(201)
      ).body as { id: number }
    ).id;
    pipeline = (
      await http()
        .post('/api/v1/sales-pipelines')
        .set(bearer(admin))
        .send({
          boardId: board,
          name: 'Асуудалтай борлуулалт',
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
    store = await posStore(app, admin, 'SP');
    bread = await store.product('7815', 'Талх АБ', '2000', '2');
    shiftClientId = (await store.openShift('50000')).clientId;
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('lists a till shortfall as red and both order cuts with their order', async () => {
    // «Улайсан»: the till sells 5 where the shelf has 2.
    const saleNumber = await tillSale('5');
    // «Дарагдсан» at the confirmation: 60 ordered, 50 on hand.
    colaOrder = await confirmedOrder(cola, '60');
    expect(colaOrder.lines[0]).toMatchObject({ qtyApproved: '50', qtyBackordered: '10' });
    // «Дарагдсан» by the picker: 5 reserved, 3 found on the shelf.
    const beerOrder = await confirmedOrder(beer, '5');
    const part = (verb: string, body = {}) =>
      http()
        .post(`/api/v1/sales-orders/${beerOrder.id}/picks/${whA.id}/${verb}`)
        .set(bearer(keeperA))
        .set(idempotency())
        .send(body);
    await part('take').expect(200);
    const shelf = (await inventoryApi(app, admin).bins(whA.id)).find(
      (bin) => bin.code === 'A-01-01',
    );
    await part('pick', {
      lines: [{ lineId: beerOrder.lines[0]?.id, qty: '3', binId: shelf?.id }],
    }).expect(200);

    const inStore = await listOf(accountant, store.store.id);
    expect(inStore).toHaveLength(1);
    expect(find(inStore, bread)).toMatchObject({
      onHand: '0',
      redQty: '3',
      cutQty: '0',
      pending: null,
      events: [{ kind: 'POS_SHORTFALL', qtyBase: '3', saleNumber }],
    });
    const inA = await listOf(accountant, whA.id);
    expect(inA.map((row) => row.product.id).sort()).toEqual([cola.id, beer.id].sort());
    expect(find(inA, cola)).toMatchObject({
      onHand: '50',
      redQty: '0',
      cutQty: '10',
      events: [
        {
          kind: 'BACKORDER',
          qtyBase: '10',
          orderNumber: colaOrder.number,
          customerName: 'Дэлгүүр АБ',
          repName: 'Тест хэрэглэгч',
          orderedQtyBase: '60',
        },
      ],
    });
    expect(find(inA, beer)).toMatchObject({
      cutQty: '2',
      events: [{ kind: 'SHORT_PICK', qtyBase: '2', orderNumber: beerOrder.number }],
    });
    const summary = (
      await http().get('/api/v1/stock-problems/warehouses').set(bearer(accountant)).expect(200)
    ).body as { warehouseId: number; productCount: number; redCount: number; cutCount: number }[];
    expect(summary.find((row) => row.warehouseId === whA.id)).toMatchObject({
      productCount: 2,
      redCount: 0,
      cutCount: 2,
      settingsReady: false,
    });
    expect(summary.find((row) => row.warehouseId === store.store.id)).toMatchObject({
      productCount: 1,
      redCount: 1,
    });
    // The cola's order is cancelled; what it showed about the stock stays on the list.
    await salesApi(app, admin).cancel(colaOrder.id, 'Захиалагч татгалзсан').expect(200);
    expect(find(await listOf(accountant, whA.id), cola)?.cutQty).toBe('10');
  });

  it('shows a user only the warehouses of their scope and decides only with the right', async () => {
    const summary = (
      await http().get('/api/v1/stock-problems/warehouses').set(bearer(specialistA)).expect(200)
    ).body as { warehouseId: number }[];
    expect(summary.map((row) => row.warehouseId)).toEqual([whA.id]);
    expect(await listOf(specialistA, whA.id)).toHaveLength(2);
    const refused = await http()
      .get('/api/v1/stock-problems')
      .query({ warehouseId: whA.id })
      .set(bearer(specialistB))
      .expect(403);
    expect((refused.body as ProblemJson).params?.reason).toBe('WAREHOUSE_SCOPE');
    // The specialist counts; the decisions are the manager's.
    await post(specialistA, 'legitimate', { warehouseId: whA.id, productId: cola.id }).expect(403);
    await post(specialistA, 'zero-out', { warehouseId: whA.id, productId: cola.id }).expect(403);
    await post(specialistA, 'sheets/build', {}).expect(403);
    // The keeper reads their warehouse's list and nothing more.
    expect(await listOf(keeperA, whA.id)).toHaveLength(2);
    await http().get('/api/v1/stock-problems/sheets/mine').set(bearer(keeperA)).expect(403);
  });

  it('takes a legitimate product off its warehouse list until a new event', async () => {
    const done = (
      await post(accountant, 'legitimate', {
        warehouseId: store.store.id,
        productId: bread.id,
        note: 'Тавиур дээр байсан',
      }).expect(200)
    ).body as ResolutionJson;
    expect(done).toMatchObject({ kind: 'LEGIT', status: 'DONE', issueId: null });
    expect(await listOf(accountant, store.store.id)).toHaveLength(0);
    // The other warehouse's products stay, and the till's shortfall is checked in pos too.
    expect(await listOf(accountant, whA.id)).toHaveLength(2);
    expect((await store.pos.shortfalls({ resolved: false })).data).toHaveLength(0);
    // Not on the list any more: nothing to decide.
    const again = await post(accountant, 'legitimate', {
      warehouseId: store.store.id,
      productId: bread.id,
    }).expect(404);
    expect((again.body as ProblemJson).code).toBe('NOT_FOUND');
    // A new sale beyond the shelf brings it back with the new event only.
    await tillSale('4');
    const back = await listOf(accountant, store.store.id);
    expect(find(back, bread)).toMatchObject({ redQty: '4' });
    expect(find(back, bread)?.events).toHaveLength(1);
  });

  it('keeps a fixed customer and expense type per warehouse', async () => {
    const put = (token: string, warehouseId: number, body: Record<string, unknown>) =>
      http().put(`/api/v1/stock-problems/settings/${warehouseId}`).set(bearer(token)).send(body);
    await put(specialistA, whA.id, { customerId: keeperParty.id, expenseTypeId }).expect(403);
    await put(accountant, whA.id, { customerId: 999_999, expenseTypeId }).expect(404);
    const saved = (
      await put(accountant, whA.id, { customerId: keeperParty.id, expenseTypeId }).expect(200)
    ).body as Record<string, unknown>;
    expect(saved).toMatchObject({
      warehouseId: whA.id,
      customerId: keeperParty.id,
      customerName: 'Нярав А',
      expenseTypeId,
    });
    const all = (
      await http().get('/api/v1/stock-problems/settings').set(bearer(accountant)).expect(200)
    ).body as { warehouseId: number; customerId: number | null }[];
    expect(all.find((row) => row.warehouseId === whA.id)?.customerId).toBe(keeperParty.id);
    expect(all.find((row) => row.warehouseId === whB.id)?.customerId).toBeNull();
  });

  it('zeroes a balance with a goods issue and drops the product when it posts', async () => {
    // Tea: 12 ordered with 8 on hand, then the order is cancelled; the 8 are not on the shelf.
    const teaOrder = await confirmedOrder(tea, '12');
    await salesApi(app, admin).cancel(teaOrder.id, 'Бараа байхгүй').expect(200);
    expect(find(await listOf(accountant, whA.id), tea)).toMatchObject({ onHand: '8', cutQty: '4' });
    // The store has no defaults yet: nothing can be issued there.
    const missing = await post(accountant, 'zero-out', {
      warehouseId: store.store.id,
      productId: bread.id,
    }).expect(409);
    expect((missing.body as ProblemJson).code).toBe('SETTING_MISSING');
    await post(accountant, 'zero-out', {
      warehouseId: whA.id,
      productId: tea.id,
      qty: '9',
    }).expect(409);
    const key = idempotency();
    const zero = () =>
      http()
        .post('/api/v1/stock-problems/zero-out')
        .set(bearer(accountant))
        .set(key)
        .send({ warehouseId: whA.id, productId: tea.id });
    const resolution = (await zero().expect(201)).body as ResolutionJson;
    expect(resolution).toMatchObject({
      kind: 'ZERO_OUT',
      status: 'PENDING',
      qtyBase: '8',
      issueStatus: 'SENT',
    });
    expect(((await zero().expect(201)).body as ResolutionJson).id).toBe(resolution.id);
    const issue = (
      await http().get(`/api/v1/issues/${resolution.issueId}`).set(bearer(accountant)).expect(200)
    ).body as {
      recipientKind: string;
      recipientName: string;
      expenseTypeId: number;
      lines: { productId: number; qtyBase: string; warehouseId: number; binCode: string | null }[];
    };
    expect(issue).toMatchObject({
      recipientKind: 'CUSTOMER',
      recipientName: 'Нярав А',
      expenseTypeId,
      lines: [{ productId: tea.id, qtyBase: '8', warehouseId: whA.id, binCode: 'A-01-01' }],
    });
    // Until the keeper confirms: still on the list, the stock untouched, no second decision.
    expect(find(await listOf(accountant, whA.id), tea)).toMatchObject({
      onHand: '8',
      pending: { id: resolution.id, kind: 'ZERO_OUT', issueId: resolution.issueId },
    });
    const twice = await post(accountant, 'legitimate', {
      warehouseId: whA.id,
      productId: tea.id,
    }).expect(409);
    expect((twice.body as ProblemJson).params?.reason).toBe('STOCK_PROBLEM_PENDING');
    await confirmIssue(resolution.issueId ?? 0);
    expect(await onHand(whA.id, tea.id)).toBe('0.000');
    expect(find(await listOf(accountant, whA.id), tea)).toBeUndefined();
  });

  it('builds the morning sheet per warehouse with the system quantities', async () => {
    // Water joins the list: 25 ordered with 20 on hand, then cancelled.
    const waterOrder = await confirmedOrder(water, '25');
    await salesApi(app, admin).cancel(waterOrder.id, 'Хойшлуулсан').expect(200);
    // The 07:00 job's work.
    const built = await app.get(StockProblemSheetsService).build(null);
    expect(built.map((sheet) => sheet.warehouseId).sort()).toEqual([whA.id, store.store.id].sort());
    const mine = (
      await http().get('/api/v1/stock-problems/sheets/mine').set(bearer(specialistA)).expect(200)
    ).body as SheetJson[];
    expect(mine).toHaveLength(1);
    sheetA = mine[0] as SheetJson;
    expect(sheetA).toMatchObject({
      warehouseId: whA.id,
      sheetDate: businessDate(),
      status: 'OPEN',
      lineCount: 3,
      countedCount: 0,
      builtByName: null,
    });
    expect(lineOf(sheetA, cola)).toMatchObject({
      binCode: 'A-01-01',
      systemQty: '50',
      redQty: '0',
      cutQty: '10',
      countedQty: null,
    });
    expect(lineOf(sheetA, beer)).toMatchObject({ systemQty: '50', cutQty: '2' });
    expect(lineOf(sheetA, water)).toMatchObject({ systemQty: '20', cutQty: '5' });
    // The other warehouse's specialist has no sheet; the manager's button changes nothing.
    expect(
      (await http().get('/api/v1/stock-problems/sheets/mine').set(bearer(specialistB)).expect(200))
        .body,
    ).toEqual([]);
    const again = (await post(accountant, 'sheets/build', { warehouseId: whA.id }).expect(200))
      .body as SheetJson[];
    expect(again.map((sheet) => [sheet.id, sheet.lineCount])).toEqual([[sheetA.id, 3]]);
    // The web's list and the printable read.
    const page = (
      await http()
        .get('/api/v1/stock-problems/sheets')
        .query({ warehouseId: whA.id, status: 'OPEN' })
        .set(bearer(accountant))
        .expect(200)
    ).body as { data: SheetJson[]; nextCursor: string | null };
    expect(page.data.map((sheet) => sheet.id)).toEqual([sheetA.id]);
    expect((await sheetOf(accountant, sheetA.id)).lines).toHaveLength(3);
    await http()
      .get(`/api/v1/stock-problems/sheets/${sheetA.id}`)
      .set(bearer(specialistB))
      .expect(403);
  });

  it('stores a count with the on-hand of that moment and lets it change', async () => {
    const count = (token: string, lineId: number, countedQty: string, key = idempotency()) =>
      http()
        .post(`/api/v1/stock-problems/sheet-lines/${lineId}/count`)
        .set(bearer(token))
        .set(key)
        .send({ countedQty });
    await count(specialistB, lineOf(sheetA, cola).id, '45').expect(403);
    await count(keeperA, lineOf(sheetA, cola).id, '45').expect(403);
    await count(specialistA, lineOf(sheetA, cola).id, '-1').expect(422);
    const key = idempotency();
    const first = (await count(specialistA, lineOf(sheetA, cola).id, '44', key).expect(200))
      .body as SheetLineJson;
    expect(first).toMatchObject({
      countedQty: '44',
      onHandAtCount: '50',
      difference: '-6',
      countedByName: 'Тест хэрэглэгч',
      outcome: null,
    });
    expect((await count(specialistA, first.id, '44', key).expect(200)).body).toEqual(first);
    // A recount replaces it.
    expect(
      (await count(specialistA, first.id, '45').expect(200)).body as SheetLineJson,
    ).toMatchObject({ countedQty: '45', difference: '-5' });
    expect(
      (await count(specialistA, lineOf(sheetA, beer).id, '52').expect(200)).body as SheetLineJson,
    ).toMatchObject({ onHandAtCount: '50', difference: '2' });
    // One line is still open: an approval of the whole sheet waits for it.
    const early = await post(accountant, `sheets/${sheetA.id}/approve`, {}).expect(409);
    expect((early.body as ProblemJson).params).toMatchObject({
      reason: 'SHEET_LINES_UNCOUNTED',
      count: 1,
    });
    await count(specialistA, lineOf(sheetA, water).id, '20').expect(200);
    expect((await sheetOf(accountant, sheetA.id)).countedCount).toBe(3);
  });

  it('approves a sheet into one goods issue and one surplus adjustment', async () => {
    await post(specialistA, `sheets/${sheetA.id}/approve`, {}).expect(403);
    const key = idempotency();
    const approve = () =>
      http()
        .post(`/api/v1/stock-problems/sheets/${sheetA.id}/approve`)
        .set(bearer(admin))
        .set(key)
        .send({});
    const approved = (await approve().expect(200)).body as SheetJson;
    expect(approved.status).toBe('APPROVED');
    expect(approved.issueId).not.toBeNull();
    expect(approved.adjustmentId).not.toBeNull();
    expect(lineOf(approved, cola).outcome).toBe('SHORTAGE');
    expect(lineOf(approved, beer).outcome).toBe('SURPLUS');
    expect(lineOf(approved, water).outcome).toBe('EQUAL');
    expect((await approve().expect(200)).body).toEqual(approved);
    // The surplus: «Тохируулга — Илүүдэл», posted by the approver who holds that right.
    const adjustment = (
      await http()
        .get(`/api/v1/adjustments/${approved.adjustmentId}`)
        .set(bearer(admin))
        .expect(200)
    ).body as { reason: string; status: string; lines: { productId: number; qtyBase: string }[] };
    expect(adjustment).toMatchObject({
      reason: 'SURPLUS',
      status: 'POSTED',
      lines: [{ productId: beer.id, qtyBase: '2' }],
    });
    expect(await onHand(whA.id, beer.id)).toBe('52.000');
    // The shortage: one issue to the warehouse's customer, sent to the keeper.
    const issue = (
      await http().get(`/api/v1/issues/${approved.issueId}`).set(bearer(admin)).expect(200)
    ).body as {
      status: string;
      recipientName: string;
      lines: { productId: number; qtyBase: string }[];
    };
    expect(issue).toMatchObject({
      status: 'SENT',
      recipientName: 'Нярав А',
      lines: [{ productId: cola.id, qtyBase: '5' }],
    });
    // Equal and surplus are resolved; the shortage waits for the keeper.
    let list = await listOf(accountant, whA.id);
    expect(list.map((row) => row.product.id)).toEqual([cola.id]);
    expect(list[0]?.pending).toMatchObject({ kind: 'COUNT', issueId: approved.issueId });
    await confirmIssue(approved.issueId ?? 0);
    expect(await onHand(whA.id, cola.id)).toBe('45.000');
    list = await listOf(accountant, whA.id);
    expect(list).toHaveLength(0);
    // An approved sheet takes no more counts, and the next build has nothing left for it.
    const late = await http()
      .post(`/api/v1/stock-problems/sheet-lines/${lineOf(approved, cola).id}/count`)
      .set(bearer(specialistA))
      .set(idempotency())
      .send({ countedQty: '45' })
      .expect(409);
    expect((late.body as ProblemJson).code).toBe('DOC_STATE_INVALID');
    const rebuilt = (await post(accountant, 'sheets/build', { warehouseId: whA.id }).expect(200))
      .body as SheetJson[];
    expect(rebuilt.map((sheet) => [sheet.id, sheet.status])).toEqual([[sheetA.id, 'APPROVED']]);
    const resolutions = (
      await sql.query<{ kind: string; status: string; n: string }>(
        `SELECT kind, status, count(*)::text AS n FROM stock_problem_resolutions
          WHERE warehouse_id = $1 GROUP BY kind, status ORDER BY kind, status`,
        [whA.id],
      )
    ).rows;
    expect(resolutions).toEqual([
      { kind: 'COUNT', status: 'DONE', n: '3' },
      { kind: 'ZERO_OUT', status: 'DONE', n: '1' },
    ]);
  });
});
