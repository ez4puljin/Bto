import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

/**
 * The guard pattern every append-only table uses (stock_ledger from week 3, ADR-0007/ADR-0024):
 * REVOKE UPDATE, DELETE from app plus triggers executing forbid_update_delete().
 */
describe('integrity: append-only guard', () => {
  let app: Client;
  let migrator: Client;

  beforeAll(async () => {
    app = await connectAs('app');
    migrator = await connectAs('migrator');
    await migrator.query(
      'CREATE TABLE append_only_probe (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text NOT NULL)',
    );
    await migrator.query(`INSERT INTO append_only_probe (note) VALUES ('seed')`);
    await migrator.query('REVOKE UPDATE, DELETE ON append_only_probe FROM app');
    await migrator.query(
      `CREATE TRIGGER append_only_probe_no_update_delete BEFORE UPDATE OR DELETE ON append_only_probe
         FOR EACH ROW EXECUTE FUNCTION forbid_update_delete()`,
    );
    await migrator.query(
      `CREATE TRIGGER append_only_probe_no_truncate BEFORE TRUNCATE ON append_only_probe
         FOR EACH STATEMENT EXECUTE FUNCTION forbid_update_delete()`,
    );
  });
  afterAll(async () => {
    await migrator.query('DROP TABLE IF EXISTS append_only_probe');
    await app.end();
    await migrator.end();
  });

  it('app may insert and read', async () => {
    await app.query(`INSERT INTO append_only_probe (note) VALUES ('appended')`);
    const { rows } = await app.query<{ note: string }>(
      'SELECT note FROM append_only_probe ORDER BY id',
    );
    expect(rows.map((row) => row.note)).toEqual(['seed', 'appended']);
  });

  it('app may not update or delete (REVOKE: 42501)', async () => {
    expect(await sqlStateOf(app.query(`UPDATE append_only_probe SET note = 'x'`))).toBe('42501');
    expect(await sqlStateOf(app.query('DELETE FROM append_only_probe'))).toBe('42501');
  });

  it('even the migrator cannot update, delete or truncate (trigger: 23001)', async () => {
    expect(await sqlStateOf(migrator.query(`UPDATE append_only_probe SET note = 'x'`))).toBe(
      '23001',
    );
    expect(await sqlStateOf(migrator.query('DELETE FROM append_only_probe'))).toBe('23001');
    expect(await sqlStateOf(migrator.query('TRUNCATE append_only_probe'))).toBe('23001');
  });

  it('the triggers are registered', async () => {
    const { rows } = await migrator.query<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'append_only_probe'::regclass AND NOT tgisinternal ORDER BY 1`,
    );
    expect(rows.map((row) => row.tgname)).toEqual([
      'append_only_probe_no_truncate',
      'append_only_probe_no_update_delete',
    ]);
  });
});
