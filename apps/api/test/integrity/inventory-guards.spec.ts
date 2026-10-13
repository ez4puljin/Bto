import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

const DENIED = '42501';
const RESTRICT = '23001';

/**
 * The ledger guards exist (ADR-0007, ADR-0016, ADR-0034): the app role can only insert into the
 * ledger and the costing history, the append-only triggers stop even the migrator, and documents and
 * balances can never be deleted. If a REVOKE or a trigger is ever lost, this suite fails.
 */
describe('integrity: inventory guards', () => {
  let app: Client;
  let migrator: Client;

  beforeAll(async () => {
    app = await connectAs('app');
    migrator = await connectAs('migrator');
    // One row in each append-only table, so the row triggers have something to refuse.
    await app.query(`
      WITH branch AS (INSERT INTO branches (code, name) VALUES ('HQ', 'Төв') RETURNING id),
           warehouse AS (INSERT INTO warehouses (code, name, kind, branch_id)
                         SELECT 'WH1', 'Бөөний', 'WHOLESALE', id FROM branch RETURNING id),
           bin AS (INSERT INTO bins (warehouse_id, code, type) SELECT id, 'A-01-01', 'STORAGE' FROM warehouse
                   RETURNING id, warehouse_id),
           uom AS (INSERT INTO uoms (code, name, name_key) VALUES ('PCS', 'ш', 'ш') RETURNING id),
           category AS (INSERT INTO categories (name, name_key) VALUES ('Хүнс', 'хүнс') RETURNING id),
           product AS (INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id)
                       SELECT '1', 'Гурил', ' гурил', ' guril', 1, id FROM category RETURNING id),
           unit AS (INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base)
                    SELECT product.id, uom.id, 1, true FROM product, uom RETURNING id, product_id),
           ledger AS (INSERT INTO stock_ledger (posted_at, effective_date, warehouse_id, bin_id, product_id, qty_base,
                        unit_cost, movement_type, doc_type, doc_id, doc_line_id, leg, entered_qty, product_unit_id,
                        factor_snapshot)
                      SELECT now(), '2026-10-11', bin.warehouse_id, bin.id, unit.product_id, 5, 0, 'RECEIPT', 'GR',
                             1, 1, 1, 5, unit.id, 1
                        FROM bin, unit RETURNING warehouse_id, product_id)
      INSERT INTO stock_valuation_adjustments (posted_at, effective_date, warehouse_id, product_id, doc_type, doc_id,
        doc_line_id, version, qty_base, free_goods, amount, value_before, value_delta, on_hand_at, absorbed, variance,
        avg_before, avg_after)
      SELECT now(), '2026-10-11', warehouse_id, product_id, 'GR', 1, 1, 1, 5, false, 500, 0, 500, 5, 500, 0, 0, 100
        FROM ledger`);
  });
  afterAll(async () => {
    await app.end();
    await migrator.end();
  });

  it('has the append-only and bin triggers', async () => {
    const { rows } = await app.query<{ name: string }>(
      `SELECT t.tgname AS name
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        WHERE c.relname IN ('stock_ledger', 'stock_valuation_adjustments', 'bins') AND NOT t.tgisinternal
        ORDER BY t.tgname`,
    );
    expect(rows.map((row) => row.name)).toEqual([
      'bins_fixed',
      'stock_ledger_no_truncate',
      'stock_ledger_no_update_delete',
      'stock_valuation_adjustments_no_truncate',
      'stock_valuation_adjustments_no_update_delete',
    ]);
  });

  it('lets the app role only append to the ledger and the costing history', async () => {
    for (const table of ['stock_ledger', 'stock_valuation_adjustments']) {
      expect(await sqlStateOf(app.query(`UPDATE ${table} SET doc_id = doc_id`))).toBe(DENIED);
      expect(await sqlStateOf(app.query(`DELETE FROM ${table}`))).toBe(DENIED);
      expect(await sqlStateOf(app.query(`TRUNCATE ${table}`))).toBe(DENIED);
      // The migrator owns the tables, so only the triggers stop it.
      expect(await sqlStateOf(migrator.query(`UPDATE ${table} SET doc_id = doc_id`))).toBe(
        RESTRICT,
      );
      expect(await sqlStateOf(migrator.query(`DELETE FROM ${table}`))).toBe(RESTRICT);
      expect(await sqlStateOf(migrator.query(`TRUNCATE ${table}`))).toBe(RESTRICT);
    }
  });

  it('never lets the app role delete documents, balances or snapshots', async () => {
    const tables = [
      'goods_receipts',
      'bin_moves',
      'bin_move_lines',
      'adjustments',
      'stocktakes',
      'warehouse_stock',
      'bin_stock',
      'stock_reservations',
      'reconciliation_runs',
      'lots',
      'stock_snapshot_daily',
      'stock_snapshot_bin_monthly',
    ];
    const { rows } = await app.query<{ table: string; can_delete: boolean; can_insert: boolean }>(
      `SELECT t AS table, has_table_privilege(t, 'DELETE') AS can_delete,
              has_table_privilege(t, 'INSERT') AS can_insert
         FROM unnest($1::text[]) AS t`,
      [tables],
    );
    expect(rows.filter((row) => row.can_delete).map((row) => row.table)).toEqual([]);
    expect(rows.every((row) => row.can_insert)).toBe(true);
    // Draft lines, unused bins and product locations may be deleted by the services.
    const deletable = await app.query<{ ok: boolean }>(
      `SELECT bool_and(has_table_privilege(t, 'DELETE')) AS ok
         FROM unnest(ARRAY['goods_receipt_lines', 'adjustment_lines', 'stocktake_lines', 'stocktake_bins',
                           'bins', 'product_locations']) AS t`,
    );
    expect(deletable.rows[0]?.ok).toBe(true);
  });

  it('keeps app out of every snapshot partition, those of the monthly maintenance too', async () => {
    await app.query('SELECT maintain_stock_snapshot_partitions()');
    const { rows } = await app.query<{ name: string; can_delete: boolean; can_truncate: boolean }>(
      `SELECT c.relname AS name, has_table_privilege(c.oid, 'DELETE') AS can_delete,
              has_table_privilege(c.oid, 'TRUNCATE') AS can_truncate
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent IN ('stock_snapshot_daily'::regclass, 'stock_snapshot_bin_monthly'::regclass)`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(50);
    expect(rows.filter((row) => row.can_delete || row.can_truncate)).toEqual([]);
    expect(
      await sqlStateOf(
        app.query(
          `CREATE TABLE stock_snapshot_daily_p2099_01 PARTITION OF stock_snapshot_daily
             FOR VALUES FROM ('2099-01-01') TO ('2099-02-01')`,
        ),
      ),
    ).toBe(DENIED);
  });

  it('runs the partition maintenance as the migrator, for app alone, on a fixed search path', async () => {
    const { rows } = await migrator.query<{
      owner: string;
      definer: boolean;
      config: string[] | null;
      acl: string[] | null;
    }>(
      `SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef AS definer, p.proconfig AS config,
              p.proacl::text[] AS acl
         FROM pg_proc p WHERE p.proname = 'maintain_stock_snapshot_partitions'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      owner: 'migrator',
      definer: true,
      config: ['search_path=pg_catalog, public, pg_temp'],
    });
    // No PUBLIC entry ("=X/…"): only app, besides the owner, may run it.
    const acl = rows[0]?.acl ?? [];
    expect(acl.filter((entry) => entry.startsWith('='))).toEqual([]);
    expect(acl.some((entry) => entry.startsWith('app=X/'))).toBe(true);
  });
});
