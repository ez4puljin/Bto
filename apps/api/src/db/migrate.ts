import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { PgBoss, type Queue, type UpdateQueueOptions } from 'pg-boss';
import { z } from 'zod';
import { loadDotEnvIfPresent } from '../common/config/dotenv';
import { configurePgTypeParsers } from '../common/db/pg-types';
import { JOB_QUEUES, PGBOSS_SCHEMA } from '../common/jobs/job-registry';
import { APP_ROLE } from './provisioning';

/** dist/db/migrations in the image (nest-cli assets), src/db/migrations under tsx. */
export const MIGRATIONS_FOLDER = join(__dirname, 'migrations');
/** One migrator at a time (two api containers starting together). */
const MIGRATION_LOCK = 72_026_101;

/**
 * `pnpm db:migrate` / container entrypoint, as role migrator (ADR-0024): drizzle migrations, then the
 * pg-boss schema, then app's grants on it, then the queues of the job registry.
 */
export async function runMigrations(
  migratorUrl: string,
  log: (line: string) => void = console.log,
): Promise<void> {
  configurePgTypeParsers();
  const pool = new Pool({
    connectionString: migratorUrl,
    max: 1,
    application_name: 'tugeel-migrate',
    options: '-c lock_timeout=10s',
  });
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await migrate(drizzle({ client }), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
    log('drizzle: migrations applied');
    log(runPgBossCli(migratorUrl));
    await client.query(`GRANT USAGE ON SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`,
    );
    await client.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${PGBOSS_SCHEMA} TO ${APP_ROLE}`,
    );
    await syncQueues(migratorUrl);
    log(`pg-boss: queues in sync (${Object.keys(JOB_QUEUES).join(', ')})`);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

/** Installs or upgrades the pg-boss schema with its own CLI (async index builds are inlined). */
function runPgBossCli(migratorUrl: string): string {
  const cli = join(dirname(require.resolve('pg-boss/package.json')), 'dist', 'cli.js');
  const result = spawnSync(process.execPath, [cli, 'migrate', '--schema', PGBOSS_SCHEMA], {
    env: { ...process.env, PGBOSS_DATABASE_URL: migratorUrl },
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `pg-boss migrate failed (${result.status ?? result.signal}): ${result.stderr || result.stdout}`,
    );
  }
  return `pg-boss: ${result.stdout.trim()}`;
}

/** Queues must exist before send()/work(); default queues are plain rows in pgboss.queue. */
async function syncQueues(migratorUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: PGBOSS_SCHEMA,
    max: 1,
    migrate: false,
    createSchema: false,
    supervise: false,
    schedule: false,
    registerInstance: false,
  });
  boss.on('error', (error) => console.error('pg-boss:', error.message));
  await boss.start();
  try {
    for (const [name, config] of Object.entries(JOB_QUEUES)) {
      const existing = await boss.getQueue(name);
      if (!existing) {
        await boss.createQueue(name, config);
        continue;
      }
      if (existing.policy !== (config.policy ?? 'standard')) {
        throw new Error(`queue ${name}: policy cannot change in place (use a new queue name)`);
      }
      await boss.updateQueue(name, updatableQueueOptions(config));
    }
  } finally {
    await boss.stop({ graceful: false });
  }
}

/** updateQueue() cannot change policy, partition, deadLetter, retryDelayMax or heartbeatSeconds. */
function updatableQueueOptions(config: Omit<Queue, 'name'>): UpdateQueueOptions {
  const { policy, partition, deadLetter, retryDelayMax, heartbeatSeconds, ...updatable } = config;
  return updatable;
}

if (require.main === module) {
  loadDotEnvIfPresent(join(process.cwd(), '.env'));
  const { MIGRATOR_DATABASE_URL } = z
    .object({ MIGRATOR_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }) })
    .parse(process.env);
  runMigrations(MIGRATOR_DATABASE_URL).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
