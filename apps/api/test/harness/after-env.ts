import { Client } from 'pg';

jest.setTimeout(30_000);

/**
 * Every test file starts from empty business tables (Bto's and the Finance Core's schema `fin`) and
 * an empty job queue (ADR-0016 #2). The boot steps (identity, finance, fin-bridge) seed again.
 */
beforeAll(async () => {
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(
      `DO $$ BEGIN IF to_regclass('pgboss.job') IS NOT NULL THEN DELETE FROM pgboss.job; END IF; END $$`,
    );
    const { rows } = await admin.query<{ name: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables WHERE schemaname IN ('public', 'fin')`,
    );
    if (rows.length) {
      await admin.query('BEGIN');
      // Superuser only: skips append-only TRUNCATE triggers so tests can reset guarded tables.
      await admin.query('SET LOCAL session_replication_role = replica');
      await admin.query(
        `TRUNCATE ${rows.map((row) => row.name).join(', ')} RESTART IDENTITY CASCADE`,
      );
      await admin.query('COMMIT');
    }
  } finally {
    await admin.end();
  }
});
