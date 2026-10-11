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
  expectReconciled,
  inventoryApi,
  staffContext,
  type WarehouseJson,
} from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/** Stocktakes (SPEC §6.8): counting locks the bins, approval posts counted − frozen. */
describe('stocktakes', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let stocktakes: StocktakesService;
  let workerToken: string;
  let admin: AuthContext;
  let worker: AuthContext;
  let wh1: WarehouseJson;
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

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    stocktakes = app.get(StocktakesService);
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    const workerUser = await seedUser(app, { roles: ['WAREHOUSE'] });
    const adminToken = (await login(app, adminUser)).accessToken;
    workerToken = (await login(app, workerUser)).accessToken;
    admin = staffContext(adminUser.id, 'ADMIN');
    worker = staffContext(workerUser.id, 'WAREHOUSE');
    const inventory = inventoryApi(app, adminToken);
    wh1 = await inventory.warehouse('WH1');
    for (const code of ['A-01-01', 'A-01-02', 'A-01-03'])
      shelves[code] = (await inventory.bin(wh1.id, code)).id;
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
    const supplierId = (await partnersApi(app, adminToken).supplier({ name: 'МСМ ХХК' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(workerToken))
      .set(idempotency())
      .send({
        warehouseId: wh1.id,
        supplierId,
        lines: [
          { productUnitId: unitOf(cola, 'BOX').id, enteredQty: '2', binId: shelf('A-01-01') },
          { productUnitId: unitOf(rice, 'PCS').id, enteredQty: '10', binId: shelf('A-01-02') },
        ],
      })
      .expect(201);
    const body = receipt.body as { id: number; lines: { id: number }[] };
    await http()
      .post(`/api/v1/receipts/${body.id}/post`)
      .set(bearer(workerToken))
      .set(idempotency())
      .expect(200);
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
    expect(draft).toMatchObject({ status: 'DRAFT', number: null, lines: [] });
    expect(draft.binIds).toEqual([shelf('A-01-01'), shelf('A-01-02')]);

    const started = await stocktakes.start(worker, draft.id);
    expect(started.status).toBe('COUNTING');
    expect(
      started.lines.map((line) => [line.binCode, line.productId, line.expectedQty.toFixed()]),
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
    expect(await codeOf(stocktakes.review(worker, draft.id))).toBe('VALIDATION_FAILED');
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
    const review = await stocktakes.review(worker, draft.id);
    expect(review.lines.map((line) => line.difference?.toFixed())).toEqual(['-3', '0', '2']);
    expect(
      await codeOf(
        stocktakes.count(worker, draft.id, [
          { binId: shelf('A-01-02'), productId: rice.id, countedQty: new Decimal(9) },
        ]),
      ),
    ).toBe('DOC_STATE_INVALID');

    const found = review.lines.find((line) => line.expectedQty.isZero());
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
    const started = await stocktakes.start(worker, draft.id);
    await stocktakes.count(
      worker,
      draft.id,
      started.lines.map((line) => ({
        binId: line.binId,
        productId: line.productId,
        countedQty: line.expectedQty,
      })),
    );
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
});
