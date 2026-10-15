import { DEFAULT_GL_ACCOUNTS } from '@tugeel/shared/finance';
import mn from '@tugeel/shared/i18n/mn.json';
import { sql } from 'drizzle-orm';
import type { Tx } from '../../common/db/db.types';
import { glAccounts } from './schema';

/** pg_advisory_xact_lock key of the finance boot sync (catalog uses 72_026_103). */
const FINANCE_REFERENCE_LOCK = 72_026_110;

/**
 * Inserts the default accounts that are missing (ADR-0060 #7), named from mn.json. Never touches
 * an existing account: the accountant may rename, renumber or move a role. A code or a role
 * already taken is left alone. Runs at api boot like the catalog's unit sync, so the chart exists
 * on a database whose tables were emptied (the test harness truncates everything).
 */
export async function ensureDefaultAccounts(tx: Tx): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${FINANCE_REFERENCE_LOCK})`);
  const names: Record<string, string> = mn.finance.seedAccounts;
  for (const account of DEFAULT_GL_ACCOUNTS) {
    await tx
      .insert(glAccounts)
      .values({
        code: account.code,
        name: names[account.code] ?? account.code,
        kind: account.kind,
        role: account.role,
      })
      .onConflictDoNothing();
  }
}
