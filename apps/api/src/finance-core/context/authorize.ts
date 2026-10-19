import type { FinPermission } from '@tugeel/fin-contract';
import { and, eq } from 'drizzle-orm';
import type { FinDb, FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { finCompanies, finSourceGrants, finSourceSystems, finTenants } from '../schema';
import { assertFinCallContext, type FinCallContext } from './call-context';

export type FinExecutor = FinDb | FinTx;

/** A company resolved for one call, inside the caller's tenant. */
export interface CompanyScope {
  tenantId: number;
  companyId: number;
  companyCode: string;
  /** The calling source system's id when the principal is a SOURCE. */
  sourceSystemId: number | null;
}

/** Who may act on a company: a granted source, and/or a user holding any of these rights there. */
export interface CompanyRule {
  source: boolean;
  userAnyOf: readonly FinPermission[];
}

/**
 * Resolves `company` for `ctx` (ADR-0076 #2): unknown in the tenant → FIN_COMPANY_UNKNOWN; a user
 * without the right there → FIN_COMPANY_FORBIDDEN; a source without an ACTIVE grant →
 * FIN_SOURCE_NOT_GRANTED. Every port starts here; nothing reads a company's rows before it.
 */
export async function resolveCompany(
  executor: FinExecutor,
  ctx: FinCallContext,
  company: string,
  rule: CompanyRule,
): Promise<CompanyScope> {
  assertFinCallContext(ctx);
  const [row] = await executor
    .select({ tenantId: finCompanies.tenantId, companyId: finCompanies.id })
    .from(finCompanies)
    .innerJoin(finTenants, eq(finTenants.id, finCompanies.tenantId))
    .where(
      and(
        eq(finTenants.code, ctx.principal.tenant),
        eq(finTenants.status, 'ACTIVE'),
        eq(finCompanies.code, company),
        eq(finCompanies.status, 'ACTIVE'),
      ),
    );
  if (!row) throw new FinError('FIN_COMPANY_UNKNOWN', undefined, { company });

  if (ctx.principal.kind === 'USER') {
    const rights = ctx.permissions.get(company);
    if (!rule.userAnyOf.some((right) => rights?.has(right))) {
      throw new FinError('FIN_COMPANY_FORBIDDEN', undefined, { company });
    }
    return { ...row, companyCode: company, sourceSystemId: null };
  }

  if (!rule.source) throw new FinError('FIN_COMPANY_FORBIDDEN', undefined, { company });
  const [grant] = await executor
    .select({ sourceSystemId: finSourceSystems.id })
    .from(finSourceSystems)
    .innerJoin(
      finSourceGrants,
      and(
        eq(finSourceGrants.sourceSystemId, finSourceSystems.id),
        eq(finSourceGrants.companyId, row.companyId),
      ),
    )
    .where(
      and(
        eq(finSourceSystems.tenantId, row.tenantId),
        eq(finSourceSystems.code, ctx.principal.system),
        eq(finSourceSystems.status, 'ACTIVE'),
        eq(finSourceGrants.status, 'ACTIVE'),
      ),
    );
  if (!grant) {
    throw new FinError('FIN_SOURCE_NOT_GRANTED', undefined, {
      company,
      system: ctx.principal.system,
    });
  }
  return { ...row, companyCode: company, sourceSystemId: grant.sourceSystemId };
}
