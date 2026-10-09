import { Client, escapeIdentifier, escapeLiteral } from 'pg';
import { z } from 'zod';

/**
 * Environment provisioning (ADR-0024): roles app and migrator, the UTF-8 + ICU database, grants,
 * extensions and the Mongolian case-folding assertion. Shared by `pnpm db:provision` and the test
 * harness. Idempotent: safe to run again at any time. Never prints passwords.
 */
export const APP_ROLE = 'app';
export const MIGRATOR_ROLE = 'migrator';

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

/** Passwords come from DATABASE_URL / MIGRATOR_DATABASE_URL: one source of truth, no extra secrets. */
export function planFromEnv(raw: Record<string, string | undefined>): ProvisionPlan {
  const env = z
    .object({ ADMIN_DATABASE_URL: pgUrl, DATABASE_URL: pgUrl, MIGRATOR_DATABASE_URL: pgUrl })
    .parse(raw);
  if (databaseOf(env.DATABASE_URL) !== databaseOf(env.MIGRATOR_DATABASE_URL)) {
    throw new Error('DATABASE_URL and MIGRATOR_DATABASE_URL must name the same database');
  }
  return {
    adminUrl: env.ADMIN_DATABASE_URL,
    database: databaseOf(env.DATABASE_URL),
    roles: [
      roleFrom(env.MIGRATOR_DATABASE_URL, MIGRATOR_ROLE),
      roleFrom(env.DATABASE_URL, APP_ROLE),
    ],
  };
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
  await admin.query(`GRANT CONNECT, TEMPORARY ON DATABASE ${db} TO ${APP_ROLE}`);
  // CREATE: drizzle's migrator runs CREATE SCHEMA IF NOT EXISTS "drizzle" (checked even when the
  // schema exists) and the pg-boss CLI creates schema pgboss.
  await admin.query(`GRANT CONNECT, TEMPORARY, CREATE ON DATABASE ${db} TO ${MIGRATOR_ROLE}`);
  await admin.query(`ALTER DATABASE ${db} SET timezone TO 'UTC'`);
}

/** Connected to the target database as the admin (owner of schema public via pg_database_owner). */
export async function prepareDatabase(adminInDatabase: Client): Promise<void> {
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
