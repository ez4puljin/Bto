import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from 'pg';
import { MIGRATIONS_FOLDER } from '../../src/db/migrate';
import { connectAs } from '../harness/apps';

describe('database bootstrap (ADR-0024)', () => {
  let migrator: Client;

  beforeAll(async () => {
    migrator = await connectAs('migrator');
  });
  afterAll(async () => {
    await migrator.end();
  });

  it('applied every drizzle migration of the journal', async () => {
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: unknown[] };
    const { rows } = await migrator.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations',
    );
    expect(Number.parseInt(rows[0]?.count ?? '0', 10)).toBe(journal.entries.length);
  });

  it('created the extensions and the foundation functions', async () => {
    const extensions = await migrator.query<{ extname: string }>(
      `SELECT extname FROM pg_extension WHERE extname IN ('pg_trgm', 'btree_gist') ORDER BY 1`,
    );
    expect(extensions.rows.map((row) => row.extname)).toEqual(['btree_gist', 'pg_trgm']);
    const functions = await migrator.query<{ proname: string }>(
      `SELECT proname FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('assert_unicode_casefold', 'forbid_update_delete') ORDER BY 1`,
    );
    expect(functions.rows.map((row) => row.proname)).toEqual([
      'assert_unicode_casefold',
      'forbid_update_delete',
    ]);
    // The Finance Core's own copies (0032_fin_foundation, the balance check of 0033_fin_ledger), so
    // `pg_dump -n fin` is self-contained.
    const finFunctions = await migrator.query<{ proname: string }>(
      `SELECT proname FROM pg_proc WHERE pronamespace = 'fin'::regnamespace ORDER BY 1`,
    );
    expect(finFunctions.rows.map((row) => row.proname)).toEqual([
      'forbid_update_delete',
      'journal_entry_balanced',
    ]);
  });

  it('installed the pg-boss schema at the version of the installed package', async () => {
    const pgBossPackage = JSON.parse(
      readFileSync(require.resolve('pg-boss/package.json'), 'utf8'),
    ) as { pgboss: { schema: number } };
    const { rows } = await migrator.query<{ version: number }>(
      'SELECT version FROM pgboss.version',
    );
    expect(rows[0]?.version).toBe(pgBossPackage.pgboss.schema);
    const queues = await migrator.query<{ name: string }>('SELECT name FROM pgboss.queue');
    expect(queues.rows.map((row) => row.name)).toContain('system.ping');
  });
});
