import type { NestExpressApplication } from '@nestjs/platform-express';
import { businessDate } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import { FIN_DB, type FinDb, reconcileBooks } from '../../src/finance-core';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { financeApi } from '../harness/finance';
import { bearer, login, seedUser } from '../harness/identity';
import {
  costReceiptAsTyped,
  expectReconciled,
  inventoryApi,
  postReceipt,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';
import { pricingApi } from '../harness/pricing';

interface SettlementJson {
  accountCode: string | null;
  party: { kind: string; id: number | null; name: string } | null;
  charged: boolean;
}
interface SessionJson {
  id: number;
  userId: number;
  sentAt: string | null;
  sentByName: string | null;
  entries: number;
  products: number;
}
interface DetailJson {
  id: number;
  status: string;
  number: string | null;
  scopeMode: string;
  showStock: boolean;
  lines: number;
  counted: number;
  different: number;
  uncountedLines: number;
  uncounted: string | null;
  sessions: SessionJson[];
  surplus: SettlementJson;
  shortage: SettlementJson;
}
interface LineJson {
  id: number;
  productId: number;
  listed: boolean;
  expectedQty: string | null;
  countedQty: string | null;
  pendingQty: string;
  differenceQty: string | null;
  counters: { userId: number; qty: string; pendingQty: string }[];
  movedDuring: string;
  movedAfter: string;
  settleOwn: boolean;
  settlement: SettlementJson;
  unitCost: string | null;
  chargeAmount: string | null;
}
interface InfoJson {
  productId: number;
  listed: boolean;
  myQty: string;
  expectedQty: string | null;
  countedQty: string | null;
  entryId: number | null;
}
interface MineJson {
  status: string;
  session: { id: number } | null;
  entries: { id: number; enteredQty: string; qtyBase: string; voided: boolean; sent: boolean }[];
}

/**
 * Product counts (ADR-0176): counters add entries from their phones, a sent session lands in the
 * count window, and the approval posts counted less expected with each line's account and party.
 */
describe('stock counts', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let admin: string;
  let keeper: string;
  let accountant: string;
  let counter1: string;
  let counter2: string;
  let counter1Id: number;
  let staffId: number;
  let supplierId: number;
  let wh: WarehouseJson;
  let cola: ProductJson;
  let rice: ProductJson;
  let water: ProductJson;
  const http = () => request(app.getHttpServer());
  const base = '/api/v1/stock-counts';

  const onHand = async (productId: number) =>
    (
      await sql.query<{ qty: string }>(
        `SELECT coalesce(sum(qty_base), 0)::text AS qty FROM stock_ledger
          WHERE warehouse_id = $1 AND product_id = $2`,
        [wh.id, productId],
      )
    ).rows[0]?.qty;
  /** The journal lines of Bto documents, account → Dr − Cr, by source type and id pattern. */
  const finLines = async (docType: string, docIdLike: string) =>
    Object.fromEntries(
      (
        await sql.query<{ code: string; amount: string }>(
          `SELECT a.code, (sum(l.debit) - sum(l.credit))::text AS amount
             FROM fin.documents d
             JOIN fin.journal_entries e ON e.company_id = d.company_id AND e.document_id = d.id
             JOIN fin.journal_lines l ON l.company_id = e.company_id AND l.entry_id = e.id
             JOIN fin.accounts a ON a.company_id = l.company_id AND a.id = l.account_id
            WHERE d.source_doc_type = $1 AND d.source_doc_id LIKE $2
            GROUP BY a.code ORDER BY a.code`,
          [docType, docIdLike],
        )
      ).rows.map((row) => [row.code, row.amount]),
    );
  const receive = async (product: ProductJson, qty: string, amount: string) => {
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(admin))
      .set(idempotency())
      .send({
        supplierId,
        lines: [{ productUnitId: unitOf(product, 'PCS').id, enteredQty: qty, docAmount: amount }],
      })
      .expect(201);
    const id = (receipt.body as { id: number }).id;
    await postReceipt(app, admin, id);
    await costReceiptAsTyped(app, admin, id);
    return id;
  };
  const create = async (body: Record<string, unknown>) =>
    (
      await http()
        .post(base)
        .set(bearer(keeper))
        .set(idempotency())
        .send({ warehouseId: wh.id, ...body })
        .expect(201)
    ).body as DetailJson;
  const detail = async (id: number, token = keeper) =>
    (await http().get(`${base}/${id}`).set(bearer(token)).expect(200)).body as DetailJson;
  const lines = async (id: number, filter = 'ALL', token = keeper) =>
    (
      (await http().get(`${base}/${id}/lines`).query({ filter }).set(bearer(token)).expect(200))
        .body as { data: LineJson[] }
    ).data;
  const lineOf = async (id: number, product: ProductJson, token = keeper) => {
    const line = (await lines(id, 'ALL', token)).find((row) => row.productId === product.id);
    if (!line) throw new Error(`no line for ${product.sku}`);
    return line;
  };
  const start = (token: string, id: number) =>
    http().post(`${base}/${id}/session`).set(bearer(token));
  const count = (token: string, id: number, product: ProductJson, unit: string, qty: string) =>
    http()
      .post(`${base}/${id}/session/entries`)
      .set(bearer(token))
      .set(idempotency())
      .send({ productId: product.id, productUnitId: unitOf(product, unit).id, qty });
  const send = (token: string, id: number) =>
    http().post(`${base}/${id}/session/send`).set(bearer(token));
  const act = (token: string, id: number, action: string, body: Record<string, unknown> = {}) =>
    http().post(`${base}/${id}/${action}`).set(bearer(token)).send(body);

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    const token = async (role: string, warehouseIds?: number[]) =>
      (await login(app, await seedUser(app, { roles: [role], warehouseIds }))).accessToken;
    admin = await token('ADMIN');
    accountant = await token('ACCOUNTANT');
    const inventory = inventoryApi(app, admin);
    wh = await inventory.warehouse('SC1');
    keeper = await token('WAREHOUSE', [wh.id]);
    const first = await seedUser(app, { roles: ['OFFICE'] });
    counter1Id = first.id;
    counter1 = (await login(app, first)).accessToken;
    counter2 = await token('SALES_REP');
    staffId = (await seedUser(app, { roles: ['OFFICE'], username: 'ajiltan_sc' })).id;
    const shelfA = (await inventory.bin(wh.id, 'C-01-01')).id;
    const shelfB = (await inventory.bin(wh.id, 'C-01-02')).id;
    supplierId = (await partnersApi(app, admin).supplier({ name: 'Тооллого ХХК' })).id;
    const catalog = catalogApi(app, admin);
    const category = await catalog.category('Ундаа ТО');
    const pcs = await catalog.uomId('PCS');
    cola = await catalog.product({
      sku: '8901',
      name: 'Кола ТО',
      categoryId: category,
      baseUomId: pcs,
      units: [{ uomId: await catalog.uomId('BOX'), factorToBase: '24' }],
    });
    rice = await catalog.product({
      sku: '8902',
      name: 'Будаа ТО',
      categoryId: category,
      baseUomId: pcs,
    });
    water = await catalog.product({
      sku: '8903',
      name: 'Ус ТО',
      categoryId: category,
      baseUomId: pcs,
    });
    await inventory.homeShelf(cola.id, wh.id, shelfA);
    await inventory.homeShelf(rice.id, wh.id, shelfB);
    await inventory.setHome(water.id, wh.id);
    // 48 colas at 1,000, 10 rice at 500, 5 waters at 200.
    await receive(cola, '48', '48000');
    await receive(rice, '10', '5000');
    await receive(water, '5', '1000');
  });
  afterAll(async () => {
    expect(
      (await reconcileBooks(app.get<FinDb>(FIN_DB), 'MANUAL')).every((run) => run.status === 'OK'),
    ).toBe(true);
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  let first: DetailJson;

  it('opens a count of every product of the warehouse, straight into counting', async () => {
    await http()
      .post(base)
      .set(bearer(counter1))
      .set(idempotency())
      .send({ warehouseId: wh.id, scopeMode: 'ALL' })
      .expect(403);
    await http()
      .post(base)
      .set(bearer(keeper))
      .set(idempotency())
      .send({ warehouseId: wh.id, scopeMode: 'ALL', scopeIds: [1] })
      .expect(422);
    first = await create({ scopeMode: 'ALL', note: 'Сарын тооллого' });
    expect(first).toMatchObject({
      status: 'COUNTING',
      number: null,
      scopeMode: 'ALL',
      showStock: false,
      lines: 3,
      counted: 0,
      sessions: [],
    });
    const open = (await http().get(`${base}/open`).set(bearer(counter1)).expect(200)).body as {
      id: number;
      mine: string;
    }[];
    expect(open.find((row) => row.id === first.id)).toMatchObject({ mine: 'NONE' });
    // The old shelf counts do not list it or open it.
    const old = (await http().get('/api/v1/stocktakes').set(bearer(keeper)).expect(200)).body as {
      data: { id: number }[];
    };
    expect(old.data.some((row) => row.id === first.id)).toBe(false);
    await http().get(`/api/v1/stocktakes/${first.id}`).set(bearer(keeper)).expect(404);
  });

  it('keeps each entry apart, adds them up and shows them only once sent', async () => {
    const early = await count(counter1, first.id, cola, 'BOX', '1').expect(409);
    expect((early.body as { code: string }).code).toBe('COUNT_SESSION_REQUIRED');
    const mine = (await start(counter1, first.id).expect(200)).body as MineJson;
    expect(mine).toMatchObject({ status: 'COUNTING', entries: [] });
    expect(mine.session).not.toBeNull();
    const one = (await count(counter1, first.id, cola, 'BOX', '1').expect(201)).body as InfoJson;
    expect(one).toMatchObject({ listed: true, myQty: '24', expectedQty: null, countedQty: null });
    const two = (await count(counter1, first.id, cola, 'PCS', '20').expect(201)).body as InfoJson;
    expect(two).toMatchObject({ myQty: '44', expectedQty: null });
    // A mistyped entry is taken back by its counter.
    const wrong = (await count(counter1, first.id, cola, 'PCS', '7').expect(201)).body as InfoJson;
    expect(wrong.myQty).toBe('51');
    const back = (
      await http()
        .post(`${base}/${first.id}/session/entries/${wrong.entryId}/void`)
        .set(bearer(counter1))
        .expect(200)
    ).body as InfoJson;
    expect(back.myQty).toBe('44');

    // A counter has no way into the count window.
    await http().get(`${base}/${first.id}`).set(bearer(counter1)).expect(403);
    await http().get(`${base}/${first.id}/lines`).set(bearer(counter1)).expect(403);

    const pending = await lineOf(first.id, cola);
    expect(pending).toMatchObject({ countedQty: null, pendingQty: '44', differenceQty: null });
    const waiting = await act(keeper, first.id, 'close').expect(409);
    expect((waiting.body as { code: string }).code).toBe('COUNT_SESSIONS_OPEN');
    expect((await detail(first.id)).sessions).toMatchObject([
      { userId: counter1Id, sentAt: null, entries: 2, products: 1 },
    ]);

    const sent = (await send(counter1, first.id).expect(200)).body as MineJson;
    expect(sent.session).toBeNull();
    expect(await lineOf(first.id, cola)).toMatchObject({
      expectedQty: '48',
      countedQty: '44',
      pendingQty: '0',
      differenceQty: '-4',
    });

    // A second counter's 2 land on top of the 44; the rice is counted as it stands.
    await start(counter2, first.id).expect(200);
    await count(counter2, first.id, cola, 'PCS', '2').expect(201);
    await count(counter2, first.id, rice, 'PCS', '10').expect(201);
    await send(counter2, first.id).expect(200);
    const colaLine = await lineOf(first.id, cola);
    expect(colaLine).toMatchObject({ countedQty: '46', differenceQty: '-2' });
    expect(colaLine.counters.map((counter) => counter.qty).sort()).toEqual(['2', '44']);
    const entries = (
      await http()
        .get(`${base}/${first.id}/lines/${colaLine.id}/entries`)
        .set(bearer(keeper))
        .expect(200)
    ).body as { enteredQty: string; qtyBase: string; voided: boolean }[];
    expect(
      entries
        .filter((entry) => !entry.voided)
        .map((entry) => entry.qtyBase)
        .sort(),
    ).toEqual(['2', '20', '24']);
    expect(entries.filter((entry) => entry.voided).map((entry) => entry.qtyBase)).toEqual(['7']);
    expect(await detail(first.id)).toMatchObject({ counted: 2, different: 1, uncountedLines: 1 });
  });

  it('names what moved a product after it was counted', async () => {
    const receiptId = await receive(rice, '5', '2500');
    const riceLine = await lineOf(first.id, rice);
    expect(riceLine).toMatchObject({
      expectedQty: '10',
      countedQty: '10',
      differenceQty: '0',
      movedDuring: '5',
      movedAfter: '0',
    });
    expect((await lines(first.id, 'MOVED')).map((line) => line.productId)).toEqual([rice.id]);
    const moved = (
      await http()
        .get(`${base}/${first.id}/lines/${riceLine.id}/moved`)
        .set(bearer(keeper))
        .expect(200)
    ).body as { docType: string; docId: number; qty: string; afterApproval: boolean }[];
    expect(moved).toMatchObject([
      { docType: 'GR', docId: receiptId, qty: '5', afterApproval: false },
    ]);
  });

  it('posts counted less expected and leaves the uncounted products', async () => {
    await act(keeper, first.id, 'approve', { uncounted: 'LEAVE' }).expect(403);
    await act(admin, first.id, 'approve', { uncounted: 'LEAVE' }).expect(409);
    expect((await act(keeper, first.id, 'close').expect(200)).body).toMatchObject({
      status: 'REVIEW',
    });
    // A count in review takes no entries.
    await start(counter1, first.id).expect(409);
    const approved = (await act(admin, first.id, 'approve', { uncounted: 'LEAVE' }).expect(200))
      .body as DetailJson;
    expect(approved).toMatchObject({ status: 'APPROVED', uncounted: 'LEAVE' });
    expect(approved.number).not.toBeNull();
    // The cola is what was counted; the rice keeps what arrived during the count; the water is left.
    expect(await onHand(cola.id)).toBe('46.000');
    expect(await onHand(rice.id)).toBe('15.000');
    expect(await onHand(water.id)).toBe('5.000');
    const books = await finLines('STOCK', `ST:${first.id}:%`);
    expect(books['140101']).toBe('-2000.00');
    expect(Object.keys(books)).toHaveLength(2);
    // The unit cost is the accountant's to see.
    expect((await lineOf(first.id, cola, admin)).unitCost).toBe('1000');
    expect((await lineOf(first.id, cola)).unitCost).toBeNull();
    await act(admin, first.id, 'approve', { uncounted: 'LEAVE' }).expect(409);
  });

  it('tells a later movement from one during the count', async () => {
    await receive(cola, '24', '24000');
    expect(await lineOf(first.id, cola)).toMatchObject({ movedDuring: '0', movedAfter: '24' });
    expect(await onHand(cola.id)).toBe('70.000');
  });

  let second: DetailJson;

  it('counts only what is scanned and shows the stock when the count says so', async () => {
    second = await create({ scopeMode: 'SCANNED', showStock: true });
    expect(second).toMatchObject({ lines: 0, showStock: true });
    await start(counter1, second.id).expect(200);
    const info = (await count(counter1, second.id, rice, 'PCS', '12').expect(201)).body as InfoJson;
    expect(info).toMatchObject({ listed: false, myQty: '12', expectedQty: '15' });
    await count(counter1, second.id, water, 'PCS', '7').expect(201);
    await send(counter1, second.id).expect(200);
    expect(await lineOf(second.id, rice)).toMatchObject({ listed: false, differenceQty: '-3' });
    expect(await lineOf(second.id, water)).toMatchObject({ differenceQty: '2' });
    await act(keeper, second.id, 'close').expect(200);
  });

  it('sends each difference to its account and party, a charged shortage at the selling price', async () => {
    const finance = financeApi(app, admin);
    const made = await finance.createAccount({ code: '719901', name: 'Тооллогын зөрүү ТО' });
    expect(made.status).toBe(201);
    const account = made.body as { id: number; code: string };
    // A money account takes no count difference.
    await http()
      .put(`/api/v1/finance/stock-count-accounts/${(await finance.account('100101')).id}`)
      .set(bearer(admin))
      .expect(422);
    // The account is refused until finance lists it for counts.
    const body = { surplus: { accountCode: account.code } };
    await http().put(`${base}/${second.id}/defaults`).set(bearer(admin)).send(body).expect(422);
    await http()
      .put(`/api/v1/finance/stock-count-accounts/${account.id}`)
      .set(bearer(admin))
      .expect(200);
    const choices = (await http().get(`${base}/accounts`).set(bearer(admin)).expect(200)).body as {
      code: string;
    }[];
    expect(choices.map((choice) => choice.code)).toContain(account.code);
    await http().put(`${base}/${second.id}/defaults`).set(bearer(keeper)).send(body).expect(403);
    const withDefault = (
      await http().put(`${base}/${second.id}/defaults`).set(bearer(admin)).send(body).expect(200)
    ).body as DetailJson;
    expect(withDefault.surplus).toMatchObject({ accountCode: account.code, charged: false });

    const riceLine = await lineOf(second.id, rice);
    const settle = (settlement: Record<string, unknown> | null) =>
      http()
        .put(`${base}/${second.id}/lines/${riceLine.id}/settlement`)
        .set(bearer(admin))
        .send({ settlement });
    // A charge names who pays.
    await settle({ charged: true }).expect(422);
    await settle({ charged: true, party: { kind: 'USER', id: staffId } }).expect(200);
    expect(await lineOf(second.id, rice)).toMatchObject({
      settleOwn: true,
      settlement: { charged: true, party: { kind: 'USER', id: staffId } },
    });
    // The rice has no selling price yet: nothing is posted.
    const unpriced = await act(admin, second.id, 'approve', { uncounted: 'LEAVE' }).expect(422);
    expect((unpriced.body as { code: string }).code).toBe('PRICE_MISSING');
    expect((await detail(second.id)).status).toBe('REVIEW');
    const pricing = pricingApi(app, admin);
    await pricing.terms(rice.id, '800', await pricing.profile('Тооллого ТО'), null);

    // The sheet (ADR-0177): each difference at the selling price, the reason on its line.
    const reason = (body: Record<string, unknown>, who = admin) =>
      http().put(`${base}/${second.id}/lines/${riceLine.id}/reason`).set(bearer(who)).send(body);
    await reason({ reason: 'Хагарсан' }, keeper).expect(403);
    await reason({ reason: '  Хагарсан  ' }).expect(204);
    const sheetOf = async (query: Record<string, string>) =>
      (await http().get(`${base}/${second.id}/sheet`).query(query).set(bearer(admin)).expect(200))
        .body as {
        totals: Record<string, unknown>;
        rows: { productId: number; listed: boolean; [key: string]: unknown }[];
      };
    const sheet = await sheetOf({ filter: 'DIFFERENT' });
    expect(sheet.rows.find((row) => row.productId === rice.id)).toMatchObject({
      differenceQty: '-3',
      salePrice: '800.00',
      differenceAmount: '-2400.00',
      reason: 'Хагарсан',
    });
    expect(sheet.totals).toMatchObject({
      different: 2,
      shortageLines: 1,
      shortageQty: '-3',
      surplusLines: 1,
      surplusQty: '2',
      netQty: '-1',
    });
    const searched = await sheetOf({ q: rice.sku });
    expect(searched.rows.map((row) => row.productId)).toEqual([rice.id]);
    // A scanned count lists nothing beforehand: every product of it was added by a scan.
    expect((await sheetOf({ filter: 'UNLISTED' })).rows).toHaveLength(2);
    await http().get(`${base}/${second.id}/sheet`).set(bearer(counter1)).expect(403);

    const approved = (await act(admin, second.id, 'approve', { uncounted: 'ZERO' }).expect(200))
      .body as DetailJson;
    expect(approved.status).toBe('APPROVED');
    expect(await onHand(rice.id)).toBe('12.000');
    expect(await onHand(water.id)).toBe('7.000');
    // A scanned count lists nothing else, so nothing was zeroed.
    expect(await onHand(cola.id)).toBe('70.000');
    expect(await lineOf(second.id, rice)).toMatchObject({
      chargeAmount: '2400.00',
      reason: 'Хагарсан',
    });
    // An approved count's reasons stay as they were.
    await reason({ reason: 'Өөр' }).expect(409);
    // 3 rice left at 500 as a cost of sale; 2 waters came in at 200 against the chosen account.
    expect(await finLines('STOCK', `ST:${second.id}:%`)).toEqual({
      '140101': '-1100.00',
      '610101': '1500.00',
      [account.code]: '-400.00',
    });
    const charge = await finLines('DAMAGE_CHARGE', `count:${second.id}:%`);
    expect(charge['120101']).toBe('2400.00');
    const items = await sql.query<{ open_amount: string; side: string }>(
      `SELECT i.open_amount::text, i.side FROM fin.open_items i
         JOIN fin.documents d ON d.company_id = i.company_id AND d.id = i.document_id
        WHERE d.source_doc_type = 'DAMAGE_CHARGE' AND d.source_doc_id LIKE $1`,
      [`count:${second.id}:%`],
    );
    expect(items.rows).toEqual([{ open_amount: '2400.00', side: 'DEBIT' }]);

    const today = businessDate();
    const report = (
      await http()
        .get(`${base}/variance`)
        .query({ from: today, to: today, warehouseId: wh.id })
        .set(bearer(admin))
        .expect(200)
    ).body as {
      data: {
        stocktakeId: number;
        productId: number;
        differenceQty: string;
        chargeAmount: string | null;
        settlement: SettlementJson;
      }[];
    };
    expect(report.data.map((row) => [row.stocktakeId, row.productId, row.differenceQty])).toEqual([
      [second.id, water.id, '2'],
      [second.id, rice.id, '-3'],
      [first.id, cola.id, '-2'],
    ]);
    expect(report.data[0]?.settlement.accountCode).toBe(account.code);
    expect(report.data[1]).toMatchObject({ chargeAmount: '2400.00' });
    await http()
      .get(`${base}/variance`)
      .query({ from: today, to: today })
      .set(bearer(counter1))
      .expect(403);
  });

  it('makes a starter send, and zeroes the uncounted products when the approver says so', async () => {
    const third = await create({ scopeMode: 'ALL' });
    await start(counter1, third.id).expect(200);
    await count(counter1, third.id, cola, 'PCS', '70').expect(201);
    await send(counter1, third.id).expect(200);
    // The second counter starts and walks away without scanning anything.
    await start(counter2, third.id).expect(200);
    await act(keeper, third.id, 'close').expect(409);
    const idle = (await detail(third.id)).sessions.find((session) => session.sentAt === null);
    if (!idle) throw new Error('no open session');
    await http()
      .post(`${base}/${third.id}/sessions/${idle.id}/send`)
      .set(bearer(counter1))
      .expect(403);
    const forced = (
      await http()
        .post(`${base}/${third.id}/sessions/${idle.id}/send`)
        .set(bearer(keeper))
        .expect(200)
    ).body as DetailJson;
    expect(forced.sessions.every((session) => session.sentAt !== null)).toBe(true);
    await act(keeper, third.id, 'close').expect(200);
    // Back to counting and into review again.
    await act(keeper, third.id, 'reopen').expect(200);
    await act(keeper, third.id, 'close').expect(200);
    expect(await detail(third.id)).toMatchObject({ counted: 1, different: 0, uncountedLines: 2 });
    await act(admin, third.id, 'approve', { uncounted: 'ZERO' }).expect(200);
    expect(await onHand(cola.id)).toBe('70.000');
    expect(await onHand(rice.id)).toBe('0.000');
    expect(await onHand(water.id)).toBe('0.000');
  });

  it('cancels a count without touching the stock', async () => {
    const fourth = await create({ scopeMode: 'SCANNED' });
    await start(counter1, fourth.id).expect(200);
    await count(counter1, fourth.id, cola, 'PCS', '1').expect(201);
    await act(counter1, fourth.id, 'cancel').expect(403);
    expect((await act(keeper, fourth.id, 'cancel').expect(200)).body).toMatchObject({
      status: 'CANCELLED',
    });
    expect(await onHand(cola.id)).toBe('70.000');
    await send(counter1, fourth.id).expect(409);
    void accountant;
  });
});
