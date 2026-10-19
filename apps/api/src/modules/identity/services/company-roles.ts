import { parseSettingValue, settingDefault } from '@tugeel/shared/settings';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db, Tx } from '../../../common/db/db.types';
import { settings, userCompanyRoles } from '../schema';

const COMPANY_CODE = 'bto.company_code';

/**
 * The Finance Core company this installation books into: `bto.company_code`, locked, so at most
 * the one value written at installation, else the registry default (ADR-0070 #2, ADR-0084 #3).
 */
export async function installationCompanyCode(executor: Db | Tx): Promise<string> {
  const [row] = await executor
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, COMPANY_CODE))
    .orderBy(desc(settings.effectiveFrom))
    .limit(1);
  if (!row) {
    const fallback = settingDefault(COMPANY_CODE);
    if (fallback === undefined) throw new Error(`${COMPANY_CODE} has no default`);
    return fallback;
  }
  const parsed = parseSettingValue(COMPANY_CODE, row.value);
  if (!parsed.ok) throw new Error(`stored value of setting ${COMPANY_CODE} is invalid`);
  return parsed.value;
}

/**
 * Copies a user's roles to the installation's company (ADR-0075 "no row, no access", ADR-0084 #2):
 * until a per-company grant screen exists, a user's finance rights there are exactly their roles.
 * Called inside every transaction that writes `user_roles`.
 */
export async function mirrorCompanyRoles(tx: Tx, userId: number): Promise<void> {
  const companyCode = await installationCompanyCode(tx);
  await tx.delete(userCompanyRoles).where(eq(userCompanyRoles.userId, userId));
  await tx.execute(sql`
    INSERT INTO user_company_roles (user_id, company_code, role_id)
    SELECT ur.user_id, ${companyCode}, ur.role_id FROM user_roles ur WHERE ur.user_id = ${userId}`);
}
