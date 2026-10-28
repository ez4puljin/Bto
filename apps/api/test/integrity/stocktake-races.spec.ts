import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import request from 'supertest';
import { toProblem } from '../../src/common/errors/problem-details';
import type { AuthContext } from '../../src/modules/identity';
import { StocktakesService } from '../../src/modules/inventory';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, postReceipt, staffContext } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * SPEC §6.8 under concurrency: a stocktake starting while goods move off its bin freezes exactly
 * what the bin holds once the move is settled, and approving and cancelling the same count let
 * exactly one through. Counting (ADR-0038): concurrent scans all add up, finishing a bin never
 * swallows a scan, and nothing changes a count once the stocktake is in review.
 */
describe('integrity: stocktake races', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let stocktakes: StocktakesService;
  let admin: AuthContext;
  let worker: AuthContext;
  let workerToken: string;
  let warehouseId: number;
  let productId: number;
  let unitId: number;
  let shelf: number;
  let other: number;
  let empty: number;
  const http = () => request(app.getHttpServer());
  const onHand = async (binId: number) => {
    const { rows } = await sql.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM bin_stock WHERE bin_id = $1 AND product_id = $2`,
      [binId, productId],
    );
    return new Decimal(rows[0]?.on_hand ?? '0');
  };
  const binStatus = async (binId: number) => {
    const { rows } = await sql.query<{ status: string }>(`SELECT status FROM bins WHERE id = $1`, [
      binId,
    ]);
    return rows[0]?.status;
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
    warehouseId = (await inventory.warehouse('WH1')).id;
    shelf = (await inventory.bin(warehouseId, 'A-01-01')).id;
    other = (await inventory.bin(warehouseId, 'A-01-02')).id;
    empty = (await inventory.bin(warehouseId, 'A-01-03')).id;
    const catalog = catalogApi(app, adminToken);
    const product = await catalog.product({
      sku: '1',
      name: 'Гурил',
      categoryId: await catalog.category('Хүнс'),
      baseUomId: await catalog.uomId('PCS'),
    });
    productId = product.id;
    unitId = unitOf(product, 'PCS').id;
    // The receipt puts the flour on its fixed shelf in its home (ADR-0099 #1).
    await inventory.homeShelf(productId, warehouseId, shelf);
    const supplierId = (await partnersApi(app, adminToken).supplier({ name: 'МСМ' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(workerToken))
      .set(idempotency())
      .send({ supplierId, lines: [{ productUnitId: unitId, enteredQty: '100' }] })
      .expect(201);
    await postReceipt(app, workerToken, (receipt.body as { id: number }).id);
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('freezes what the bin holds after a concurrent move settles', async () => {
    const statuses: number[] = [];
    for (let round = 0; round < 6; round += 1) {
      const draft = await stocktakes.create(worker, { warehouseId, binIds: [shelf] });
      const [moved, started] = await Promise.all([
        http()
          .post('/api/v1/bin-moves')
          .set(bearer(workerToken))
          .set(idempotency())
          .send({
            warehouseId,
            lines: [{ productUnitId: unitId, enteredQty: '1', fromBinId: shelf, toBinId: other }],
          }),
        stocktakes.start(worker, draft.id),
      ]);
      statuses.push(moved.status);
      if (moved.status === 409) {
        expect((moved.body as { code: string }).code).toBe('BIN_LOCKED_FOR_COUNT');
      } else {
        expect(moved.status).toBe(201);
      }
      const lines = (await stocktakes.lines(started.id, { limit: 200 })).data;
      const frozen = lines.find((line) => line.productId === productId)?.expectedQty;
      expect(frozen?.toFixed()).toBe((await onHand(shelf)).toFixed());
      await stocktakes.cancel(worker, draft.id);
      expect(await binStatus(shelf)).toBe('ACTIVE');
    }
    expect(statuses).toHaveLength(6);
  });

  it('lets exactly one of approve and cancel win', async () => {
    for (let round = 0; round < 6; round += 1) {
      const draft = await stocktakes.create(worker, { warehouseId, binIds: [shelf] });
      await stocktakes.start(worker, draft.id);
      const before = await onHand(shelf);
      const frozen = (await stocktakes.lines(draft.id, { limit: 200 })).data;
      await stocktakes.count(
        worker,
        draft.id,
        frozen.map((line) => ({
          binId: line.binId,
          productId: line.productId,
          countedQty: line.expectedQty.minus(1),
        })),
      );
      await stocktakes.finishBin(worker, draft.id, shelf);
      await stocktakes.review(worker, draft.id);
      // A stocktake in review is cancelled by an approver (ADR-0038).
      const [approved, cancelled] = await Promise.allSettled([
        stocktakes.approve(admin, draft.id),
        stocktakes.cancel(admin, draft.id),
      ]);
      const outcome = [approved.status, cancelled.status];
      expect([
        ['fulfilled', 'rejected'],
        ['rejected', 'fulfilled'],
      ]).toContainEqual(outcome);
      const { rows } = await sql.query<{ status: string; ledger: string }>(
        `SELECT s.status, (SELECT count(*) FROM stock_ledger l
                             WHERE l.doc_type = 'ST' AND l.doc_id = s.id)::text AS ledger
           FROM stocktakes s WHERE s.id = $1`,
        [draft.id],
      );
      const after = await onHand(shelf);
      if (approved.status === 'fulfilled') {
        expect(rows[0]).toEqual({ status: 'APPROVED', ledger: '1' });
        expect(after.toFixed()).toBe(before.minus(1).toFixed());
      } else {
        expect(rows[0]).toEqual({ status: 'CANCELLED', ledger: '0' });
        expect(after.toFixed()).toBe(before.toFixed());
      }
      expect(await binStatus(shelf)).toBe('ACTIVE');
    }
  });

  it('adds up every concurrent scan, on a frozen line and on a found one', async () => {
    const draft = await stocktakes.create(worker, { warehouseId, binIds: [shelf, empty] });
    await stocktakes.start(worker, draft.id);
    const scans = (binId: number) =>
      Array.from({ length: 12 }, () =>
        stocktakes.scan(worker, draft.id, { binId, productUnitId: unitId, qty: new Decimal(2) }),
      );
    await Promise.all([...scans(shelf), ...scans(empty)]);
    const lines = (await stocktakes.lines(draft.id, { limit: 200 })).data;
    expect(lines.map((line) => [line.binId, line.countedQty?.toFixed()])).toEqual([
      [shelf, '24'],
      [empty, '24'],
    ]);
    await stocktakes.cancel(worker, draft.id);
  });

  it('keeps a scan that races its bin being finished, and no scan lands after review', async () => {
    for (let round = 0; round < 4; round += 1) {
      const draft = await stocktakes.create(worker, { warehouseId, binIds: [shelf, empty] });
      await stocktakes.start(worker, draft.id);
      const scan = (qty: number) =>
        stocktakes.scan(worker, draft.id, {
          binId: shelf,
          productUnitId: unitId,
          qty: new Decimal(qty),
        });
      // Finished first: the uncounted line is 0, then the scan adds 3; scanned first: 3 stays.
      await Promise.all([stocktakes.finishBin(worker, draft.id, shelf), scan(3)]);
      const counted = async () =>
        (await stocktakes.lines(draft.id, { binId: shelf })).data[0]?.countedQty?.toFixed();
      expect(await counted()).toBe('3');
      await stocktakes.finishBin(worker, draft.id, empty);
      const [reviewed, ...late] = await Promise.allSettled([
        stocktakes.review(worker, draft.id),
        ...Array.from({ length: 6 }, () => scan(1)),
      ]);
      expect(reviewed?.status).toBe('fulfilled');
      let added = 0;
      for (const result of late) {
        if (result.status === 'fulfilled') added += 1;
        else expect(toProblem(result.reason, {}).code).toBe('DOC_STATE_INVALID');
      }
      expect(await counted()).toBe(String(3 + added));
      expect(toProblem(await scan(1).catch((error: unknown) => error), {}).code).toBe(
        'DOC_STATE_INVALID',
      );
      await stocktakes.cancel(admin, draft.id);
    }
  });
});
