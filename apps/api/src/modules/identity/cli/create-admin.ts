import 'reflect-metadata';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeUsername, USERNAME_PATTERN, usernameFromPhone } from '@tugeel/shared/auth';
import { normalizeMnPhone } from '@tugeel/shared/phone';
import { businessDateTime } from '@tugeel/shared/time';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { loadDotEnvIfPresent } from '../../../common/config/dotenv';
import { parseEnv } from '../../../common/config/env.schema';
import type { Db } from '../../../common/db/db.types';
import { configurePgTypeParsers } from '../../../common/db/pg-types';
import { inTransaction } from '../../../common/db/transaction';
import { createDb } from '../../../common/db/db.module';
import { roles, userRoles, users } from '../../../db/schema';
import { systemActor } from '../auth-context';
import { syncAccessCatalog } from '../reference-data';
import { AuditService } from '../services/audit.service';
import { mirrorCompanyRoles } from '../services/company-roles';
import { type IssuedCode, issuePasswordCode } from '../services/password-codes';

export interface CreateAdminResult extends IssuedCode {
  userId: number;
  created: boolean;
}

/**
 * Creates the first admin, or recovers an existing one: ACTIVE, unlocked, holding the ADMIN role,
 * with a fresh one-time code to set the password (ADR-0027 #9). Idempotent apart from the code.
 */
export async function createAdmin(
  db: Db,
  input: { username?: string; phone?: string; fullName: string; pepper: string },
): Promise<CreateAdminResult> {
  // ADR-0128: the admin is named by phone (the login name is generated from it); an older admin
  // without a phone is recovered by login name.
  const phone = input.phone === undefined ? null : normalizeMnPhone(input.phone);
  if (input.phone !== undefined && !phone) throw new Error(`invalid phone "${input.phone}"`);
  const username = phone ? usernameFromPhone(phone) : normalizeUsername(input.username ?? '');
  if (!USERNAME_PATTERN.test(username)) throw new Error(`invalid username "${input.username}"`);
  const actor = systemActor('cli:create-admin');
  const audit = new AuditService();
  return inTransaction(db, async (tx) => {
    await syncAccessCatalog(tx);
    const [admin] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.code, 'ADMIN'));
    if (!admin) throw new Error('the ADMIN role is missing after the catalog sync');
    const [existing] = await tx
      .select()
      .from(users)
      .where(phone ? eq(users.phone, phone) : eq(users.username, username));
    const [user] = existing
      ? await tx
          .update(users)
          .set({ status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, updatedAt: sql`now()` })
          .where(eq(users.id, existing.id))
          .returning()
      : await tx
          .insert(users)
          .values({ username, fullName: input.fullName.trim(), phone })
          .returning();
    if (!user) throw new Error('admin user was not written');
    await tx.insert(userRoles).values({ userId: user.id, roleId: admin.id }).onConflictDoNothing();
    await mirrorCompanyRoles(tx, user.id);
    await audit.record(tx, actor, {
      action: existing ? 'ADMIN_RECOVERED' : 'CREATE',
      entity: 'users',
      entityId: user.id,
      before: existing ?? undefined,
      after: user,
    });
    const code = await issuePasswordCode(tx, {
      userId: user.id,
      createdBy: null,
      pepper: input.pepper,
    });
    await audit.record(tx, actor, {
      action: 'PASSWORD_CODE_ISSUED',
      entity: 'users',
      entityId: user.id,
    });
    return { userId: user.id, created: !existing, ...code };
  });
}

async function main(): Promise<void> {
  loadDotEnvIfPresent(join(__dirname, '..', '..', '..', '..', '.env'));
  // pnpm 11 forwards a `--` separator to the script verbatim; options never start with one.
  const args = process.argv.slice(2);
  while (args[0] === '--') args.shift();
  const { values } = parseArgs({
    args,
    options: {
      phone: { type: 'string' },
      username: { type: 'string' },
      'full-name': { type: 'string' },
    },
  });
  const { phone, username } = values;
  const fullName = values['full-name'] ?? username;
  if ((!phone && !username) || !fullName) {
    throw new Error(
      'usage: pnpm user:create-admin --phone <8 digits> --full-name "<full name>" (--username <name> recovers an older admin)',
    );
  }
  const env = parseEnv(process.env, 'api');
  configurePgTypeParsers();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    application_name: 'tugeel-cli',
  });
  try {
    const result = await createAdmin(createDb(pool), {
      ...(phone ? { phone } : { username }),
      fullName,
      pepper: env.AUTH_PEPPER ?? '',
    });
    const signIn = phone ? normalizeMnPhone(phone) : normalizeUsername(username ?? '');
    console.log(
      [
        `${result.created ? 'Created' : 'Recovered'} admin "${signIn}" (id ${result.userId}).`,
        `One-time code: ${result.code}  (valid until ${businessDateTime(result.expiresAt)} Ulaanbaatar time)`,
        `Open /set-password and enter ${phone ? 'the phone' : 'the login name'}, this code and a new password.`,
      ].join('\n'),
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
