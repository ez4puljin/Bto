import type { Client } from 'pg';
import { connectAs, sqlStateOf } from '../harness/apps';

/** The runtime role has no DDL rights and cannot touch infrastructure schemas (ADR-0003, ADR-0024). */
describe('integrity: app role is DML-only', () => {
  let app: Client;

  beforeAll(async () => {
    app = await connectAs('app');
  });
  afterAll(async () => {
    await app.end();
  });

  it.each([
    ['CREATE TABLE', 'CREATE TABLE app_created (id int)'],
    ['CREATE SCHEMA', 'CREATE SCHEMA app_schema'],
    ['CREATE EXTENSION', 'CREATE EXTENSION hstore'],
    ['read drizzle migrations', 'SELECT * FROM drizzle.__drizzle_migrations'],
    ['TRUNCATE pg-boss jobs', 'TRUNCATE pgboss.job'],
    ['DROP a pg-boss table', 'DROP TABLE pgboss.version'],
  ])('%s is refused with 42501', async (_name, statement) => {
    expect(await sqlStateOf(app.query(statement))).toBe('42501');
  });
});
