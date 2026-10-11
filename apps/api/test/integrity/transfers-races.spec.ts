import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import type { Client } from 'pg';
import { DB } from '../../src/common/db/db.tokens';
import { toProblem } from '../../src/common/errors/problem-details';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { type AuthContext, systemActor } from '../../src/modules/identity';
import {
  AdjustmentsService,
  MAX_MOVEMENTS_PER_POST,
  MAX_TRANSFER_LINES,
  type Movement,
  StockPostingService,
  StocktakesService,
  type TransferDetail,
  TransfersService,
} from '../../src/modules/inventory';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, type ProductJson, unitOf } from '../harness/catalog';
import { login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi, staffContext } from '../harness/inventory';

/**
 * Two-step transfers under concurrency (ADR-0035): TRANSIT returns to zero per line in quantity and
 * value even with transfers of one product in flight together; a request is either shipped or
 * cancelled; a transfer is received once; opposite transfers never deadlock; a shortfall returning
 * to a shelf being counted lands before the count or waits for it; a transfer of the largest size
 * posts in one go (statements in chunks).
 */
/** The problem code of a rejected call (Promise.allSettled). */
const reasonCode = (reason: unknown) => toProblem(reason, {}).code;

describe('integrity: transfers', () => {
  let app: NestExpressApplication;
  let sql: Client;
  let transfers: TransfersService;
  let stocktakes: StocktakesService;
  let adjustments: AdjustmentsService;
  let posting: StockPostingService;
  let admin: AuthContext;
  let worker: AuthContext;
  let clerk: AuthContext;
  let wh1: number;
  let wh2: number;
  let store: number;
  let shelf: number;
  let wh2Shelf: number;
  let floor: number;
  let pcsUom: number;
  let categoryId: number;
  let flour: ProductJson;
  let sugar: ProductJson;

  const pcs = (product: ProductJson) => unitOf(product, 'PCS').id;
  const lineOf = (transfer: TransferDetail, productId: number) => {
    const line = transfer.lines.find((row) => row.productId === productId);
    if (!line) throw new Error(`no line for product ${productId}`);
    return line;
  };
  const onHand = async (binId: number, productId: number) => {
    const { rows } = await sql.query<{ on_hand: string }>(
      `SELECT on_hand::text FROM bin_stock WHERE bin_id = $1 AND product_id = $2`,
      [binId, productId],
    );
    return rows[0]?.on_hand ?? '0';
  };
  /** Transfer lines whose TRANSIT legs do not net to zero in quantity or value. */
  const unbalancedTransit = async () => {
    const { rows } = await sql.query<{ doc_line_id: string }>(
      `SELECT l.doc_line_id::text FROM stock_ledger l JOIN bins b ON b.id = l.bin_id
        WHERE l.doc_type = 'TR' AND b.type = 'TRANSIT'
          AND l.doc_line_id IN (SELECT tl.id FROM transfer_lines tl JOIN transfers t ON t.id = tl.transfer_id
                                 WHERE t.status = 'RECEIVED')
        GROUP BY l.doc_line_id
       HAVING sum(l.qty_base) <> 0 OR sum(l.qty_base * l.unit_cost) <> 0`,
    );
    return rows;
  };
  /** Surplus stock at a cost per piece, posted by an approved adjustment. */
  const stock = async (
    warehouseId: number,
    binId: number,
    product: ProductJson,
    qty: string,
    cost: string,
  ) => {
    const draft = await adjustments.create(admin, {
      warehouseId,
      reason: 'SURPLUS',
      lines: [{ productUnitId: pcs(product), enteredQty: new Decimal(qty), binId }],
    });
    await adjustments.submit(admin, draft.id);
    const lineId = draft.lines[0]?.id ?? 0;
    await adjustments.approve(admin, draft.id, [{ lineId, unitCost: new Decimal(cost) }]);
  };
  const request = async (
    ctx: AuthContext,
    sourceWarehouseId: number,
    destWarehouseId: number,
    lines: { product: ProductJson; qty: string }[],
  ) => {
    const draft = await transfers.create(ctx, {
      origin: 'REQUEST',
      sourceWarehouseId,
      destWarehouseId,
      lines: lines.map((line) => ({
        productUnitId: pcs(line.product),
        qty: new Decimal(line.qty),
      })),
    });
    return transfers.request(ctx, draft.id);
  };

  beforeAll(async () => {
    app = await createHttpApp();
    sql = await connectAs('app');
    transfers = app.get(TransfersService);
    stocktakes = app.get(StocktakesService);
    adjustments = app.get(AdjustmentsService);
    posting = app.get(StockPostingService);
    const adminUser = await seedUser(app, { roles: ['ADMIN'] });
    const adminToken = (await login(app, adminUser)).accessToken;
    admin = staffContext(adminUser.id, 'ADMIN');
    worker = staffContext((await seedUser(app, { roles: ['WAREHOUSE'] })).id, 'WAREHOUSE');
    const inventory = inventoryApi(app, adminToken);
    wh1 = (await inventory.warehouse('WH1')).id;
    wh2 = (await inventory.warehouse('WH2')).id;
    store = (await inventory.warehouse('STORE1', 'STORE')).id;
    clerk = staffContext((await seedUser(app, { roles: ['POS_CASHIER'] })).id, 'POS_CASHIER', [
      store,
    ]);
    shelf = (await inventory.bin(wh1, 'A-01-01')).id;
    wh2Shelf = (await inventory.bin(wh2, 'B-01-01')).id;
    floor = (await inventory.systemBin(store, 'SALESFLOOR')).id;
    const catalog = catalogApi(app, adminToken);
    categoryId = await catalog.category('Хүнс');
    pcsUom = await catalog.uomId('PCS');
    const product = (sku: string, name: string) =>
      catalog.product({ sku, name, categoryId, baseUomId: pcsUom });
    flour = await product('1', 'Гурил');
    sugar = await product('2', 'Элсэн чихэр');
    await stock(wh1, shelf, flour, '1000', '1000');
    await stock(wh1, shelf, sugar, '1000', '2000');
    await stock(wh2, wh2Shelf, flour, '100', '1500');
    await stock(store, floor, flour, '500', '1000');
    await stock(store, floor, sugar, '500', '2000');
    // Fixed shelves: shipments leave them unless another shelf is scanned.
    await sql.query(
      `INSERT INTO product_locations (warehouse_id, product_id, default_bin_id)
       VALUES ($1, $2, $3), ($1, $4, $3), ($5, $2, $6)`,
      [wh1, flour.id, shelf, sugar.id, wh2, wh2Shelf],
    );
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sql.end();
    await app.close();
  });

  it('keeps TRANSIT at zero per line in quantity and value while one product flies from two senders', async () => {
    for (let round = 0; round < 3; round += 1) {
      const fromWh1 = await request(admin, wh1, store, [{ product: flour, qty: '10' }]);
      const fromWh2 = await request(admin, wh2, store, [{ product: flour, qty: '10' }]);
      await Promise.all([
        transfers.ship(worker, fromWh1.id, [
          { lineId: lineOf(fromWh1, flour.id).id, binId: shelf },
        ]),
        transfers.ship(worker, fromWh2.id, [
          { lineId: lineOf(fromWh2, flour.id).id, binId: wh2Shelf },
        ]),
      ]);
      // Received in the opposite order, one of them short.
      await Promise.all([
        transfers.receive(clerk, fromWh2.id),
        transfers.receive(clerk, fromWh1.id, [
          { lineId: lineOf(fromWh1, flour.id).id, qty: new Decimal(7) },
        ]),
      ]);
      const { rows } = await sql.query<{ leg: number; unit_cost: string }>(
        `SELECT leg, unit_cost::text FROM stock_ledger
          WHERE doc_type = 'TR' AND doc_id = $1 AND leg IN (3, 4, 6) ORDER BY leg`,
        [fromWh1.id],
      );
      // WH1's flour arrives and goes back at WH1's cost, never at TRANSIT's pooled average.
      expect(rows).toEqual([
        { leg: 3, unit_cost: '1000.0000' },
        { leg: 4, unit_cost: '1000.0000' },
        { leg: 6, unit_cost: '1000.0000' },
      ]);
    }
    expect(await unbalancedTransit()).toEqual([]);
    const { rows: transit } = await sql.query<{ on_hand: string }>(
      `SELECT ws.on_hand::text FROM warehouse_stock ws JOIN warehouses w ON w.id = ws.warehouse_id
        WHERE w.kind = 'TRANSIT' AND ws.product_id = $1`,
      [flour.id],
    );
    expect(transit).toEqual([{ on_hand: '0.000' }]);
  });

  it('lets exactly one of shipping and cancelling a request win', async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      const sent = await request(clerk, wh1, store, [{ product: sugar, qty: '1' }]);
      const [shipped, cancelled] = await Promise.allSettled([
        transfers.ship(worker, sent.id),
        transfers.cancel(clerk, sent.id),
      ]);
      const final = await transfers.get(sent.id);
      const { rows } = await sql.query(
        `SELECT 1 FROM stock_ledger WHERE doc_type = 'TR' AND doc_id = $1`,
        [sent.id],
      );
      if (shipped.status === 'fulfilled') {
        expect(cancelled.status).toBe('rejected');
        expect(reasonCode((cancelled as PromiseRejectedResult).reason)).toBe('DOC_STATE_INVALID');
        expect(final.status).toBe('SHIPPED');
        expect(rows).toHaveLength(2);
        await transfers.receive(clerk, sent.id);
      } else {
        expect(cancelled.status).toBe('fulfilled');
        expect(reasonCode(shipped.reason)).toBe('DOC_STATE_INVALID');
        expect(final.status).toBe('CANCELLED');
        expect(rows).toHaveLength(0);
      }
      outcomes.push(final.status);
    }
    expect(outcomes).toHaveLength(6);
  });

  it('receives a transfer once when two receivers confirm together', async () => {
    for (let round = 0; round < 4; round += 1) {
      const sent = await request(clerk, wh1, store, [{ product: sugar, qty: '2' }]);
      await transfers.ship(worker, sent.id);
      const results = await Promise.allSettled([
        transfers.receive(clerk, sent.id),
        transfers.receive(clerk, sent.id),
      ]);
      const failed = results.filter((result) => result.status === 'rejected');
      expect(failed).toHaveLength(1);
      expect(reasonCode((failed[0] as PromiseRejectedResult).reason)).toBe('DOC_ALREADY_POSTED');
      const { rows } = await sql.query<{ leg: number }>(
        `SELECT leg FROM stock_ledger WHERE doc_type = 'TR' AND doc_id = $1 ORDER BY leg`,
        [sent.id],
      );
      expect(rows.map((row) => row.leg)).toEqual([1, 2, 3, 4]);
    }
  });

  it('receives opposite transfers of the same products at once without deadlock', async () => {
    for (let round = 0; round < 5; round += 1) {
      const toStore = await request(clerk, wh1, store, [
        { product: flour, qty: '3' },
        { product: sugar, qty: '3' },
      ]);
      const back = await transfers.create(clerk, {
        origin: 'PUSH',
        sourceWarehouseId: store,
        destWarehouseId: wh1,
        lines: [
          { productUnitId: pcs(sugar), qty: new Decimal(2) },
          { productUnitId: pcs(flour), qty: new Decimal(2) },
        ],
      });
      await transfers.ship(worker, toStore.id);
      await transfers.ship(clerk, back.id);
      const [one, two] = await Promise.all([
        transfers.receive(clerk, toStore.id),
        transfers.receive(worker, back.id, [
          { lineId: lineOf(back, flour.id).id, binId: shelf },
          { lineId: lineOf(back, sugar.id).id, binId: shelf, qty: new Decimal(3) },
        ]),
      ]);
      expect([one.status, two.status]).toEqual(['RECEIVED', 'RECEIVED']);
    }
    expect(await unbalancedTransit()).toEqual([]);
  });

  it('lands a shortfall on a shelf before its count starts, or refuses it while counted', async () => {
    const outcomes: string[] = [];
    for (let round = 0; round < 6; round += 1) {
      const sent = await request(clerk, wh1, store, [{ product: flour, qty: '4' }]);
      await transfers.ship(worker, sent.id, [{ lineId: lineOf(sent, flour.id).id, binId: shelf }]);
      const draft = await stocktakes.create(worker, { warehouseId: wh1, binIds: [shelf] });
      const [received, started] = await Promise.allSettled([
        transfers.receive(clerk, sent.id, [
          { lineId: lineOf(sent, flour.id).id, qty: new Decimal(1) },
        ]),
        stocktakes.start(worker, draft.id),
      ]);
      if (started.status !== 'fulfilled') throw started.reason;
      const frozen = started.value.lines.find((line) => line.productId === flour.id)?.expectedQty;
      if (received.status === 'fulfilled') {
        // The 3 pieces came back before the count froze the shelf.
        expect(frozen?.toFixed(3)).toBe(await onHand(shelf, flour.id));
        outcomes.push('received');
        await stocktakes.cancel(worker, draft.id);
      } else {
        expect(reasonCode(received.reason)).toBe('BIN_LOCKED_FOR_COUNT');
        expect(frozen?.toFixed(3)).toBe(await onHand(shelf, flour.id));
        outcomes.push('refused');
        await stocktakes.cancel(worker, draft.id);
        await transfers.receive(clerk, sent.id, [
          { lineId: lineOf(sent, flour.id).id, qty: new Decimal(1) },
        ]);
      }
    }
    expect(outcomes).toHaveLength(6);
    expect(await unbalancedTransit()).toEqual([]);
  });

  it('ships and receives a transfer of the largest size in one posting each', async () => {
    const count = MAX_TRANSFER_LINES;
    const { rows: units } = await sql.query<{ product_id: string; id: string }>(
      `WITH p AS (
         INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id)
         SELECT (900000 + g)::text, 'Бараа ' || g, ' бараа ' || g, ' baraa ' || g, 1, $1
           FROM generate_series(1, $2::int) g
         RETURNING id)
       INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base)
       SELECT id, $3, 1, true FROM p ORDER BY id
       RETURNING product_id::text, id::text`,
      [categoryId, count, pcsUom],
    );
    const products = units.map((row) => ({
      productId: Number.parseInt(row.product_id, 10),
      unitId: Number.parseInt(row.id, 10),
    }));
    await sql.query(
      `INSERT INTO product_locations (warehouse_id, product_id, default_bin_id)
       SELECT $1, unnest($2::bigint[]), $3`,
      [wh1, products.map((row) => row.productId), shelf],
    );
    // Opening stock of 10 each at 100, through the posting service directly.
    const { rows: header } = await sql.query<{ id: string }>(
      `INSERT INTO adjustments (warehouse_id, reason, status) VALUES ($1, 'SURPLUS', 'SUBMITTED') RETURNING id`,
      [wh1],
    );
    const adjustmentId = Number.parseInt(header[0]?.id ?? '0', 10);
    const movements: Movement[] = products.map((row, index) => ({
      docType: 'ADJ',
      docId: adjustmentId,
      docLineId: 1_000_000 + index,
      movementType: 'ADJUSTMENT',
      leg: 1,
      warehouseId: wh1,
      binId: shelf,
      productId: row.productId,
      qtyBase: new Decimal(10),
      enteredQty: new Decimal(10),
      productUnitId: row.unitId,
      factorSnapshot: new Decimal(1),
      unitCost: new Decimal(100),
    }));
    const db = app.get<Db>(DB);
    const actor = systemActor('integrity-test');
    const doc = {
      docType: 'ADJ' as const,
      docId: adjustmentId,
      expectedStatus: 'SUBMITTED',
      nextStatus: 'POSTED',
    };
    await inTransaction(db, (tx) => posting.post(tx, actor, { docs: [doc], movements }));
    // More movements than one posting takes are refused before anything is locked.
    const tooMany = Array.from({ length: MAX_MOVEMENTS_PER_POST + 1 }, (_, index) => ({
      ...(movements[0] as Movement),
      docLineId: 2_000_000 + index,
    }));
    expect(
      await codeOf(
        inTransaction(db, (tx) => posting.post(tx, actor, { docs: [doc], movements: tooMany })),
      ),
    ).toBe('VALIDATION_FAILED');

    const draft = await transfers.create(clerk, {
      origin: 'REQUEST',
      sourceWarehouseId: wh1,
      destWarehouseId: store,
    });
    await sql.query(
      `INSERT INTO transfer_lines (transfer_id, product_id, request_unit_id, request_factor, requested_qty)
       SELECT $1, u.product_id, u.id, 1, 2 FROM product_units u WHERE u.product_id = ANY($2::bigint[])`,
      [draft.id, products.map((row) => row.productId)],
    );
    await transfers.request(clerk, draft.id);
    const started = Date.now();
    const shipped = await transfers.ship(worker, draft.id);
    expect(shipped.lines).toHaveLength(count);
    // A third arrives short by one, a third with one extra, the rest exactly.
    const received = await transfers.receive(
      clerk,
      draft.id,
      shipped.lines.flatMap((line, index) =>
        index % 3 === 2 ? [] : [{ lineId: line.id, qty: new Decimal(index % 3 === 0 ? 1 : 3) }],
      ),
    );
    const seconds = (Date.now() - started) / 1000;
    expect(received.status).toBe('RECEIVED');
    const { rows: legs } = await sql.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM stock_ledger WHERE doc_type = 'TR' AND doc_id = $1`,
      [draft.id],
    );
    const thirds = Math.ceil(count / 3);
    expect(Number.parseInt(legs[0]?.count ?? '0', 10)).toBe(count * 4 + thirds + thirds * 2);
    expect(await unbalancedTransit()).toEqual([]);
    const { rows: shelfStock } = await sql.query<{ total: string }>(
      `SELECT sum(on_hand)::text AS total FROM bin_stock
        WHERE bin_id = $1 AND product_id = ANY($2::bigint[])`,
      [shelf, products.map((row) => row.productId)],
    );
    // 10 each, 2 shipped; a third got 1 back, a third gave 1 more.
    expect(shelfStock[0]?.total).toBe(new Decimal(count * 8).toFixed(3));
    expect(seconds).toBeLessThan(60);
  }, 180_000);
});
