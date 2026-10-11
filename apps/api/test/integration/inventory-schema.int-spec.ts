import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const RESTRICT = '23001';

/** Database-level rules of migrations 0005_inventory and 0006_inventory_ledger (ADR-0016, ADR-0034). */
describe('inventory schema constraints', () => {
  let app: Client;
  let wh1: string;
  let wh2: string;
  let product: string;
  let unit: string;
  let docLine = 0;

  const one = async (sql: string, params: unknown[] = []) => {
    const { rows } = await app.query<{ id: string }>(sql, params);
    const id = rows[0]?.id;
    if (!id) throw new Error(`no row from ${sql}`);
    return id;
  };
  const insert = (table: string, values: Record<string, unknown>) => {
    const names = Object.keys(values);
    return one(
      `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      Object.values(values),
    );
  };
  const bin = (warehouseId: string, code: string, type = 'STORAGE', isSystem = false) =>
    insert('bins', { warehouse_id: warehouseId, code, type, is_system: isSystem });
  /** A ledger row; `columns` overrides the values of a valid RECEIPT. */
  const ledger = (binId: string, columns: Record<string, unknown> = {}) => {
    docLine += 1;
    return insert('stock_ledger', {
      posted_at: '2026-10-11T03:00:00Z',
      effective_date: '2026-10-11',
      warehouse_id: wh1,
      bin_id: binId,
      product_id: product,
      qty_base: '24',
      unit_cost: '0',
      movement_type: 'RECEIPT',
      doc_type: 'GR',
      doc_id: 1,
      doc_line_id: docLine,
      leg: 1,
      entered_qty: '1',
      product_unit_id: unit,
      factor_snapshot: '24',
      ...columns,
    });
  };

  beforeAll(async () => {
    app = await connectAs('app');
    const branch = await insert('branches', { code: 'HQ', name: 'Төв' });
    wh1 = await insert('warehouses', {
      code: 'WH1',
      name: 'Бөөний 1',
      kind: 'WHOLESALE',
      branch_id: branch,
    });
    wh2 = await insert('warehouses', {
      code: 'WH2',
      name: 'Бөөний 2',
      kind: 'WHOLESALE',
      branch_id: branch,
    });
    const pcs = await insert('uoms', { code: 'PCS', name: 'ш', name_key: 'ш' });
    const box = await insert('uoms', { code: 'BOX', name: 'хайрцаг', name_key: 'хайрцаг' });
    const category = await insert('categories', { name: 'Ундаа', name_key: 'ундаа' });
    await app.query('BEGIN');
    product = await insert('products', {
      sku: '1',
      name: 'Кока кола',
      search_text: ' кока кола',
      search_phonetic: ' koka kola',
      search_version: 1,
      category_id: category,
    });
    await insert('product_units', {
      product_id: product,
      uom_id: pcs,
      factor_to_base: 1,
      is_base: true,
    });
    unit = await insert('product_units', { product_id: product, uom_id: box, factor_to_base: 24 });
    await app.query('COMMIT');
  });
  afterAll(async () => {
    await app.end();
  });

  it('keeps bin codes scannable, system bins unique per type and their identity fixed', async () => {
    const shelf = await bin(wh1, 'A-01-03');
    expect(await sqlStateOf(bin(wh1, 'A-01-03'))).toBe(UNIQUE);
    // The same label may exist in another warehouse.
    await bin(wh2, 'A-01-03');
    expect(await sqlStateOf(bin(wh1, 'a-01-04'))).toBe(CHECK);
    expect(await sqlStateOf(bin(wh1, '-A'))).toBe(CHECK);
    // Shelves are user bins; every other type is a system bin, once per warehouse.
    expect(await sqlStateOf(bin(wh1, 'X1', 'RECEIVING', false))).toBe(CHECK);
    expect(await sqlStateOf(bin(wh1, 'X2', 'STORAGE', true))).toBe(CHECK);
    await bin(wh1, 'RECEIVING', 'RECEIVING', true);
    expect(await sqlStateOf(bin(wh1, 'RECEIVING-2', 'RECEIVING', true))).toBe(UNIQUE);

    const { rows } = await app.query<{ code: string; sellable: boolean }>(
      `SELECT code, sellable FROM bins WHERE warehouse_id = $1 ORDER BY code`,
      [wh1],
    );
    expect(rows).toEqual([
      { code: 'A-01-03', sellable: true },
      { code: 'RECEIVING', sellable: false },
    ]);
    expect(
      await sqlStateOf(app.query(`UPDATE bins SET code = 'A-01-09' WHERE id = $1`, [shelf])),
    ).toBe(RESTRICT);
    expect(
      await sqlStateOf(app.query(`UPDATE bins SET type = 'PICKING' WHERE id = $1`, [shelf])),
    ).toBe(RESTRICT);
    await app.query(`UPDATE bins SET name = 'Ундааны тавиур', pick_sequence = 3 WHERE id = $1`, [
      shelf,
    ]);
    // COUNTING always names its stocktake.
    expect(
      await sqlStateOf(app.query(`UPDATE bins SET status = 'COUNTING' WHERE id = $1`, [shelf])),
    ).toBe(CHECK);
  });

  it('gives a product one home warehouse and a fixed bin of that warehouse only', async () => {
    const otherShelf = await bin(wh2, 'B-01-01');
    await insert('product_locations', { warehouse_id: wh1, product_id: product, is_home: true });
    expect(
      await sqlStateOf(
        insert('product_locations', { warehouse_id: wh2, product_id: product, is_home: true }),
      ),
    ).toBe(UNIQUE);
    expect(
      await sqlStateOf(
        app.query(`UPDATE product_locations SET default_bin_id = $1 WHERE warehouse_id = $2`, [
          otherShelf,
          wh1,
        ]),
      ),
    ).toBe(FOREIGN_KEY);
    expect(
      await sqlStateOf(
        app.query(
          `UPDATE product_locations SET min_qty = 10, max_qty = 5 WHERE warehouse_id = $1`,
          [wh1],
        ),
      ),
    ).toBe(CHECK);
  });

  it('keeps one balance row per key with a NULL lot and never lets a balance go negative', async () => {
    const shelf = await bin(wh1, 'C-01-01');
    for (let i = 0; i < 2; i += 1) {
      await app.query(
        `INSERT INTO warehouse_stock (warehouse_id, product_id) VALUES ($1, $2)
         ON CONFLICT ON CONSTRAINT warehouse_stock_key DO NOTHING`,
        [wh1, product],
      );
      await app.query(
        `INSERT INTO bin_stock (warehouse_id, bin_id, product_id) VALUES ($1, $2, $3)
         ON CONFLICT ON CONSTRAINT bin_stock_key DO NOTHING`,
        [wh1, shelf, product],
      );
    }
    const { rows } = await app.query<{ count: string }>(
      `SELECT (SELECT count(*) FROM warehouse_stock) + (SELECT count(*) FROM bin_stock) AS count`,
    );
    expect(rows[0]?.count).toBe('2');
    expect(
      await sqlStateOf(app.query(`UPDATE bin_stock SET on_hand = -1 WHERE bin_id = $1`, [shelf])),
    ).toBe(CHECK);
    expect(
      await sqlStateOf(
        app.query(
          `UPDATE warehouse_stock SET on_hand = 5, sellable_on_hand = 6 WHERE warehouse_id = $1`,
          [wh1],
        ),
      ),
    ).toBe(CHECK);
    // A shortage may leave more reserved than sellable (D2).
    await app.query(
      `UPDATE warehouse_stock SET on_hand = 5, sellable_on_hand = 2, reserved = 4 WHERE warehouse_id = $1`,
      [wh1],
    );
    // A bin of another warehouse cannot hold this warehouse's stock.
    const foreign = await bin(wh2, 'C-09-09');
    expect(
      await sqlStateOf(
        app.query(`INSERT INTO bin_stock (warehouse_id, bin_id, product_id) VALUES ($1, $2, $3)`, [
          wh1,
          foreign,
          product,
        ]),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('accepts only consistent ledger rows, once per document line, movement and leg', async () => {
    const shelf = await bin(wh1, 'D-01-01');
    await ledger(shelf);
    expect(await sqlStateOf(ledger(shelf, { qty_base: '-24' }))).toBe(CHECK);
    expect(await sqlStateOf(ledger(shelf, { leg: 2 }))).toBe(CHECK);
    expect(await sqlStateOf(ledger(shelf, { qty_base: '23' }))).toBe(CHECK);
    expect(await sqlStateOf(ledger(shelf, { movement_type: 'GIFT' }))).toBe(CHECK);
    expect(await sqlStateOf(ledger(shelf, { doc_type: 'XX' }))).toBe(CHECK);
    expect(
      await sqlStateOf(ledger(shelf, { movement_type: 'TRANSFER_IN', qty_base: '24', leg: 4 })),
    ).toBeUndefined();
    expect(
      await sqlStateOf(ledger(shelf, { movement_type: 'ADJUSTMENT', qty_base: '-24' })),
    ).toBeUndefined();
    const foreign = await bin(wh2, 'D-09-09');
    expect(await sqlStateOf(ledger(foreign))).toBe(FOREIGN_KEY);
    await app.query(
      `INSERT INTO stock_ledger (posted_at, effective_date, warehouse_id, bin_id, product_id, qty_base, unit_cost,
         movement_type, doc_type, doc_id, doc_line_id, leg, entered_qty, product_unit_id, factor_snapshot)
       VALUES (now(), '2026-10-11', $1, $2, $3, 24, 0, 'RECEIPT', 'GR', 9, 9001, 1, 1, $4, 24)`,
      [wh1, shelf, product, unit],
    );
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO stock_ledger (posted_at, effective_date, warehouse_id, bin_id, product_id, qty_base, unit_cost,
             movement_type, doc_type, doc_id, doc_line_id, leg, entered_qty, product_unit_id, factor_snapshot)
           VALUES (now(), '2026-10-11', $1, $2, $3, 24, 0, 'RECEIPT', 'GR', 9, 9001, 1, 1, $4, 24)`,
          [wh1, shelf, product, unit],
        ),
      ),
    ).toBe(UNIQUE);
  });

  it('keeps the costing history arithmetic consistent', async () => {
    const version = (columns: Record<string, unknown>) =>
      insert('stock_valuation_adjustments', {
        posted_at: '2026-10-11T03:00:00Z',
        effective_date: '2026-10-11',
        warehouse_id: wh1,
        product_id: product,
        doc_type: 'GR',
        doc_id: 1,
        doc_line_id: 1,
        version: 1,
        qty_base: '100',
        free_goods: false,
        amount: '150000',
        value_before: '100000',
        value_delta: '50000',
        on_hand_at: '15',
        absorbed: '7500',
        variance: '42500',
        avg_before: '1000',
        avg_after: '1500',
        ...columns,
      });
    await version({});
    expect(await sqlStateOf(version({ version: 1 }))).toBe(UNIQUE);
    expect(await sqlStateOf(version({ version: 2, variance: '42000' }))).toBe(CHECK);
    expect(await sqlStateOf(version({ version: 2, free_goods: true }))).toBe(CHECK);
  });

  it('partitions the snapshots by month, at least three months ahead', async () => {
    const { rows } = await app.query<{ parent: string; partitions: string }>(
      `SELECT p.relname AS parent, count(i.inhrelid)::text AS partitions
         FROM pg_partitioned_table pt
         JOIN pg_class p ON p.oid = pt.partrelid
         LEFT JOIN pg_inherits i ON i.inhparent = p.oid
        WHERE p.relname IN ('stock_snapshot_daily', 'stock_snapshot_bin_monthly')
        GROUP BY p.relname ORDER BY p.relname`,
    );
    expect(rows).toEqual([
      { parent: 'stock_snapshot_bin_monthly', partitions: '24' },
      { parent: 'stock_snapshot_daily', partitions: '24' },
    ]);
    const ahead = await app.query<{ ok: boolean }>(
      `SELECT to_regclass('stock_snapshot_daily_p' || to_char(now() + interval '3 months', 'YYYY_MM')) IS NOT NULL AS ok`,
    );
    expect(ahead.rows[0]?.ok).toBe(true);
    await app.query(
      `INSERT INTO stock_snapshot_daily (snapshot_date, warehouse_id, product_id, on_hand, sellable_on_hand, reserved, avg_cost)
       VALUES ('2026-10-11', $1, $2, 1, 1, 0, 1000)`,
      [wh1, product],
    );
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO stock_snapshot_daily (snapshot_date, warehouse_id, product_id, on_hand, sellable_on_hand, reserved, avg_cost)
           VALUES ('2026-10-11', $1, $2, 1, 1, 0, 1000)`,
          [wh1, product],
        ),
      ),
    ).toBe(UNIQUE);
  });
});
