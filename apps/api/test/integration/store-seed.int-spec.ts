import { Client, escapeIdentifier } from 'pg';
import { grantDatabase, withDatabase } from '../../src/db/provisioning';
import { STORE_SEED_TABLES } from '../../src/db/store-seed/manifest';
import { planStoreSeed, runStoreSeed, seededFileKeys } from '../../src/db/store-seed/seed';
import { loadTestEnv, testDatabaseName } from '../harness/test-env';

/**
 * The store seed (ADR-0186 #5) on real databases: a source that was migrated and then used (master
 * rows, changed reference rows, documents) and targets that were migrated and never started. The
 * databases are clones of the migrated test template, made and dropped here.
 */
describe('store seed', () => {
  const env = loadTestEnv();
  const worker = process.env.JEST_WORKER_ID ?? '1';
  const template = testDatabaseName(env, 'integration', 'tpl');
  const names = {
    source: `${env.prefix}_integration_seed_src_w${worker}`,
    target: `${env.prefix}_integration_seed_tgt_w${worker}`,
    used: `${env.prefix}_integration_seed_used_w${worker}`,
  };
  let admin: Client;
  let source: Client;
  let target: Client;
  let used: Client;

  const open = async (database: string): Promise<Client> => {
    const client = new Client({ connectionString: withDatabase(env.migratorUrl, database) });
    await client.connect();
    return client;
  };
  const count = async (client: Client, table: string): Promise<number> => {
    const { rows } = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
    return rows[0]?.n ?? -1;
  };

  beforeAll(async () => {
    admin = new Client({ connectionString: env.adminUrl });
    await admin.connect();
    for (const name of Object.values(names)) {
      await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(name)} WITH (FORCE)`);
      await admin.query(
        `CREATE DATABASE ${escapeIdentifier(name)} TEMPLATE ${escapeIdentifier(template)}`,
      );
      await grantDatabase(admin, name);
    }
    source = await open(names.source);
    target = await open(names.target);
    used = await open(names.used);

    // --- master data of the source
    await source.query('BEGIN');
    await source.query(
      `INSERT INTO users (username, full_name, password_hash) VALUES ('seed.owner', 'Эзэн', '$argon2id$not-a-real-hash')`,
    );
    await source.query(`INSERT INTO uoms (name, name_key) VALUES ('ширхэг', 'ширхэг')`);
    await source.query(
      `INSERT INTO categories (name, name_key) VALUES ('Ундаа', 'ундаа'), ('Ус', 'ус')`,
    );
    // A parent written after its child: a row may point at a later row of its own table.
    await source.query(
      `UPDATE categories SET parent_id = (SELECT id FROM categories WHERE name_key = 'ус')
       WHERE name_key = 'ундаа'`,
    );
    await source.query(
      `INSERT INTO products (sku, name, search_text, search_phonetic, search_version, category_id)
       SELECT '900001', 'Ус 0.5л', 'ус 0.5л', 'us', 1, id FROM categories WHERE name_key = 'ус'`,
    );
    await source.query(
      `INSERT INTO product_units (product_id, uom_id, factor_to_base, is_base)
       SELECT p.id, u.id, 1, true FROM products p, uoms u WHERE p.sku = '900001'`,
    );
    await source.query(
      `INSERT INTO files (key, kind, content_type, size_bytes, status, sha256, uploaded_at) VALUES
         ('11111111-1111-4111-8111-111111111111.jpg', 'hr.employee_photo', 'image/jpeg', 10, 'READY', repeat('a', 64), now()),
         ('22222222-2222-4222-8222-222222222222.xlsx', 'imports.source', 'application/vnd.ms-excel', 10, 'READY', repeat('b', 64), now())`,
    );
    await source.query(
      `INSERT INTO hr_employees (user_id, photo_file_id)
       SELECT u.id, f.id FROM users u, files f WHERE u.username = 'seed.owner' AND f.kind = 'hr.employee_photo'`,
    );
    // Two tables that point at each other: the pipeline's loaded stage is written in a second step.
    await source.query(`INSERT INTO sales_boards (name, position) VALUES ('Борлуулалт', 1)`);
    await source.query(
      `INSERT INTO sales_pipelines (board_id, name, position) SELECT id, 'Захиалга', 1 FROM sales_boards`,
    );
    await source.query(
      `INSERT INTO sales_stages (name, position, pipeline_id) SELECT 'Ачигдсан', 1, id FROM sales_pipelines`,
    );
    await source.query(
      `UPDATE sales_pipelines SET loaded_stage_id = (SELECT id FROM sales_stages)`,
    );
    // An edge server keeps its row, never its token.
    await source.query(
      `INSERT INTO pos_edge_nodes (code, name, token_hash, token_prefix, backlog)
       VALUES ('MRN1', 'Дэлгүүр', 'secret-token-hash', 'tgs_1', 13)`,
    );
    // Reference rows the migrations wrote, as the accountant left them: one renamed, one moved to
    // another id, a posting rule appended.
    await source.query(`UPDATE fin.accounts SET name = 'Касс (өөрчилсөн)' WHERE id = 1`);
    const moved = await source.query<{ name: string; name_key: string; code: string | null }>(
      'DELETE FROM issue_expense_types WHERE id = 7 RETURNING name, name_key, code',
    );
    await source.query(
      'INSERT INTO issue_expense_types (name, name_key, code) VALUES ($1, $2, $3)',
      [moved.rows[0]?.name, moved.rows[0]?.name_key, moved.rows[0]?.code],
    );
    await source.query(
      `INSERT INTO fin.posting_rules (company_id, posting_key, account_id, effective_from)
       SELECT company_id, 'CASH', (SELECT id FROM fin.accounts WHERE id = 2), DATE '2026-11-05'
       FROM fin.posting_rules WHERE posting_key = 'CASH' LIMIT 1`,
    );

    // --- documents, history and state of the source: none of it may travel
    await source.query(
      `INSERT INTO purchase_orders (number, order_date) VALUES ('PO-TEST-1', DATE '2026-11-01')`,
    );
    await source.query(
      `INSERT INTO audit_log (actor_kind, action, entity, entity_id) VALUES ('SYSTEM', 'TEST', 'users', '1')`,
    );
    await source.query(
      `INSERT INTO number_sequences (scope_key, period, last_value) VALUES ('PO', '2026', 41)`,
    );
    await source.query(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at)
       SELECT id, 'session-hash', now() + interval '1 day' FROM users WHERE username = 'seed.owner'`,
    );
    await source.query('COMMIT');

    // --- a database somebody has worked in
    await used.query(
      `INSERT INTO purchase_orders (number, order_date) VALUES ('PO-LIVE-1', DATE '2026-11-02')`,
    );
  }, 180_000);

  afterAll(async () => {
    await Promise.all([source?.end(), target?.end(), used?.end()]);
    for (const name of Object.values(names)) {
      await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(name)} WITH (FORCE)`);
    }
    await admin.end();
  });

  it('a dry run names every table and writes nothing', async () => {
    const { plan, copied } = await runStoreSeed(source, target, { dryRun: true });
    expect(plan.problems).toEqual([]);
    expect(copied).toEqual([]);
    expect(await count(target, 'users')).toBe(0);
    const classOf = (key: string) => plan.tables.find((table) => table.key === key)?.class;
    expect(classOf('public.products')).toBe('copy');
    expect(classOf('public.stock_ledger')).toBe('empty');
    expect(classOf('fin.journal_lines')).toBe('empty');
    expect(classOf('public.customer_users')).toBe('undecided');
    // The files of copied records only.
    expect(plan.tables.find((table) => table.key === 'public.files')).toMatchObject({
      sourceRows: 2,
      copyRows: 1,
    });
    // Every table the manifest names exists: a renamed table would otherwise drop out silently.
    expect(plan.warnings).toEqual([]);
    expect(Object.keys(STORE_SEED_TABLES).length).toBeGreaterThan(200);
  });

  it('copies the master data and leaves every document behind', async () => {
    const { plan, copied } = await runStoreSeed(source, target, { dryRun: false });
    expect(plan.problems).toEqual([]);
    expect(copied.length).toBe(plan.order.length);

    // Master rows arrive as they were, the password hash included.
    const user = await target.query<{ id: string; password_hash: string }>(
      `SELECT id, password_hash FROM users WHERE username = 'seed.owner'`,
    );
    const sourceUser = await source.query<{ id: string }>(
      `SELECT id FROM users WHERE username = 'seed.owner'`,
    );
    expect(user.rows).toEqual([
      { id: sourceUser.rows[0]?.id, password_hash: '$argon2id$not-a-real-hash' },
    ]);
    expect(await count(target, 'products')).toBe(1);
    expect(await count(target, 'product_units')).toBe(1);
    const parent = await target.query<{ child: string; parent: string }>(
      `SELECT c.name_key AS child, p.name_key AS parent FROM categories c JOIN categories p ON p.id = c.parent_id`,
    );
    expect(parent.rows).toEqual([{ child: 'ундаа', parent: 'ус' }]);
    const files = await target.query<{ kind: string }>('SELECT kind FROM files');
    expect(files.rows).toEqual([{ kind: 'hr.employee_photo' }]);
    expect(await seededFileKeys(source)).toEqual(['11111111-1111-4111-8111-111111111111.jpg']);
    const loaded = await target.query<{ stage: string }>(
      `SELECT s.name AS stage FROM sales_pipelines p JOIN sales_stages s ON s.id = p.loaded_stage_id`,
    );
    expect(loaded.rows).toEqual([{ stage: 'Ачигдсан' }]);
    const node = await target.query(
      'SELECT code, token_hash, token_prefix, backlog FROM pos_edge_nodes',
    );
    expect(node.rows).toEqual([{ code: 'MRN1', token_hash: null, token_prefix: null, backlog: 0 }]);

    // Reference rows of the migrations become the source's.
    const account = await target.query<{ name: string }>(
      'SELECT name FROM fin.accounts WHERE id = 1',
    );
    expect(account.rows[0]?.name).toBe('Касс (өөрчилсөн)');
    const types = await target.query<{ ids: string }>(
      `SELECT string_agg(id::text, ',' ORDER BY id) AS ids FROM issue_expense_types`,
    );
    const sourceTypes = await source.query<{ ids: string }>(
      `SELECT string_agg(id::text, ',' ORDER BY id) AS ids FROM issue_expense_types`,
    );
    expect(types.rows[0]?.ids).toBe(sourceTypes.rows[0]?.ids);
    const rule = await target.query<{ account_id: string }>(
      `SELECT account_id FROM fin.posting_rules WHERE posting_key = 'CASH'
       ORDER BY effective_from DESC, id DESC LIMIT 1`,
    );
    expect(rule.rows[0]?.account_id).toBe('2');
    expect(await count(target, 'fin.posting_rules')).toBe(await count(source, 'fin.posting_rules'));

    // Nothing that happened travels.
    for (const table of ['purchase_orders', 'audit_log', 'number_sequences', 'auth_sessions']) {
      expect(await count(source, table)).toBeGreaterThan(0);
      expect(await count(target, table)).toBe(0);
    }
    for (const table of ['stock_ledger', 'fin.documents', 'fin.journal_entries', 'pos_sales']) {
      expect(await count(target, table)).toBe(0);
    }

    // The next record takes the next id.
    const next = await target.query<{ id: string }>(
      `INSERT INTO users (username, full_name) VALUES ('seed.next', 'Дараагийн') RETURNING id`,
    );
    expect(BigInt(next.rows[0]?.id ?? '0')).toBeGreaterThan(BigInt(sourceUser.rows[0]?.id ?? '0'));
    await target.query(`DELETE FROM users WHERE username = 'seed.next'`);

    // The guards are as the migrations made them: every trigger enabled, the append-only ones biting.
    const disabled = await target.query(
      `SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled <> 'O'`,
    );
    expect(disabled.rowCount).toBe(0);
    await expect(
      target.query(`UPDATE fin.posting_rules SET effective_from = DATE '2030-01-01'`),
    ).rejects.toThrow();
  });

  it('refuses a target that is not empty, and writes nothing into it', async () => {
    const again = await runStoreSeed(source, target, { dryRun: false });
    expect(again.copied).toEqual([]);
    expect(again.plan.problems.some((problem) => problem.includes('not empty'))).toBe(true);

    const before = await count(used, 'users');
    const worked = await runStoreSeed(source, used, { dryRun: false });
    expect(worked.copied).toEqual([]);
    expect(worked.plan.problems).toEqual([
      expect.stringContaining('the target is not empty: public.purchase_orders holds 1 rows'),
    ]);
    expect(await count(used, 'users')).toBe(before);
    expect(await count(used, 'products')).toBe(0);
  });

  it('leaves a table nobody listed empty and says so', async () => {
    await source.query('CREATE TABLE public.zz_seed_unlisted (id int PRIMARY KEY)');
    await source.query('INSERT INTO public.zz_seed_unlisted VALUES (1)');
    await used.query('CREATE TABLE public.zz_seed_unlisted (id int PRIMARY KEY)');
    await source.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const plan = await planStoreSeed(source, used);
      expect(plan.tables.find((table) => table.key === 'public.zz_seed_unlisted')).toMatchObject({
        class: 'undecided',
        sourceRows: 1,
        copyRows: 0,
      });
    } finally {
      await source.query('ROLLBACK');
    }
  });
});
