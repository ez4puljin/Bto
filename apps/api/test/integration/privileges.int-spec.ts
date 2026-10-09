import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

describe('role privileges (ADR-0003, ADR-0024)', () => {
  let app: Client;
  let migrator: Client;

  beforeAll(async () => {
    app = await connectAs('app');
    migrator = await connectAs('migrator');
  });
  afterAll(async () => {
    await migrator.query('DROP TABLE IF EXISTS privileges_probe');
    await app.end();
    await migrator.end();
  });

  it('app cannot create tables', async () => {
    expect(await sqlStateOf(app.query('CREATE TABLE app_owned (id int)'))).toBe('42501');
  });

  it('app gets DML on tables migrator creates (default privileges)', async () => {
    await migrator.query(
      'CREATE TABLE privileges_probe (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, note text)',
    );
    await app.query(`INSERT INTO privileges_probe (note) VALUES ('a')`);
    await app.query(`UPDATE privileges_probe SET note = 'b'`);
    const { rows } = await app.query<{ note: string }>('SELECT note FROM privileges_probe');
    expect(rows).toEqual([{ note: 'b' }]);
    await app.query('DELETE FROM privileges_probe');
    expect(await sqlStateOf(app.query('DROP TABLE privileges_probe'))).toBe('42501');
  });
});
