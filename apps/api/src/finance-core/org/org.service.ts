import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import type { FinCallContext } from '../context/call-context';
import { type FinExecutor, resolveCompany } from '../context/authorize';
import { FIN_DB, type FinDb } from '../db/fin-db';
import { FinError } from '../errors';
import {
  finBranches,
  finBranchRefs,
  finCompanies,
  finCompanyTaxRegistrations,
  finSourceSystems,
} from '../schema';

export interface FinCompanyView {
  code: string;
  legalName: string;
  registerNo: string | null;
  tin: string | null;
  functionalCurrency: string;
  timezone: string;
  fiscalYearStartMonth: number;
  status: 'ACTIVE' | 'INACTIVE';
  taxRegistrations: {
    taxKind: string;
    effectiveFrom: string;
    registered: boolean;
    activityCode: string | null;
  }[];
  branches: {
    code: string;
    name: string;
    status: 'ACTIVE' | 'INACTIVE';
    refs: { system: string; externalId: string }[];
  }[];
}

export interface FinCompanyPatch {
  company: string;
  legalName: string;
  registerNo: string | null;
  tin: string | null;
}

function hasControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** An optional identifier: ≤ 32 characters, no control characters (the shape the table checks). */
function identifier(value: string | null, path: string): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 32 || hasControlCharacter(trimmed)) {
    throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path });
  }
  return trimmed;
}

/**
 * The organisation port (ADR-0070): a company's record for any granted source or a user with
 * finance rights there, and its legal identity edited by a user holding `finance.settings.manage`
 * in that company. The core checks only generic shapes; Mongolian TIN and register rules are the
 * caller's (`@tugeel/shared/taxpayer`, ADR-0074).
 */
@Injectable()
export class FinOrgService {
  constructor(@Inject(FIN_DB) private readonly db: FinDb) {}

  async company(ctx: FinCallContext, query: { company: string }): Promise<FinCompanyView> {
    const scope = await resolveCompany(this.db, ctx, query.company, {
      source: true,
      userAnyOf: ['finance.read', 'finance.settings.manage'],
    });
    return this.view(this.db, scope.companyId);
  }

  async updateCompany(ctx: FinCallContext, patch: FinCompanyPatch): Promise<FinCompanyView> {
    const legalName = patch.legalName.trim();
    if (legalName.length < 1 || legalName.length > 200) {
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, { path: 'legalName' });
    }
    const registerNo = identifier(patch.registerNo, 'registerNo');
    const tin = identifier(patch.tin, 'tin');
    return this.db.transaction(async (tx) => {
      const scope = await resolveCompany(tx, ctx, patch.company, {
        source: false,
        userAnyOf: ['finance.settings.manage'],
      });
      const [before] = await tx
        .select({
          legalName: finCompanies.legalName,
          registerNo: finCompanies.registerNo,
          tin: finCompanies.tin,
        })
        .from(finCompanies)
        .where(eq(finCompanies.id, scope.companyId))
        .for('update');
      if (!before) throw new FinError('FIN_COMPANY_UNKNOWN', undefined, { company: patch.company });
      const after = { legalName, registerNo, tin };
      if (
        before.legalName !== after.legalName ||
        before.registerNo !== after.registerNo ||
        before.tin !== after.tin
      ) {
        await tx
          .update(finCompanies)
          .set({ ...after, updatedAt: sql`now()` })
          .where(eq(finCompanies.id, scope.companyId));
        await recordFinAudit(tx, ctx, {
          tenantId: scope.tenantId,
          companyId: scope.companyId,
          action: 'UPDATE',
          entity: 'company',
          entityId: patch.company,
          before,
          after,
        });
      }
      return this.view(tx, scope.companyId);
    });
  }

  private async view(executor: FinExecutor, companyId: number): Promise<FinCompanyView> {
    const [company] = await executor
      .select()
      .from(finCompanies)
      .where(eq(finCompanies.id, companyId));
    if (!company) throw new Error(`fin company ${companyId} vanished`);
    const taxRegistrations = await executor
      .select({
        taxKind: finCompanyTaxRegistrations.taxKind,
        effectiveFrom: finCompanyTaxRegistrations.effectiveFrom,
        registered: finCompanyTaxRegistrations.registered,
        activityCode: finCompanyTaxRegistrations.activityCode,
      })
      .from(finCompanyTaxRegistrations)
      .where(eq(finCompanyTaxRegistrations.companyId, companyId))
      .orderBy(
        asc(finCompanyTaxRegistrations.taxKind),
        asc(finCompanyTaxRegistrations.effectiveFrom),
      );
    const branches = await executor
      .select({
        id: finBranches.id,
        code: finBranches.code,
        name: finBranches.name,
        status: finBranches.status,
      })
      .from(finBranches)
      .where(eq(finBranches.companyId, companyId))
      .orderBy(asc(finBranches.code));
    const refs = await executor
      .select({
        branchId: finBranchRefs.branchId,
        system: finSourceSystems.code,
        externalId: finBranchRefs.externalId,
      })
      .from(finBranchRefs)
      .innerJoin(finSourceSystems, eq(finSourceSystems.id, finBranchRefs.sourceSystemId))
      .where(and(eq(finBranchRefs.companyId, companyId)))
      .orderBy(asc(finSourceSystems.code), asc(finBranchRefs.externalId));
    return {
      code: company.code,
      legalName: company.legalName,
      registerNo: company.registerNo,
      tin: company.tin,
      functionalCurrency: company.functionalCurrency,
      timezone: company.timezone,
      fiscalYearStartMonth: company.fiscalYearStartMonth,
      status: company.status,
      taxRegistrations,
      branches: branches.map((b) => ({
        code: b.code,
        name: b.name,
        status: b.status,
        refs: refs
          .filter((r) => r.branchId === b.id)
          .map((r) => ({ system: r.system, externalId: r.externalId })),
      })),
    };
  }
}
