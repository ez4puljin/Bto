import { join } from 'node:path';
import { loadDotEnvIfPresent } from '../../src/common/config/dotenv';
import { planFromEnv, type RoleSpec, withDatabase } from '../../src/db/provisioning';

/** Database-backed Jest projects (ADR-0016, ADR-0024). */
export type DbProject = 'integration' | 'integrity';

export interface TestEnv {
  adminUrl: string;
  appUrl: string;
  migratorUrl: string;
  prefix: string;
  roles: RoleSpec[];
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);

/**
 * Reads apps/api/.env when present (local runs; CI sets the variables directly). The harness drops and
 * creates databases, so it refuses any admin URL that is not the local postgres:18 container.
 */
export function loadTestEnv(): TestEnv {
  loadDotEnvIfPresent(join(__dirname, '..', '..', '.env'));
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL ?? '';
  if (!adminUrl) throw new Error('TEST_ADMIN_DATABASE_URL is not set (see apps/api/.env.example)');
  const host = new URL(adminUrl).hostname;
  if (!LOCAL_HOSTS.has(host) && process.env.TEST_ALLOW_REMOTE_DB !== '1') {
    throw new Error(
      `TEST_ADMIN_DATABASE_URL must point at the local postgres container, not ${host}`,
    );
  }
  const plan = planFromEnv({
    ADMIN_DATABASE_URL: adminUrl,
    DATABASE_URL: process.env.DATABASE_URL,
    MIGRATOR_DATABASE_URL: process.env.MIGRATOR_DATABASE_URL,
  });
  const prefix = process.env.TEST_DATABASE_PREFIX ?? 'tugeel_test';
  if (!/^[a-z][a-z0-9_]*$/.test(prefix)) throw new Error(`bad TEST_DATABASE_PREFIX "${prefix}"`);
  return {
    adminUrl,
    appUrl: process.env.DATABASE_URL ?? '',
    migratorUrl: process.env.MIGRATOR_DATABASE_URL ?? '',
    prefix,
    roles: plan.roles,
  };
}

export function testDatabaseName(env: TestEnv, project: DbProject, worker: number | 'tpl'): string {
  return `${env.prefix}_${project}_${worker === 'tpl' ? 'tpl' : `w${worker}`}`;
}

/** Points this Jest worker at its own database and sets a test-friendly environment. */
export function applyWorkerEnv(project: DbProject): void {
  const env = loadTestEnv();
  const database = testDatabaseName(
    env,
    project,
    Number.parseInt(process.env.JEST_WORKER_ID ?? '1', 10),
  );
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    DATABASE_URL: withDatabase(env.appUrl, database),
    MIGRATOR_DATABASE_URL: withDatabase(env.migratorUrl, database),
    TEST_DATABASE_ADMIN_URL: withDatabase(env.adminUrl, database),
    DB_POOL_MAX: '4',
    PGBOSS_POOL_MAX: '2',
    WORKER_HEALTH_PORT: '0',
    APP_VERSION: 'test',
  });
  delete process.env.ROLE;
  if (project === 'integrity') {
    // node-postgres reads PGOPTIONS for every new connection: deadlocks fail fast and loudly.
    process.env.PGOPTIONS = '-c statement_timeout=5s';
  }
}
