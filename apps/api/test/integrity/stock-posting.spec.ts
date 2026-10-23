import type { NestExpressApplication } from '@nestjs/platform-express';
import { Decimal } from '@tugeel/shared/money';
import { businessYear } from '@tugeel/shared/time';
import { sql } from 'drizzle-orm';
import type { Client } from 'pg';
import request from 'supertest';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { systemActor } from '../../src/modules/identity';
import {
  type Movement,
  type PostedDocType,
  StockPostingService,
} from '../../src/modules/inventory';
import { connectAs, createHttpApp } from '../harness/apps';
import { catalogApi, codeOf, unitOf } from '../harness/catalog';
import { bearer, login, seedUser } from '../harness/identity';
import { expectReconciled, inventoryApi } from '../harness/inventory';

const actor = systemActor('integrity-test');
const STATUSES: Record<PostedDocType, [string, string]> = {
  GR: ['DRAFT', 'POSTED'],
  BM: ['DRAFT', 'POSTED'],
  ADJ: ['SUBMITTED', 'POSTED'],
  ST: ['REVIEW', 'APPROVED'],
  TR: ['DRAFT', 'SHIPPED'],
  GI: ['DRAFT', 'POSTED'],
};

/**
 * StockPostingService under concurrency (ADR-0007, ADR-0016, ADR-0034): one lock order, no negative
 * stock, no double posting, NULL lots as one bucket, counted and archived bins refused, and costing
 * consistent with a concurrent issue. Every test ends with the ledger and the caches in agreement.
 */
describe('integrity: stock posting', () => {
  let app: NestExpressApplication;
  let db: Db;
  let posting: StockPostingService;
  let sqlApp: Client;
  let admin: string;
  let warehouseId: number;
  let supplierId: number;
  let receiving: number;
  const shelves: number[] = [];
  let lineNo = 0;

  interface Item {
    id: number;
    base: number;
    box: number;
  }
  const items: Item[] = [];

  const one = async (text: string, params: unknown[] = []) => {
    const { rows } = await sqlApp.query<{ id: string }>(text, params);
    return Number.parseInt(rows[0]?.id ?? '0', 10);
  };
  const header = (docType: PostedDocType) => {
    const [status] = STATUSES[docType];
    switch (docType) {
      case 'GR':
        // A receipt's warehouses live on its lines (ADR-0099 #1); the movements name theirs.
        return one(
          `INSERT INTO goods_receipts (supplier_id, status) VALUES ($1, $2) RETURNING id`,
          [supplierId, status],
        );
      case 'BM':
        return one(`INSERT INTO bin_moves (warehouse_id, status) VALUES ($1, $2) RETURNING id`, [
          warehouseId,
          status,
        ]);
      case 'ADJ':
        return one(
          `INSERT INTO adjustments (warehouse_id, reason, status) VALUES ($1, 'SURPLUS', $2) RETURNING id`,
          [warehouseId, status],
        );
      case 'ST':
        return one(
          `INSERT INTO stocktakes (warehouse_id, status, started_at) VALUES ($1, $2, now()) RETURNING id`,
          [warehouseId, status],
        );
      case 'GI':
        return one(
          `INSERT INTO goods_issues (warehouse_id, issued_on, expense_type_id, recipient_kind, recipient_name, status)
           SELECT $1, current_date, id, 'OTHER', 'Тест', $2 FROM issue_expense_types ORDER BY id LIMIT 1 RETURNING id`,
          [warehouseId, status],
        );
      case 'TR':
        return one(
          `INSERT INTO transfers (origin, source_warehouse_id, dest_warehouse_id, status)
           SELECT 'PUSH', $1, id, $2 FROM warehouses WHERE kind = 'TRANSIT' RETURNING id`,
          [warehouseId, status],
        );
    }
  };
  /** One movement of `qty` base units (boxes when `boxes` is set: 24 each). */
  const move = (
    docType: PostedDocType,
    docId: number,
    item: Item,
    qty: number,
    rest: Partial<Movement> = {},
  ): Movement => {
    lineNo += 1;
    const boxes = rest.productUnitId === item.box;
    const amount = new Decimal(qty);
    return {
      docType,
      docId,
      docLineId: lineNo,
      movementType: 'ADJUSTMENT',
      leg: 1,
      warehouseId,
      binId: shelves[0] ?? 0,
      productId: item.id,
      qtyBase: amount,
      enteredQty: boxes ? amount.abs().dividedBy(24) : amount.abs(),
      productUnitId: item.base,
      factorSnapshot: new Decimal(boxes ? 24 : 1),
      ...rest,
    };
  };
  const post = (docType: PostedDocType, docId: number, movements: Movement[]) => {
    const [expectedStatus, nextStatus] = STATUSES[docType];
    return inTransaction(db, (tx) =>
      posting.post(tx, actor, {
        docs: [{ docType, docId, expectedStatus, nextStatus }],
        movements,
      }),
    );
  };
  /** Posts an adjustment whose header exists (concurrent tests create headers first: one sql client). */
  const postAdjustment = (id: number, item: Item, qty: number, rest: Partial<Movement> = {}) =>
    post('ADJ', id, [move('ADJ', id, item, qty, rest)]);
  const adjust = async (item: Item, qty: number, rest: Partial<Movement> = {}) =>
    postAdjustment(await header('ADJ'), item, qty, rest);
  const headers = async (count: number) => {
    const ids: number[] = [];
    for (let i = 0; i < count; i += 1) ids.push(await header('ADJ'));
    return ids;
  };
  const balance = async (item: Item) => {
    const { rows } = await sqlApp.query<{
      on_hand: string;
      sellable_on_hand: string;
      avg_cost: string;
    }>(
      `SELECT on_hand, sellable_on_hand, avg_cost FROM warehouse_stock WHERE warehouse_id = $1 AND product_id = $2`,
      [warehouseId, item.id],
    );
    return rows[0];
  };
  const binQty = async (binId: number, item: Item) => {
    const { rows } = await sqlApp.query<{ on_hand: string }>(
      `SELECT on_hand FROM bin_stock WHERE bin_id = $1 AND product_id = $2`,
      [binId, item.id],
    );
    return rows.map((row) => row.on_hand);
  };

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    posting = app.get(StockPostingService);
    sqlApp = await connectAs('app');
    admin = (await login(app, await seedUser(app, { roles: ['ADMIN'] }))).accessToken;
    const inventory = inventoryApi(app, admin);
    const catalog = catalogApi(app, admin);
    warehouseId = (await inventory.warehouse('WH1')).id;
    for (const code of ['A-01-01', 'A-01-02', 'A-01-03', 'A-01-04']) {
      shelves.push((await inventory.bin(warehouseId, code)).id);
    }
    receiving = (await inventory.systemBin(warehouseId, 'RECEIVING')).id;
    const category = await catalog.category('Ундаа');
    const pcs = await catalog.uomId('PCS');
    const box = await catalog.uomId('BOX');
    for (let i = 1; i <= 6; i += 1) {
      const product = await catalog.product({
        sku: String(500 + i),
        name: `Бараа ${i}`,
        categoryId: category,
        baseUomId: pcs,
        units: [{ uomId: box, factorToBase: '24' }],
      });
      items.push({
        id: product.id,
        base: unitOf(product, 'PCS').id,
        box: unitOf(product, 'BOX').id,
      });
    }
    supplierId = await one(
      `INSERT INTO suppliers (code, name, name_key, search_text, search_phonetic, search_version)
       VALUES ('1', 'МСМ', 'мсм', ' мсм', ' msm', 1) RETURNING id`,
    );
  });
  afterAll(async () => {
    await expectReconciled(app);
    await sqlApp.end();
    await app.close();
  });

  const item = (index: number) => {
    const found = items[index];
    if (!found) throw new Error(`no item ${index}`);
    return found;
  };

  it('receives at the average, numbers the documents and keeps one balance row per key', async () => {
    const cola = item(0);
    const year = businessYear();
    const surplus = await adjust(cola, 10, { unitCost: new Decimal(1000) });
    expect([...surplus.numbers.values()]).toEqual([`ADJ-${year}-000001`]);
    const receiptId = await header('GR');
    const received = await post('GR', receiptId, [
      move('GR', receiptId, cola, 48, { movementType: 'RECEIPT', productUnitId: cola.box }),
    ]);
    expect([...received.numbers.values()]).toEqual([`GR-${year}-000001`]);
    expect(await balance(cola)).toEqual({
      on_hand: '58.000',
      sellable_on_hand: '58.000',
      avg_cost: '1000.0000',
    });
    const { rows } = await sqlApp.query(
      `SELECT movement_type, qty_base, unit_cost, entered_qty, factor_snapshot FROM stock_ledger
        WHERE product_id = $1 ORDER BY id`,
      [cola.id],
    );
    expect(rows).toEqual([
      {
        movement_type: 'ADJUSTMENT',
        qty_base: '10.000',
        unit_cost: '1000.0000',
        entered_qty: '10.000',
        factor_snapshot: '1.000000',
      },
      {
        movement_type: 'RECEIPT',
        qty_base: '48.000',
        unit_cost: '1000.0000',
        entered_qty: '2.000',
        factor_snapshot: '24.000000',
      },
    ]);
    const { rows: receiptRows } = await sqlApp.query(
      `SELECT status, costing_status, number FROM goods_receipts WHERE id = $1`,
      [receiptId],
    );
    expect(receiptRows[0]).toEqual({
      status: 'POSTED',
      costing_status: 'PENDING',
      number: `GR-${year}-000001`,
    });
    expect(await binQty(shelves[0] ?? 0, cola)).toEqual(['58.000']);
  });

  it('refuses a document posted twice and movements repeated within one posting', async () => {
    const cola = item(0);
    const id = await header('ADJ');
    await post('ADJ', id, [move('ADJ', id, cola, 1)]);
    expect(await codeOf(post('ADJ', id, [move('ADJ', id, cola, 1)]))).toBe('DOC_ALREADY_POSTED');
    const twice = await header('ADJ');
    const first = move('ADJ', twice, cola, 1);
    expect(await codeOf(post('ADJ', twice, [first, { ...first }]))).toBe('ALREADY_POSTED');
    const { rows } = await sqlApp.query(`SELECT status, number FROM adjustments WHERE id = $1`, [
      twice,
    ]);
    expect(rows[0]).toEqual({ status: 'SUBMITTED', number: null });
  });

  it('moves stock between bins without changing the warehouse, and makes put-away sellable', async () => {
    const tea = item(1);
    await adjust(tea, 12, { unitCost: new Decimal(500) });
    const before = await balance(tea);
    const moveId = await header('BM');
    lineNo += 1;
    const line = lineNo;
    await post('BM', moveId, [
      move('BM', moveId, tea, -5, {
        docLineId: line,
        movementType: 'BIN_MOVE_OUT',
        binId: shelves[0],
      }),
      move('BM', moveId, tea, 5, {
        docLineId: line,
        movementType: 'BIN_MOVE_IN',
        leg: 2,
        binId: shelves[1],
      }),
    ]);
    expect(await balance(tea)).toEqual(before);
    expect(await binQty(shelves[1] ?? 0, tea)).toEqual(['5.000']);

    const receiptId = await header('GR');
    await post('GR', receiptId, [
      move('GR', receiptId, tea, 24, { movementType: 'RECEIPT', binId: receiving }),
    ]);
    expect(await balance(tea)).toMatchObject({ on_hand: '36.000', sellable_on_hand: '12.000' });
    const putaway = await header('BM');
    lineNo += 1;
    await post('BM', putaway, [
      move('BM', putaway, tea, -24, {
        docLineId: lineNo,
        movementType: 'PUTAWAY_OUT',
        binId: receiving,
      }),
      move('BM', putaway, tea, 24, {
        docLineId: lineNo,
        movementType: 'PUTAWAY_IN',
        leg: 2,
        binId: shelves[1],
      }),
    ]);
    expect(await balance(tea)).toEqual({
      on_hand: '36.000',
      sellable_on_hand: '36.000',
      avg_cost: '500.0000',
    });
  });

  it('never lets two concurrent issues overdraw a bin', async () => {
    const milk = item(2);
    await adjust(milk, 10, { unitCost: new Decimal(2000) });
    const ids = await headers(2);
    const outcomes = await Promise.all(ids.map((id) => codeOf(postAdjustment(id, milk, -7))));
    expect(outcomes.sort()).toEqual(['STOCK_INSUFFICIENT', undefined].sort());
    expect(await binQty(shelves[0] ?? 0, milk)).toEqual(['3.000']);
  });

  it('serialises concurrent postings over the same rows and opposite orders without deadlock', async () => {
    const a = item(3);
    const b = item(4);
    const four = await headers(4);
    await Promise.all(four.map((id) => postAdjustment(id, a, 5, { unitCost: new Decimal(100) })));
    expect(await balance(a)).toMatchObject({ on_hand: '20.000' });
    const twoWay = (id: number, first: Item, second: Item) =>
      post('ADJ', id, [
        move('ADJ', id, first, 1, { unitCost: new Decimal(100) }),
        move('ADJ', id, second, 1, { unitCost: new Decimal(100) }),
      ]);
    for (let round = 0; round < 5; round += 1) {
      const [one, two] = await headers(2);
      await Promise.all([twoWay(one ?? 0, a, b), twoWay(two ?? 0, b, a)]);
    }
    expect(await balance(a)).toMatchObject({ on_hand: '30.000' });
    expect(await balance(b)).toMatchObject({ on_hand: '10.000' });
  });

  it('refuses bins being counted or archived', async () => {
    const bread = item(5);
    const stocktake = await header('ST');
    await sqlApp.query(
      `UPDATE bins SET status = 'COUNTING', locked_by_stocktake_id = $1 WHERE id = $2`,
      [stocktake, shelves[2]],
    );
    expect(await codeOf(adjust(bread, 3, { binId: shelves[2] }))).toBe('BIN_LOCKED_FOR_COUNT');
    await sqlApp.query(
      `UPDATE bins SET status = 'ACTIVE', locked_by_stocktake_id = NULL WHERE id = $1`,
      [shelves[2]],
    );
    await request(app.getHttpServer())
      .post(`/api/v1/bins/${shelves[2]}/archive`)
      .set(bearer(admin))
      .expect(200);
    expect(await codeOf(adjust(bread, 3, { binId: shelves[2] }))).toBe('BIN_ARCHIVED');
  });

  it('archives a bin only after a posting into it has committed', async () => {
    const bread = item(5);
    let posted!: () => void;
    let release!: () => void;
    const isPosted = new Promise<void>((resolve) => (posted = resolve));
    const released = new Promise<void>((resolve) => (release = resolve));
    const id = await header('ADJ');
    const holding = inTransaction(db, async (tx) => {
      await posting.post(tx, actor, {
        docs: [{ docType: 'ADJ', docId: id, expectedStatus: 'SUBMITTED', nextStatus: 'POSTED' }],
        movements: [move('ADJ', id, bread, 4, { binId: shelves[3], unitCost: new Decimal(10) })],
      });
      posted();
      await released;
    });
    // A failed posting rejects `holding` instead of leaving the test waiting for `posted`.
    await Promise.race([isPosted, holding]);
    const archiving = request(app.getHttpServer())
      .post(`/api/v1/bins/${shelves[3]}/archive`)
      .set(bearer(admin))
      .then((response) => response);
    await new Promise((resolve) => setTimeout(resolve, 300));
    release();
    await holding;
    const response = await archiving;
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('BIN_NOT_EMPTY');
  });

  it('costs a receipt consistently with a concurrent issue', async () => {
    const juice = item(4);
    // On hand: 10 at 100 from the earlier test; a receipt of 100 at the provisional average.
    const receiptId = await header('GR');
    lineNo += 1;
    const lineId = lineNo;
    await post('GR', receiptId, [
      move('GR', receiptId, juice, 100, { docLineId: lineId, movementType: 'RECEIPT' }),
    ]);
    expect(await balance(juice)).toMatchObject({ on_hand: '110.000', avg_cost: '100.0000' });
    const [issueId] = await headers(1);
    const costing = inTransaction(db, async (tx) => {
      await tx.execute(sql`SELECT 1 FROM goods_receipts WHERE id = ${receiptId} FOR UPDATE`);
      return posting.revalue(tx, actor, {
        docId: receiptId,
        version: 1,
        lines: [
          {
            docLineId: lineId,
            warehouseId,
            productId: juice.id,
            qtyBase: new Decimal(100),
            amount: new Decimal(15000),
            freeGoods: false,
          },
        ],
      });
    });
    const [valuation] = await Promise.all([costing, postAdjustment(issueId ?? 0, juice, -95)]);
    if (!valuation?.[0]) throw new Error('no valuation');
    const result = valuation[0];
    expect(result.valueBefore.toFixed()).toBe('10000');
    expect(result.absorbed.plus(result.variance).toFixed()).toBe('5000');
    const after = await balance(juice);
    // Either the issue went first (15 left absorb 750, avg 150) or the costing did (avg 145.4545).
    if (result.variance.isZero()) {
      expect(after?.avg_cost).toBe('145.4545');
    } else {
      expect(result.absorbed.toFixed()).toBe('750');
      expect(after?.avg_cost).toBe('150.0000');
    }
    expect(after?.on_hand).toBe('15.000');
  });

  it('finds a corrupted balance and rebuilds the caches from the ledger', async () => {
    const tea = item(1);
    await sqlApp.query(
      `UPDATE bin_stock SET on_hand = on_hand + 1 WHERE bin_id = $1 AND product_id = $2`,
      [shelves[1], tea.id],
    );
    await sqlApp.query(
      `UPDATE warehouse_stock SET sellable_on_hand = sellable_on_hand - 1 WHERE product_id = $1`,
      [tea.id],
    );
    const drift = await posting.reconcile('TEST');
    expect(drift.status).toBe('DRIFT');
    expect(drift.diffs.map((diff) => [diff.level, diff.ledger, diff.cache])).toEqual([
      ['BIN', '29.000', '30.000'],
      ['SELLABLE', '36.000', '35.000'],
    ]);
    const rebuilt = await posting.rebuildBalances();
    expect(rebuilt).toMatchObject({ binRows: 1, warehouseRows: 1, newWarehouseRows: 0 });
    const clean = await posting.reconcile('TEST');
    expect(clean).toMatchObject({ status: 'OK', diffCount: 0 });
    const { rows } = await sqlApp.query(
      `SELECT status, diff_count FROM reconciliation_runs ORDER BY id`,
    );
    expect(rows.slice(-2)).toEqual([
      { status: 'DRIFT', diff_count: 2 },
      { status: 'OK', diff_count: 0 },
    ]);
  });
});
