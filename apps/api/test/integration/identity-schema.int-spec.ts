import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

const CHECK = '23514';
const UNIQUE = '23505';

/** Database-level rules of migration 0001_identity, independent of the services (ADR-0016). */
describe('identity schema constraints', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connectAs('app');
  });
  afterAll(async () => {
    await app.end();
  });

  async function insertUser(username: string, extra = ''): Promise<number> {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO users (username, full_name${extra ? ', phone' : ''})
       VALUES ($1, 'Тест'${extra ? ', $2' : ''}) RETURNING id`,
      extra ? [username, extra] : [username],
    );
    return Number.parseInt(rows[0]?.id ?? '0', 10);
  }

  it('users: lowercase usernames, unique, E.164 phones', async () => {
    await insertUser('schema.user');
    expect(await sqlStateOf(insertUser('schema.user'))).toBe(UNIQUE);
    expect(await sqlStateOf(insertUser('Schema.Upper'))).toBe(CHECK);
    expect(await sqlStateOf(insertUser('ab'))).toBe(CHECK);
    expect(await sqlStateOf(insertUser('бат.эрдэнэ'))).toBe(CHECK);
    await insertUser('schema.phone', '+97699112233');
    expect(await sqlStateOf(insertUser('schema.phone2', '99112233'))).toBe(CHECK);
    expect(
      await sqlStateOf(
        app.query(`UPDATE users SET status = 'GONE' WHERE username = 'schema.user'`),
      ),
    ).toBe(CHECK);
  });

  it('roles: system roles carry a code, custom roles a unique name', async () => {
    await app.query(`INSERT INTO roles (code, is_system) VALUES ('SCHEMA_SYS', true)`);
    await app.query(`INSERT INTO roles (name) VALUES ('Шалгах дүр')`);
    expect(await sqlStateOf(app.query(`INSERT INTO roles (name) VALUES ('шалгах ДҮР')`))).toBe(
      UNIQUE,
    );
    expect(
      await sqlStateOf(app.query(`INSERT INTO roles (code, is_system) VALUES ('X', false)`)),
    ).toBe(CHECK);
    expect(
      await sqlStateOf(app.query(`INSERT INTO roles (name, is_system) VALUES ('Y', true)`)),
    ).toBe(CHECK);
    expect(await sqlStateOf(app.query(`INSERT INTO roles (name) VALUES ('  ')`))).toBe(CHECK);
  });

  it('warehouses: one TRANSIT without a branch, every other kind with one', async () => {
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO branches (code, name) VALUES ('SCHEMA', 'Салбар') RETURNING id`,
    );
    const branchId = rows[0]?.id;
    await app.query(
      `INSERT INTO warehouses (code, name, kind) VALUES ('SCHEMA-TR', 'Transit', 'TRANSIT')
       ON CONFLICT (kind) WHERE kind = 'TRANSIT' DO NOTHING`,
    );
    expect(
      await sqlStateOf(
        app.query(`INSERT INTO warehouses (code, name, kind) VALUES ('TR2', 'Transit', 'TRANSIT')`),
      ),
    ).toBe(UNIQUE);
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO warehouses (code, name, kind) VALUES ('WH', 'Агуулах', 'WHOLESALE')`,
        ),
      ),
    ).toBe(CHECK);
    await app.query(
      `INSERT INTO warehouses (code, name, kind, branch_id) VALUES ('SCHEMA-WH', 'Агуулах', 'WHOLESALE', $1)`,
      [branchId],
    );
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO warehouses (code, name, kind, branch_id) VALUES ('lower', 'Агуулах', 'STORE', $1)`,
          [branchId],
        ),
      ),
    ).toBe(CHECK);
    expect(
      await sqlStateOf(
        app.query(`INSERT INTO branches (code, name, branch_no) VALUES ('B2', 'Салбар', '12')`),
      ),
    ).toBe(CHECK);
  });

  it('user_scopes: exactly one target, no duplicates', async () => {
    const userId = await insertUser('schema.scope');
    const { rows } = await app.query<{ id: string }>(
      `SELECT id FROM branches WHERE code = 'SCHEMA'`,
    );
    const branchId = rows[0]?.id;
    await app.query(`INSERT INTO user_scopes (user_id, branch_id) VALUES ($1, $2)`, [
      userId,
      branchId,
    ]);
    expect(
      await sqlStateOf(
        app.query(`INSERT INTO user_scopes (user_id, branch_id) VALUES ($1, $2)`, [
          userId,
          branchId,
        ]),
      ),
    ).toBe(UNIQUE);
    expect(
      await sqlStateOf(app.query(`INSERT INTO user_scopes (user_id) VALUES ($1)`, [userId])),
    ).toBe(CHECK);
  });

  it('password_resets: one live code per user', async () => {
    const userId = await insertUser('schema.code');
    const insert = () =>
      app.query(
        `INSERT INTO password_resets (user_id, code_hash, expires_at) VALUES ($1, 'h', now() + interval '30 minutes')`,
        [userId],
      );
    await insert();
    expect(await sqlStateOf(insert())).toBe(UNIQUE);
    await app.query(`UPDATE password_resets SET revoked_at = now() WHERE user_id = $1`, [userId]);
    await insert();
  });

  it('settings, number_sequences, idempotency_keys and auth_sessions keep their invariants', async () => {
    await app.query(
      `INSERT INTO settings (key, value, effective_from) VALUES ('tax.vat_rate_pct', '"10"', '2026-01-01')`,
    );
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO settings (key, value, effective_from) VALUES ('tax.vat_rate_pct', '"9"', '2026-01-01')`,
        ),
      ),
    ).toBe(UNIQUE);
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO number_sequences (scope_key, period, last_value) VALUES ('X', '2026', -1)`,
        ),
      ),
    ).toBe(CHECK);
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO idempotency_keys (actor_kind, actor_id, key, method, path, request_hash, status)
           VALUES ('STAFF', 1, gen_random_uuid(), 'POST', '/x', 'h', 'COMPLETED')`,
        ),
      ),
    ).toBe(CHECK);
    const userId = await insertUser('schema.session');
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO auth_sessions (user_id, token_hash, expires_at, revoked_at)
           VALUES ($1, 'h', now() + interval '1 hour', now())`,
          [userId],
        ),
      ),
    ).toBe(CHECK);
    const { rows } = await app.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, 'h', now() + interval '1 hour')
       RETURNING id`,
      [userId],
    );
    // uuidv7: version nibble 7.
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
  });

  it('audit_log: system actors have no id, staff actors must have one', async () => {
    await app.query(
      `INSERT INTO audit_log (actor_kind, actor_label, action, entity, entity_id) VALUES ('SYSTEM', 'test', 'CREATE', 'x', '1')`,
    );
    expect(
      await sqlStateOf(
        app.query(
          `INSERT INTO audit_log (actor_kind, action, entity, entity_id) VALUES ('STAFF', 'CREATE', 'x', '1')`,
        ),
      ),
    ).toBe(CHECK);
  });
});
