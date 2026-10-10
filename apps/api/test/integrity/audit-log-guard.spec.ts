import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

/** audit_log is append-only for every role (0001_identity, ADR-0002 #5, ADR-0016). */
describe('integrity: audit_log is append-only', () => {
  let app: Client;
  let migrator: Client;

  beforeAll(async () => {
    app = await connectAs('app');
    migrator = await connectAs('migrator');
    await app.query(
      `INSERT INTO audit_log (actor_kind, actor_label, action, entity, entity_id)
       VALUES ('SYSTEM', 'integrity', 'CREATE', 'probe', '1')`,
    );
  });
  afterAll(async () => {
    await app.end();
    await migrator.end();
  });

  it('app may insert and read', async () => {
    const { rows } = await app.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_log WHERE entity = 'probe'`,
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('app may not update, delete or truncate (REVOKE: 42501)', async () => {
    expect(await sqlStateOf(app.query(`UPDATE audit_log SET action = 'X'`))).toBe('42501');
    expect(await sqlStateOf(app.query('DELETE FROM audit_log'))).toBe('42501');
    expect(await sqlStateOf(app.query('TRUNCATE audit_log'))).toBe('42501');
  });

  it('even the migrator cannot update, delete or truncate (trigger: 23001)', async () => {
    expect(await sqlStateOf(migrator.query(`UPDATE audit_log SET action = 'X'`))).toBe('23001');
    expect(await sqlStateOf(migrator.query('DELETE FROM audit_log'))).toBe('23001');
    expect(await sqlStateOf(migrator.query('TRUNCATE audit_log'))).toBe('23001');
  });

  it('the guard triggers are registered', async () => {
    const { rows } = await migrator.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal ORDER BY 1`,
    );
    expect(rows.map((row) => row.tgname)).toEqual([
      'audit_log_no_truncate',
      'audit_log_no_update_delete',
    ]);
  });
});
