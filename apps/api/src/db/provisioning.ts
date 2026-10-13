import { Client, escapeIdentifier, escapeLiteral } from 'pg';
import { z } from 'zod';
import { AI_READER_ROLE } from '../common/config/env.schema';

/**
 * Environment provisioning (ADR-0024): roles app and migrator (and ai_reader, ADR-0045), the
 * UTF-8 + ICU database, grants, extensions and the Mongolian case-folding assertion. Shared by
 * `pnpm db:provision` and the test harness. Idempotent: safe to run again at any time. Never
 * prints passwords.
 */
export const APP_ROLE = 'app';
export const MIGRATOR_ROLE = 'migrator';
export { AI_READER_ROLE };

/** The assistant's pool is AI_POOL_MAX (≤ 4) per api process; the role never holds more. */
export const AI_READER_CONNECTION_LIMIT = 4;

const pgUrl = z.url({ protocol: /^postgres(ql)?$/ });

export interface RoleSpec {
  name: string;
  password: string;
}

export interface ProvisionPlan {
  adminUrl: string;
  database: string;
  roles: RoleSpec[];
}

export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

function roleFrom(url: string, expected: string): RoleSpec {
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.username);
  if (name !== expected) {
    throw new Error(`role names are fixed: expected "${expected}", got "${name}"`);
  }
  if (!parsed.password) throw new Error(`the ${expected} URL must carry a password`);
  return { name, password: decodeURIComponent(parsed.password) };
}

/**
 * Passwords come from DATABASE_URL / MIGRATOR_DATABASE_URL (and AI_DATABASE_URL when the AI
 * assistant is set up): one source of truth, no extra secrets.
 */
export function planFromEnv(raw: Record<string, string | undefined>): ProvisionPlan {
  const env = z
    .object({
      ADMIN_DATABASE_URL: pgUrl,
      DATABASE_URL: pgUrl,
      MIGRATOR_DATABASE_URL: pgUrl,
      AI_DATABASE_URL: z.preprocess(
        (value) => (value === '' ? undefined : value),
        pgUrl.optional(),
      ),
    })
    .parse(raw);
  const database = databaseOf(env.DATABASE_URL);
  for (const [key, url] of [
    ['MIGRATOR_DATABASE_URL', env.MIGRATOR_DATABASE_URL],
    ['AI_DATABASE_URL', env.AI_DATABASE_URL],
  ] as const) {
    if (url && databaseOf(url) !== database) {
      throw new Error(`DATABASE_URL and ${key} must name the same database`);
    }
  }
  return {
    adminUrl: env.ADMIN_DATABASE_URL,
    database,
    roles: [
      roleFrom(env.MIGRATOR_DATABASE_URL, MIGRATOR_ROLE),
      roleFrom(env.DATABASE_URL, APP_ROLE),
      ...(env.AI_DATABASE_URL ? [roleFrom(env.AI_DATABASE_URL, AI_READER_ROLE)] : []),
    ],
  };
}

/**
 * Session defaults of the assistant's read-only role (ADR-0045 #4): every transaction read-only,
 * only schema ai on the search path, Ulaanbaatar time, timeouts that end a stuck query or a
 * forgotten transaction, and a connection cap. All are user-settable parameters, so a
 * non-superuser admin (DigitalOcean doadmin) may set them on a role it administers.
 */
export function aiReaderSettings(connectionLimit = AI_READER_CONNECTION_LIMIT): string[] {
  const role = escapeIdentifier(AI_READER_ROLE);
  return [
    `ALTER ROLE ${role} CONNECTION LIMIT ${connectionLimit}`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`,
    `ALTER ROLE ${role} SET search_path = ai`,
    `ALTER ROLE ${role} SET timezone = 'Asia/Ulaanbaatar'`,
    `ALTER ROLE ${role} SET statement_timeout = '30s'`,
    `ALTER ROLE ${role} SET transaction_timeout = '60s'`,
    `ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '10s'`,
    `ALTER ROLE ${role} SET client_connection_check_interval = '2s'`,
  ];
}

/**
 * Applies aiReaderSettings, plus `temp_file_limit` (a superuser-only parameter) when the admin is a
 * superuser; on a managed cluster that limit is skipped (architecture §13.1 A6).
 */
export async function configureAiReader(
  admin: Client,
  connectionLimit = AI_READER_CONNECTION_LIMIT,
): Promise<string> {
  for (const statement of aiReaderSettings(connectionLimit)) await admin.query(statement);
  const { rows } = await admin.query<{ superuser: boolean }>(
    'SELECT rolsuper AS superuser FROM pg_roles WHERE rolname = current_user',
  );
  if (!rows[0]?.superuser)
    return 'read-only defaults set (temp_file_limit skipped: not a superuser)';
  await admin.query(`ALTER ROLE ${escapeIdentifier(AI_READER_ROLE)} SET temp_file_limit = '256MB'`);
  return 'read-only defaults set';
}

async function roleExists(client: Client, name: string): Promise<boolean> {
  const { rowCount } = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [name]);
  return rowCount === 1;
}

/**
 * LOGIN + PASSWORD only: under PostgreSQL 16+ CREATEROLE rules a non-superuser admin (DigitalOcean
 * doadmin) may not restate attributes such as NOSUPERUSER. Roles it creates are granted back to it
 * WITH ADMIN TRUE, which is enough to change their passwords later.
 */
export async function ensureRole(
  admin: Client,
  role: RoleSpec,
): Promise<'created' | 'password updated'> {
  const exists =
    (await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role.name])).rowCount === 1;
  await admin.query(
    `${exists ? 'ALTER' : 'CREATE'} ROLE ${escapeIdentifier(role.name)} WITH LOGIN PASSWORD ${escapeLiteral(role.password)}`,
  );
  return exists ? 'password updated' : 'created';
}

export async function assertPlainRoles(admin: Client, names: string[]): Promise<void> {
  const { rows } = await admin.query<{ rolname: string }>(
    `SELECT rolname FROM pg_roles WHERE rolname = ANY($1)
       AND (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls)`,
    [names],
  );
  if (rows.length) {
    throw new Error(`must be plain LOGIN roles: ${rows.map((row) => row.rolname).join(', ')}`);
  }
}

export async function ensureIcuDatabase(
  admin: Client,
  name: string,
): Promise<'created' | 'exists'> {
  const { rows } = await admin.query<{ enc: string; provider: string }>(
    'SELECT pg_encoding_to_char(encoding) AS enc, datlocprovider AS provider FROM pg_database WHERE datname = $1',
    [name],
  );
  const existing = rows[0];
  if (!existing) {
    // Owner = the admin user: OWNER <other role> would need SET ROLE to it (PostgreSQL 16+).
    await admin.query(
      `CREATE DATABASE ${escapeIdentifier(name)} WITH TEMPLATE template0 ENCODING 'UTF8' LOCALE_PROVIDER icu ICU_LOCALE 'und'`,
    );
    return 'created';
  }
  if (existing.enc !== 'UTF8' || existing.provider !== 'i') {
    throw new Error(
      `database ${name} is ${existing.enc}/${existing.provider}; expected UTF8 + ICU (recreate it while empty)`,
    );
  }
  return 'exists';
}

/** Database-level grants. CREATE DATABASE … TEMPLATE does not copy them: rerun for every clone. */
export async function grantDatabase(admin: Client, name: string): Promise<void> {
  const db = escapeIdentifier(name);
  // PUBLIC gets CONNECT and TEMPORARY on every new database: only the roles below keep them, so the
  // read-only role creates no temporary tables (ADR-0045 #4).
  await admin.query(`REVOKE CONNECT, TEMPORARY ON DATABASE ${db} FROM PUBLIC`);
  if (await roleExists(admin, AI_READER_ROLE)) {
    await admin.query(`GRANT CONNECT ON DATABASE ${db} TO ${AI_READER_ROLE}`);
  }
  await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${APP_ROLE}`);
  // CREATE: drizzle's migrator runs CREATE SCHEMA IF NOT EXISTS "drizzle" (checked even when the
  // schema exists) and the pg-boss CLI creates schema pgboss.
  await admin.query(`GRANT CONNECT, TEMPORARY, CREATE ON DATABASE ${db} TO ${MIGRATOR_ROLE}`);
  await admin.query(`ALTER DATABASE ${db} SET timezone TO 'UTC'`);
}

/** Connected to the target database as the admin (owner of schema public via pg_database_owner). */
export async function prepareDatabase(adminInDatabase: Client): Promise<void> {
  // PUBLIC's USAGE on schema public would let the read-only role resolve names there (ADR-0045 #4).
  await adminInDatabase.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await adminInDatabase.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${MIGRATOR_ROLE}`);
  await adminInDatabase.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await adminInDatabase.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await adminInDatabase.query('CREATE EXTENSION IF NOT EXISTS btree_gist');
  const { rows } = await adminInDatabase.query<{ ok: boolean }>(
    `SELECT lower('ӨҮЁ') = 'өүё' AS ok`,
  );
  if (!rows[0]?.ok) throw new Error("locale assertion failed: lower('ӨҮЁ') <> 'өүё'");
}

export async function provisionEnvironment(
  plan: ProvisionPlan,
  log: (line: string) => void,
): Promise<void> {
  const admin = new Client({
    connectionString: plan.adminUrl,
    application_name: 'tugeel-db-provision',
  });
  await admin.connect();
  try {
    for (const role of plan.roles) log(`role ${role.name}: ${await ensureRole(admin, role)}`);
    await assertPlainRoles(
      admin,
      plan.roles.map((role) => role.name),
    );
    if (plan.roles.some((role) => role.name === AI_READER_ROLE)) {
      log(`role ${AI_READER_ROLE}: ${await configureAiReader(admin)}`);
    }
    log(`database ${plan.database}: ${await ensureIcuDatabase(admin, plan.database)}`);
    await grantDatabase(admin, plan.database);
  } finally {
    await admin.end();
  }
  const inDatabase = new Client({
    connectionString: withDatabase(plan.adminUrl, plan.database),
    application_name: 'tugeel-db-provision',
  });
  await inDatabase.connect();
  try {
    await prepareDatabase(inDatabase);
    log('schema grants, extensions, locale: ok');
  } finally {
    await inDatabase.end();
  }
}
