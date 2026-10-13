import { Client, escapeIdentifier } from 'pg';
import { runMigrations } from '../../src/db/migrate';
import {
  configureAiReader,
  ensureIcuDatabase,
  ensureRole,
  grantDatabase,
  prepareDatabase,
  withDatabase,
} from '../../src/db/provisioning';
import {
  type DbProject,
  loadTestEnv,
  TEST_AI_READER_CONNECTION_LIMIT,
  testDatabaseName,
} from './test-env';

/**
 * Runs once per selected database project in the parent Jest process (ADR-0024 #7): provisions the
 * roles, migrates one template database, asserts the locale, then clones one database per worker.
 * Keep @tugeel/shared out of this import graph (no moduleNameMapper here).
 */
export default async function globalSetup(
  globalConfig: { maxWorkers: number },
  projectConfig: { displayName?: string | { name: string } },
): Promise<void> {
  const name =
    typeof projectConfig.displayName === 'string'
      ? projectConfig.displayName
      : projectConfig.displayName?.name;
  const project: DbProject = name === 'integrity' ? 'integrity' : 'integration';
  const env = loadTestEnv();
  const template = testDatabaseName(env, project, 'tpl');

  const admin = new Client({
    connectionString: env.adminUrl,
    application_name: 'tugeel-test-setup',
  });
  await admin.connect();
  try {
    for (const role of env.roles) await ensureRole(admin, role);
    // Before the migrations: migrate.ts grants the ai views to an existing ai_reader only.
    await configureAiReader(admin, TEST_AI_READER_CONNECTION_LIMIT);
    await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(template)} WITH (FORCE)`);
    await ensureIcuDatabase(admin, template);
    await grantDatabase(admin, template);
    await inDatabase(withDatabase(env.adminUrl, template), prepareDatabase);
    await runMigrations(withDatabase(env.migratorUrl, template), () => undefined);
    await inDatabase(withDatabase(env.appUrl, template), async (client) => {
      const { rows } = await client.query<{ ok: boolean }>(
        'SELECT assert_unicode_casefold() AS ok',
      );
      if (rows[0]?.ok !== true) throw new Error('locale assertion failed on the test template');
    });
    // CREATE DATABASE ... TEMPLATE fails while anyone is connected to the template.
    await admin.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      [template],
    );
    for (let worker = 1; worker <= globalConfig.maxWorkers; worker += 1) {
      const database = testDatabaseName(env, project, worker);
      await admin.query(`DROP DATABASE IF EXISTS ${escapeIdentifier(database)} WITH (FORCE)`);
      await admin.query(
        `CREATE DATABASE ${escapeIdentifier(database)} TEMPLATE ${escapeIdentifier(template)}`,
      );
      await grantDatabase(admin, database);
    }
  } finally {
    await admin.end();
  }
}

async function inDatabase(url: string, work: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: url, application_name: 'tugeel-test-setup' });
  await client.connect();
  try {
    await work(client);
  } finally {
    await client.end();
  }
}
