import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, escapeIdentifier, Pool } from 'pg';
import { z } from 'zod';
import { loadDotEnvIfPresent } from '../../common/config/dotenv';
import { configurePgTypeParsers } from '../../common/db/pg-types';
import { postgresUrl } from '../../common/config/env.schema';
import { withDatabase } from '../../db/provisioning';

/** dist/edge/db/migrations in the image (nest-cli assets), src/edge/db/migrations under tsx. */
export const EDGE_MIGRATIONS_FOLDER = join(__dirname, 'migrations');
const EDGE_MIGRATION_LOCK = 72_026_701;

/**
 * The edge's migrations (ADR-0067): one role owns the small store database, so there is no
 * migrator split; the advisory lock keeps two starts from racing.
 */
export async function runEdgeMigrations(
  url: string,
  log: (line: string) => void = console.log,
): Promise<void> {
  configurePgTypeParsers();
  const pool = new Pool({ connectionString: url, max: 1, application_name: 'tugeel-edge-migrate' });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [EDGE_MIGRATION_LOCK]);
    await migrate(drizzle({ client }), {
      migrationsFolder: EDGE_MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
    log('edge: migrations applied');
  } finally {
    await client
      .query('SELECT pg_advisory_unlock($1)', [EDGE_MIGRATION_LOCK])
      .catch(() => undefined);
    client.release();
    await pool.end();
  }
}

/**
 * Without Docker (`edge:dev`) the edge database may not exist yet: it is created through the
 * server's `postgres` database with the same role (the local superuser). Docker creates it itself.
 */
export async function ensureEdgeDatabase(
  url: string,
  log: (line: string) => void = console.log,
): Promise<void> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const client = new Client({
    connectionString: withDatabase(url, 'postgres'),
    application_name: 'tugeel-edge-migrate',
  });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) {
      await client.query(`CREATE DATABASE ${escapeIdentifier(name)}`);
      log(`edge: database ${name} created`);
    }
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  loadDotEnvIfPresent(join(process.cwd(), '.env.edge'));
  const { EDGE_DATABASE_URL } = z.object({ EDGE_DATABASE_URL: postgresUrl }).parse(process.env);
  ensureEdgeDatabase(EDGE_DATABASE_URL)
    .then(() => runEdgeMigrations(EDGE_DATABASE_URL))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
