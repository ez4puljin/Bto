import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessYear } from '@tugeel/shared/time';
import type { Client } from 'pg';
import request from 'supertest';
import type { AuthContext } from '../../src/modules/identity';
import { StocktakesService } from '../../src/modules/inventory';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, idempotency, type ProductJson, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import {
  type BinJson,
  expectReconciled,
  inventoryApi,
  postReceipt,
  staffContext,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

interface BinBody {
  id: number;
  code: string;
  type: string;
  finishedAt: string | null;
  countedCount: number;
  lineCount?: number;
  differenceCount?: number;
}
interface LineBody {
  id: number;
  binId: number;
  binCode: string;
  productId: number;
  countedQty: string | null;
  countedAt: string | null;
  expectedQty?: string;
  difference?: string | null;
}
interface DetailBody {
  id: number;
  number: string | null;
  status: string;
  bins: BinBody[];
  countedCount: number;
  lineCount?: number;
  differenceCount?: number;
  shortageValue?: string;
  surplusValue?: string;
}

/** Stocktakes (SPEC §6.8, ADR-0038): counting locks the bins, approval posts counted − frozen. */
describe('stocktakes', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let stocktakes: StocktakesService;
  let adminToken: string;
  let workerToken: string;
  let accountantToken: string;
  let outsiderToken: string;
  let admin: AuthContext;
  let worker: AuthContext;
  let wh1: WarehouseJson;
  let damaged: BinJson;
  let cola: ProductJson;
  let rice: ProductJson;
  const shelves: Record<string, number> = {};
  const year = businessYear(new Date());
  const http = () => request(app.getHttpServer());
  const shelf = (code: string) => {
    const id = shelves[code];
    if (id === undefined) throw new Error(`no shelf ${code}`);
    return id;
  };
  const binStatus = async (binId: number) => {
    const { rows } = await sql.query<{ status: string }>(`SELECT status FROM bins WHERE id = $1`, [
      binId,
    ]);
    return rows[0]?.status;
  };
  const ledgerOf = async (docId: number) => {
    const { rows } = await sql.query<{
      bin_id: string;
      product_id: string;
      qty_base: string;
      entered_qty: string;
      factor_snapshot: string;
      unit_cost: string;
    }>(
      `SELECT bin_id::text, product_id::text, qty_base::text, entered_qty::text,
              factor_snapshot::text, unit_cost::text
         FROM stock_ledger WHERE doc_type = 'ST' AND doc_id = $1 ORDER BY id`,
      [docId],
    );
    return rows;
  };
  const linesOf = async (id: number) => (await stocktakes.lines(id, { limit: 200 })).data;
  const finishAll = async (id: number) => {
    for (const bin of (await stocktakes.get(id)).bins)
      await stocktakes.finishBin(worker, id, bin.id);
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    stocktakes = app.get(StocktakesService);
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    const workerUser = await seedUser(app, { roles: ['WAREHOUSE'] });
    adminToken = (await login(app, adminUser)).accessToken;
    workerToken = (await login(app, workerUser)).accessToken;
    accountantToken = (await login(app, await seedUser(app, { roles: ['ACCOUNTANT'] })))
      .accessToken;
    admin = staffContext(adminUser.id, 'ADMIN');
    worker = staffContext(workerUser.id, 'WAREHOUSE');
    const inventory = inventoryApi(app, adminToken);
    wh1 = await inventory.warehouse('WH1');
    const wh2 = await inventory.warehouse('WH2');
    outsiderToken = (
      await login(app, await seedUser(app, { roles: ['WAREHOUSE'], warehouseIds: [wh2.id] }))
    ).accessToken;
    for (const code of ['A-01-01', 'A-01-02', 'A-01-03', 'B-01-01', 'B-01-02', 'B-02-01'])
      shelves[code] = (await inventory.bin(wh1.id, code)).id;
    damaged = await inventory.systemBin(wh1.id, 'DAMAGED');
    const catalog = catalogApi(app, adminToken);
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
    // The receipt puts each line on its product's fixed shelf in its home (ADR-0099 #1).
    await inventory.homeShelf(cola.id, wh1.id, shelf('A-01-01'));
    await inventory.homeShelf(rice.id, wh1.id, shelf('A-01-02'));
    const supplierId = (await partnersApi(app, adminToken).supplier({ name: 'МСМ ХХК' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(workerToken))
      .set(idempotency())
      .send({
        supplierId,
        lines: [
          { productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2' },
          { productUnitId: unitOf(rice, 'PCS').id, enteredQty: '10' },
        ],
      })
      .expect(201);
    const body = receipt.body as { id: number; lines: { id: number }[] };
    await postReceipt(app, workerToken, body.id, { amount: '53000' });
    await http()
      .put(`/api/v1/receipts/${body.id}/costs`)
      .set(bearer(adminToken))
      .set(idempotency())
      .send({
        costingVersion: 0,
        lines: [
          { lineId: body.lines[0]?.id, amount: '48000' },
          { lineId: body.lines[1]?.id, amount: '5000' },
        ],
      })
      .expect(200);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('freezes the counted bins and posts what the count found', async () => {
    const draft = await stocktakes.create(worker, {
      warehouseId: wh1.id,
      binIds: [shelf('A-01-02'), shelf('A-01-01')],
      note: 'Сарын тооллого',
    });
    expect(draft).toMatchObject({ status: 'DRAFT', number: null, lineCount: 0 });
    expect(draft.bins.map((bin) => bin.id)).toEqual([shelf('A-01-01'), shelf('A-01-02')]);

    const started = await stocktakes.start(worker, draft.id);
    expect(started).toMatchObject({ status: 'COUNTING', lineCount: 2, countedCount: 0 });
    expect(
      (await linesOf(draft.id)).map((line) => [
        line.binCode,
        line.productId,
        line.expectedQty.toFixed(),
      ]),
    ).toEqual([
      ['A-01-01', cola.id, '48'],
      ['A-01-02', rice.id, '10'],
    ]);
    expect(await binStatus(shelf('A-01-01'))).toBe('COUNTING');

    // Nothing moves on a counted bin.
    const moved = await http()
      .post('/api/v1/bin-moves')
      .set(bearer(workerToken))
      .set(idempotency())
      .send({
        warehouseId: wh1.id,
        lines: [
          {
            productUnitId: unitOf(cola, 'PCS').id,
            enteredQty: '1',
            fromBinId: shelf('A-01-01'),
            toBinId: shelf('A-01-03'),
          },
        ],
      })
      .expect(409);
    expect(moved.body).toMatchObject({ code: 'BIN_LOCKED_FOR_COUNT', params: { code: 'A-01-01' } });
    // Nor can a second stocktake take one of its bins.
    const overlapping = await stocktakes.create(worker, {
      warehouseId: wh1.id,
      binIds: [shelf('A-01-02'), shelf('A-01-03')],
    });
    expect(await codeOf(stocktakes.start(worker, overlapping.id))).toBe('BIN_LOCKED_FOR_COUNT');
    await stocktakes.cancel(worker, overlapping.id);
    expect(await binStatus(shelf('A-01-03'))).toBe('ACTIVE');

    // 3 cola missing on A-01-01, 2 cola found on A-01-02; rice not counted yet.
    await stocktakes.count(worker, draft.id, [
      { binId: shelf('A-01-01'), productId: cola.id, countedQty: new Decimal(47) },
      { binId: shelf('A-01-02'), productId: cola.id, countedQty: new Decimal(2) },
    ]);
    await stocktakes.count(worker, draft.id, [
      { binId: shelf('A-01-01'), productId: cola.id, countedQty: new Decimal(45) },
    ]);
    expect(await codeOf(stocktakes.review(worker, draft.id))).toBe('STOCKTAKE_BINS_UNFINISHED');
    expect(
      await codeOf(
        stocktakes.count(worker, draft.id, [
          { binId: shelf('A-01-03'), productId: rice.id, countedQty: new Decimal(1) },
        ]),
      ),
    ).toBe('VALIDATION_FAILED');
    await stocktakes.count(worker, draft.id, [
      { binId: shelf('A-01-02'), productId: rice.id, countedQty: new Decimal(10) },
    ]);
    await finishAll(draft.id);
    const review = await stocktakes.review(worker, draft.id);
    expect(review).toMatchObject({ status: 'REVIEW', differenceCount: 2 });
    const lines = await linesOf(draft.id);
    expect(lines.map((line) => line.difference?.toFixed())).toEqual(['-3', '0', '2']);
    expect(
      await codeOf(
        stocktakes.count(worker, draft.id, [
          { binId: shelf('A-01-02'), productId: rice.id, countedQty: new Decimal(9) },
        ]),
      ),
    ).toBe('DOC_STATE_INVALID');

    const found = lines.find((line) => line.expectedQty.isZero());
    if (!found) throw new Error('no found-goods line');
    const costs = [{ lineId: found.id, unitCost: new Decimal(1200) }];
    expect(await codeOf(stocktakes.approve(worker, draft.id, costs))).toBe('FORBIDDEN');
    const approved = await stocktakes.approve(admin, draft.id, costs);
    expect(approved).toMatchObject({ status: 'APPROVED', number: `ST-${year}-000001` });

    expect(await ledgerOf(draft.id)).toEqual([
      {
        bin_id: String(shelf('A-01-01')),
        product_id: String(cola.id),
        qty_base: '-3.000',
        entered_qty: '3.000',
        factor_snapshot: '1.000000',
        unit_cost: '1000.0000',
      },
      {
        bin_id: String(shelf('A-01-02')),
        product_id: String(cola.id),
        qty_base: '2.000',
        entered_qty: '2.000',
        factor_snapshot: '1.000000',
        unit_cost: '1200.0000',
      },
    ]);
    const { rows } = await sql.query<{ on_hand: string; avg_cost: string }>(
      `SELECT on_hand::text, avg_cost::text FROM warehouse_stock WHERE product_id = $1`,
      [cola.id],
    );
    // 45 at 1 000 and 2 at 1 200.
    expect(rows).toEqual([{ on_hand: '47.000', avg_cost: '1008.5106' }]);
    expect(await binStatus(shelf('A-01-01'))).toBe('ACTIVE');
    expect(await binStatus(shelf('A-01-02'))).toBe('ACTIVE');
    expect(await codeOf(stocktakes.cancel(worker, draft.id))).toBe('DOC_ALREADY_POSTED');
    expect(await codeOf(stocktakes.approve(admin, draft.id))).toBe('DOC_ALREADY_POSTED');
  });

  it('frees the bins of a cancelled count without postings', async () => {
    const draft = await stocktakes.create(worker, {
      warehouseId: wh1.id,
      binIds: [shelf('A-01-03')],
    });
    await stocktakes.start(worker, draft.id);
    expect(await binStatus(shelf('A-01-03'))).toBe('COUNTING');
    const cancelled = await stocktakes.cancel(worker, draft.id);
    expect(cancelled.status).toBe('CANCELLED');
    expect(await binStatus(shelf('A-01-03'))).toBe('ACTIVE');
    expect(await ledgerOf(draft.id)).toEqual([]);
  });

  it('numbers a count without differences and posts nothing', async () => {
    const draft = await stocktakes.create(worker, {
      warehouseId: wh1.id,
      binIds: [shelf('A-01-02')],
    });
    await stocktakes.start(worker, draft.id);
    await stocktakes.count(
      worker,
      draft.id,
      (await linesOf(draft.id)).map((line) => ({
        binId: line.binId,
        productId: line.productId,
        countedQty: line.expectedQty,
      })),
    );
    await finishAll(draft.id);
    await stocktakes.review(worker, draft.id);
    const approved = await stocktakes.approve(admin, draft.id);
    expect(approved.number).toBe(`ST-${year}-000002`);
    expect(await ledgerOf(draft.id)).toEqual([]);
  });

  it('keeps the warehouse scope', async () => {
    const outsider = staffContext(worker.userId, 'WAREHOUSE', [wh1.id + 1000]);
    expect(
      await codeOf(
        stocktakes.create(outsider, { warehouseId: wh1.id, binIds: [shelf('A-01-03')] }),
      ),
    ).toBe('FORBIDDEN');
  });

  describe('over HTTP', () => {
    const as = (token: string) => ({
      get: (path: string) => http().get(`/api/v1/stocktakes${path}`).set(bearer(token)),
      post: (path: string, body?: object, key: string | null = null) => {
        const call = http().post(`/api/v1/stocktakes${path}`).set(bearer(token));
        const keyed = key === null ? call : call.set('Idempotency-Key', key);
        return body === undefined ? keyed : keyed.send(body);
      },
    });
    const counter = () => as(workerToken);
    const approver = () => as(adminToken);
    const create = async (body: object): Promise<DetailBody> =>
      (
        await counter()
          .post('', { warehouseId: wh1.id, ...body }, randomUUID())
          .expect(201)
      ).body as DetailBody;
    const scan = (id: number, binId: number, productUnitId: number, qty: string, key?: string) =>
      counter().post(`/${id}/scan`, { binId, productUnitId, qty }, key ?? randomUUID());
    const lines = async (token: string, id: number, query = '') =>
      (
        (await as(token).get(`/${id}/lines?limit=200${query}`).expect(200)).body as {
          data: LineBody[];
        }
      ).data;
    const move = async (productUnitId: number, qty: string, from: string, to: string) => {
      await http()
        .post('/api/v1/bin-moves')
        .set(bearer(adminToken))
        .set(idempotency())
        .send({
          warehouseId: wh1.id,
          lines: [
            {
              productUnitId,
              enteredQty: qty,
              fromBinId: shelf(from),
              toBinId: shelf(to),
            },
          ],
        })
        .expect(201);
    };

    beforeAll(async () => {
      // 24 cola and 5 rice onto the B shelves; the warehouse average of cola stays 1 008.5106.
      await move(unitOf(cola, 'BOX').id, '1', 'A-01-01', 'B-01-01');
      await move(unitOf(rice, 'PCS').id, '5', 'A-01-02', 'B-01-02');
    });

    it('chooses bins by code prefix, every shelf or by name, and previews the choice', async () => {
      const preview = await counter()
        .get(`/bin-preview?warehouseId=${wh1.id}&prefix=${encodeURIComponent('b–01')}`)
        .expect(200);
      expect(preview.body).toEqual({
        binCount: 2,
        countingCount: 0,
        firstCode: 'B-01-01',
        lastCode: 'B-01-02',
      });
      const every = await counter().get(`/bin-preview?warehouseId=${wh1.id}&all=true`).expect(200);
      expect(every.body).toMatchObject({ binCount: 6, firstCode: 'A-01-01', lastCode: 'B-02-01' });

      const byPrefix = await create({ prefix: 'b–01' });
      expect(byPrefix.bins.map((bin) => bin.code)).toEqual(['B-01-01', 'B-01-02']);
      const all = await create({ all: true });
      // Shelves only: receiving, staging, shipping, damaged and returns are counted by name.
      expect(all.bins.map((bin) => bin.type)).toEqual(Array(6).fill('STORAGE'));
      const named = await create({ binIds: [damaged.id] });
      expect(named.bins.map((bin) => bin.code)).toEqual([damaged.code]);
      for (const draft of [byPrefix, all, named]) {
        await counter().post(`/${draft.id}/cancel`).expect(200);
      }

      for (const body of [{}, { prefix: 'B', all: true }, { prefix: 'Z' }, { prefix: '%' }]) {
        const refused = await counter()
          .post('', { warehouseId: wh1.id, ...body }, randomUUID())
          .expect(422);
        expect((refused.body as { code: string }).code).toBe('VALIDATION_FAILED');
      }
    });

    it('counts blind: counters see only what they counted, approvers the differences', async () => {
      const box = unitOf(cola, 'BOX').id;
      const pcs = unitOf(cola, 'PCS').id;
      const draft = await create({
        binIds: [shelf('B-01-01'), shelf('B-01-02'), shelf('B-02-01')],
      });
      const started = (await counter().post(`/${draft.id}/start`).expect(200)).body as DetailBody;
      expect(started.status).toBe('COUNTING');
      expect(started).not.toHaveProperty('lineCount');
      expect(started).not.toHaveProperty('differenceCount');
      expect(started.bins[0]).toEqual({
        id: shelf('B-01-01'),
        code: 'B-01-01',
        type: 'STORAGE',
        finishedAt: null,
        countedCount: 0,
      });
      expect(
        ((await approver().get(`/${draft.id}`).expect(200)).body as DetailBody).lineCount,
      ).toBe(2);

      // The frozen lines exist, but a counter sees none of them, even asking for the differences.
      expect(await lines(workerToken, draft.id)).toEqual([]);
      expect(await lines(workerToken, draft.id, '&differences=true')).toEqual([]);
      expect(
        (await lines(adminToken, draft.id)).map((line) => [line.binCode, line.expectedQty]),
      ).toEqual([
        ['B-01-01', '24'],
        ['B-01-02', '5'],
      ]);

      // Pieces and boxes add up; a repeated request counts once; a take-back subtracts.
      const first = await scan(draft.id, shelf('B-01-01'), pcs, '1').expect(200);
      expect(first.body).toMatchObject({
        line: { binCode: 'B-01-01', productId: cola.id, countedQty: '1' },
        added: { qty: '1', unitName: 'ш', qtyBase: '1' },
        bin: { id: shelf('B-01-01'), countedCount: 1 },
      });
      expect((first.body as { line: object }).line).not.toHaveProperty('expectedQty');
      const key = randomUUID();
      await scan(draft.id, shelf('B-01-01'), box, '1', key).expect(200);
      const replay = await scan(draft.id, shelf('B-01-01'), box, '1', key).expect(200);
      expect(replay.body).toMatchObject({
        line: { countedQty: '25' },
        added: { unitName: 'хайрцаг', qtyBase: '24' },
      });
      await scan(draft.id, shelf('B-01-01'), pcs, '-5').expect(200);
      // A box of cola found on an empty shelf; taking back more than counted is refused.
      const found = await scan(draft.id, shelf('B-02-01'), box, '1').expect(200);
      expect(found.body).toMatchObject({ line: { countedQty: '24' } });
      expect(
        ((await scan(draft.id, shelf('B-02-01'), pcs, '-30').expect(422)).body as { code: string })
          .code,
      ).toBe('VALIDATION_FAILED');
      await scan(draft.id, shelf('A-01-03'), pcs, '1').expect(422);
      await scan(draft.id, shelf('B-01-01'), pcs, '0').expect(422);
      expect(
        (await lines(workerToken, draft.id)).map((line) => [line.binCode, line.countedQty]),
      ).toEqual([
        ['B-01-01', '20'],
        ['B-02-01', '24'],
      ]);

      // Finishing B-01-02 without counting its rice: «not found», never shown to the counter.
      const finished = await counter()
        .post(`/${draft.id}/bins/${shelf('B-01-02')}/finish`)
        .expect(200);
      expect(finished.body).toMatchObject({ code: 'B-01-02', countedCount: 0 });
      expect((finished.body as BinBody).finishedAt).not.toBeNull();
      expect(await lines(workerToken, draft.id, `&binId=${shelf('B-01-02')}`)).toEqual([]);
      expect(await lines(adminToken, draft.id, `&binId=${shelf('B-01-02')}`)).toMatchObject([
        { productId: rice.id, countedQty: '0', countedAt: null, difference: '-5' },
      ]);
      const unfinished = await counter().post(`/${draft.id}/review`).expect(409);
      expect(unfinished.body).toMatchObject({
        code: 'STOCKTAKE_BINS_UNFINISHED',
        params: { unfinished: 2 },
      });

      // A typed count says what it replaces: a stale screen gets 409.
      const rice5 = { binId: shelf('B-01-02'), productId: rice.id, countedQty: '5' };
      await counter()
        .post(`/${draft.id}/counts`, { entries: [{ ...rice5, previousQty: null }] })
        .expect(409);
      const typed = await counter()
        .post(`/${draft.id}/counts`, { entries: [{ ...rice5, previousQty: '0' }] })
        .expect(200);
      expect(typed.body).toMatchObject({ lines: [{ countedQty: '5' }] });

      for (const code of ['B-01-01', 'B-02-01']) {
        await counter()
          .post(`/${draft.id}/bins/${shelf(code)}/finish`)
          .expect(200);
      }
      const review = (await counter().post(`/${draft.id}/review`).expect(200)).body as DetailBody;
      expect(review.status).toBe('REVIEW');
      expect(review).not.toHaveProperty('differenceCount');
      const audit = (await approver().get(`/${draft.id}`).expect(200)).body as DetailBody;
      // 4 cola short at 1 008.5106, 24 found at the same average.
      expect(audit).toMatchObject({
        differenceCount: 2,
        shortageValue: '4034.04',
        surplusValue: '24204.25',
      });
      const accountant = (await as(accountantToken).get(`/${draft.id}`).expect(200))
        .body as DetailBody;
      expect(accountant).not.toHaveProperty('shortageValue');
      expect(
        (await lines(adminToken, draft.id, '&differences=true')).map((line) => [
          line.binCode,
          line.difference,
        ]),
      ).toEqual([
        ['B-01-01', '-4'],
        ['B-02-01', '24'],
      ]);

      // Counters neither change a count in review, nor approve, recount or cancel it.
      await scan(draft.id, shelf('B-01-01'), pcs, '1').expect(409);
      await counter().post(`/${draft.id}/approve`, {}, randomUUID()).expect(403);
      await counter()
        .post(`/${draft.id}/recount`, { binIds: [shelf('B-02-01')] })
        .expect(403);
      await counter().post(`/${draft.id}/cancel`).expect(403);
      await as(accountantToken)
        .post('', { warehouseId: wh1.id, all: true }, randomUUID())
        .expect(403);

      // B-02-01 is counted again from nothing: its found line goes.
      const recounted = await approver()
        .post(`/${draft.id}/recount`, { binIds: [shelf('B-02-01')] })
        .expect(200);
      expect(recounted.body).toMatchObject({ status: 'COUNTING' });
      expect(
        (await lines(adminToken, draft.id)).map((line) => [line.binCode, line.countedQty]),
      ).toEqual([
        ['B-01-01', '20'],
        ['B-01-02', '5'],
      ]);
      const again = await scan(draft.id, shelf('B-02-01'), box, '1').expect(200);
      expect(again.body).toMatchObject({ line: { countedQty: '24' } });
      await counter()
        .post(`/${draft.id}/bins/${shelf('B-02-01')}/finish`)
        .expect(200);
      await counter().post(`/${draft.id}/review`).expect(200);

      const surplus = (await lines(adminToken, draft.id, '&differences=true')).find(
        (line) => line.binCode === 'B-02-01',
      );
      if (!surplus) throw new Error('no surplus line');
      const approveKey = randomUUID();
      const costs = { costs: [{ lineId: surplus.id, unitCost: '1100' }] };
      const approved = await approver().post(`/${draft.id}/approve`, costs, approveKey).expect(200);
      expect(approved.body).toMatchObject({ status: 'APPROVED', number: `ST-${year}-000003` });
      const replayed = await approver().post(`/${draft.id}/approve`, costs, approveKey).expect(200);
      expect(replayed.body).toMatchObject({ number: `ST-${year}-000003` });
      expect(await ledgerOf(draft.id)).toEqual([
        {
          bin_id: String(shelf('B-01-01')),
          product_id: String(cola.id),
          qty_base: '-4.000',
          entered_qty: '4.000',
          factor_snapshot: '1.000000',
          unit_cost: '1008.5106',
        },
        {
          bin_id: String(shelf('B-02-01')),
          product_id: String(cola.id),
          qty_base: '24.000',
          entered_qty: '24.000',
          factor_snapshot: '1.000000',
          unit_cost: '1100.0000',
        },
      ]);
      for (const code of ['B-01-01', 'B-01-02', 'B-02-01']) {
        expect(await binStatus(shelf(code))).toBe('ACTIVE');
      }
    });

    it('cancels in review only by an approver and refuses a superseded unit', async () => {
      const draft = await create({ binIds: [shelf('A-01-03')] });
      await counter().post(`/${draft.id}/start`).expect(200);
      const oldBox = unitOf(cola, 'BOX').id;
      const superseded = await http()
        .post(`/api/v1/product-units/${oldBox}/supersede`)
        .set(bearer(adminToken))
        .set(idempotency())
        .send({ factorToBase: '12' })
        .expect(201);
      const refused = await scan(draft.id, shelf('A-01-03'), oldBox, '1').expect(409);
      expect((refused.body as { code: string }).code).toBe('UNIT_SUPERSEDED');
      const newBox = (superseded.body as { id: number }).id;
      const counted = await scan(draft.id, shelf('A-01-03'), newBox, '2').expect(200);
      expect(counted.body).toMatchObject({ line: { countedQty: '24' }, added: { qtyBase: '24' } });
      await counter()
        .post(`/${draft.id}/bins/${shelf('A-01-03')}/finish`)
        .expect(200);
      await counter().post(`/${draft.id}/review`).expect(200);
      await counter().post(`/${draft.id}/cancel`).expect(403);
      const cancelled = await approver().post(`/${draft.id}/cancel`).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED' });
      expect(await binStatus(shelf('A-01-03'))).toBe('ACTIVE');
      expect(await ledgerOf(draft.id)).toEqual([]);
    });

    it('keeps the warehouse scope and lists stocktakes newest first, a page at a time', async () => {
      const outsider = as(outsiderToken);
      await outsider.get(`/bin-preview?warehouseId=${wh1.id}&all=true`).expect(403);
      await outsider.post('', { warehouseId: wh1.id, all: true }, randomUUID()).expect(403);

      const first = await counter()
        .get(`?warehouseId=${wh1.id}&status=CANCELLED&limit=2`)
        .expect(200);
      const page = first.body as {
        data: { id: number; status: string; binCount: number; finishedBinCount: number }[];
        nextCursor: string | null;
      };
      expect(page.data).toHaveLength(2);
      expect(page.data.every((row) => row.status === 'CANCELLED')).toBe(true);
      expect(page.data[0]).toMatchObject({ binCount: 1, finishedBinCount: 1 });
      expect((page.data[0]?.id ?? 0) > (page.data[1]?.id ?? 0)).toBe(true);
      if (!page.nextCursor) throw new Error('expected a second page');
      const second = await counter()
        .get(
          `?warehouseId=${wh1.id}&status=CANCELLED&limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,
        )
        .expect(200);
      const next = (second.body as { data: { id: number }[] }).data;
      expect(next.length).toBeGreaterThan(0);
      expect(next.every((row) => row.id < (page.data[1]?.id ?? 0))).toBe(true);
    });
  });
});
