import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import request from 'supertest';
import type { AuthContext } from '../../src/modules/identity';
import { StocktakesService } from '../../src/modules/inventory';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, idempotency, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, staffContext } from '../harness/inventory';
import { partnersApi } from '../harness/partners';

/**
 * SPEC §6.8 under concurrency: a stocktake starting while goods move off its bin freezes exactly
 * what the bin holds once the move is settled, and approving and cancelling the same count let
 * exactly one through.
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
    const catalog = catalogApi(app, adminToken);
    const product = await catalog.product({
      sku: '1',
      name: 'Гурил',
      categoryId: await catalog.category('Хүнс'),
      baseUomId: await catalog.uomId('PCS'),
    });
    productId = product.id;
    unitId = unitOf(product, 'PCS').id;
    const supplierId = (await partnersApi(app, adminToken).supplier({ name: 'МСМ' })).id;
    const receipt = await http()
      .post('/api/v1/receipts')
      .set(bearer(workerToken))
      .set(idempotency())
      .send({
        warehouseId,
        supplierId,
        lines: [{ productUnitId: unitId, enteredQty: '100', binId: shelf }],
      })
      .expect(201);
    await http()
      .post(`/api/v1/receipts/${(receipt.body as { id: number }).id}/post`)
      .set(bearer(workerToken))
      .set(idempotency())
      .expect(200);
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
      const frozen = started.lines.find((line) => line.productId === productId)?.expectedQty;
      expect(frozen?.toFixed()).toBe((await onHand(shelf)).toFixed());
      await stocktakes.cancel(worker, draft.id);
      expect(await binStatus(shelf)).toBe('ACTIVE');
    }
    expect(statuses).toHaveLength(6);
  });

  it('lets exactly one of approve and cancel win', async () => {
    for (let round = 0; round < 6; round += 1) {
      const draft = await stocktakes.create(worker, { warehouseId, binIds: [shelf] });
      const started = await stocktakes.start(worker, draft.id);
      const before = await onHand(shelf);
      await stocktakes.count(
        worker,
        draft.id,
        started.lines.map((line) => ({
          binId: line.binId,
          productId: line.productId,
          countedQty: line.expectedQty.minus(1),
        })),
      );
      await stocktakes.review(worker, draft.id);
      const [approved, cancelled] = await Promise.allSettled([
        stocktakes.approve(admin, draft.id),
        stocktakes.cancel(worker, draft.id),
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
});
