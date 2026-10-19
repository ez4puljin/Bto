import { and, eq, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import type { FinTx } from '../db/fin-db';
import {
  FIN_ACCOUNT_CONTROLS,
  finBranches,
  finBranchRefs,
  finCompanies,
  finParties,
  finPartyCompanies,
  finPartyRefs,
  finPostingKeys,
  finSourceGrants,
  finSourceSystems,
  finTenants,
} from '../schema';

export const ENSURE_COMPANY_LOCK = 72_026_130;
const BOOT = { system: 'boot' };

export type FinAccountControl = (typeof FIN_ACCOUNT_CONTROLS)[number];

/** What an installation books into (fin-bridge builds it from Bto's constants and branches). */
export interface FinInstallationSpec {
  tenant: { code: string; name: string };
  company: { code: string; legalName: string; timezone: string; functionalCurrency: string };
  sources: readonly { code: string; linkTemplate: string | null }[];
  postingKeys: readonly {
    code: string;
    requiredControl: FinAccountControl;
    requiresTaxCode: boolean;
  }[];
  /** The party that takes control-account lines without a known counterparty (F1's ledger). */
  legacyParty: { system: string; ref: string; name: string };
  /** The source's branches; inactive ones are never mapped (ADR-0084 #1). */
  branches: readonly {
    system: string;
    externalId: string;
    code: string;
    name: string;
    active: boolean;
  }[];
}

/**
 * Makes sure the installation's tenant, company, sources, grants, posting keys, legacy party and
 * branches exist (docs/modules/finance-core.md §16.1 P1). Idempotent and insert-only for everything
 * but mapped branches, whose code, name and status follow the source: a company the owner edited
 * on «Компани» is never overwritten. Runs at every boot (tests empty the tables) under an advisory
 * lock, so two processes starting together create everything once.
 */
export async function ensureDefaultCompany(
  tx: FinTx,
  spec: FinInstallationSpec,
): Promise<{ tenantId: number; companyId: number }> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(${ENSURE_COMPANY_LOCK})`);

  await tx
    .insert(finTenants)
    .values({ code: spec.tenant.code, name: spec.tenant.name })
    .onConflictDoNothing({ target: finTenants.code });
  const [tenant] = await tx
    .select({ id: finTenants.id })
    .from(finTenants)
    .where(eq(finTenants.code, spec.tenant.code));
  if (!tenant) throw new Error(`fin tenant ${spec.tenant.code} is missing`);
  const tenantId = tenant.id;

  const createdCompany = await tx
    .insert(finCompanies)
    .values({
      tenantId,
      code: spec.company.code,
      legalName: spec.company.legalName,
      timezone: spec.company.timezone,
      functionalCurrency: spec.company.functionalCurrency,
    })
    .onConflictDoNothing({ target: [finCompanies.tenantId, finCompanies.code] })
    .returning({ id: finCompanies.id });
  const [company] = await tx
    .select({ id: finCompanies.id })
    .from(finCompanies)
    .where(and(eq(finCompanies.tenantId, tenantId), eq(finCompanies.code, spec.company.code)));
  if (!company) throw new Error(`fin company ${spec.company.code} is missing`);
  const companyId = company.id;
  if (createdCompany.length > 0) {
    await recordFinAudit(tx, BOOT, {
      tenantId,
      companyId,
      action: 'CREATE',
      entity: 'company',
      entityId: spec.company.code,
      after: spec.company,
    });
  }

  if (spec.sources.length > 0) {
    await tx
      .insert(finSourceSystems)
      .values(spec.sources.map((s) => ({ tenantId, code: s.code, linkTemplate: s.linkTemplate })))
      .onConflictDoNothing({ target: [finSourceSystems.tenantId, finSourceSystems.code] });
  }
  const sources = await tx
    .select({ id: finSourceSystems.id, code: finSourceSystems.code })
    .from(finSourceSystems)
    .where(eq(finSourceSystems.tenantId, tenantId));
  const sourceId = (code: string): number => {
    const found = sources.find((s) => s.code === code);
    if (!found) throw new Error(`fin source ${code} is not in the installation spec`);
    return found.id;
  };
  const granted = spec.sources.map((s) => sourceId(s.code));
  if (granted.length > 0) {
    await tx
      .insert(finSourceGrants)
      .values(granted.map((id) => ({ tenantId, companyId, sourceSystemId: id })))
      .onConflictDoNothing();
  }

  if (spec.postingKeys.length > 0) {
    await tx
      .insert(finPostingKeys)
      .values(spec.postingKeys.map((k) => ({ companyId, ...k })))
      .onConflictDoNothing();
  }

  const legacySource = sourceId(spec.legacyParty.system);
  const [legacy] = await tx
    .select({ partyId: finPartyRefs.partyId })
    .from(finPartyRefs)
    .where(
      and(
        eq(finPartyRefs.tenantId, tenantId),
        eq(finPartyRefs.sourceSystemId, legacySource),
        eq(finPartyRefs.externalId, spec.legacyParty.ref),
      ),
    );
  if (!legacy) {
    const [party] = await tx
      .insert(finParties)
      .values({ tenantId, kind: 'OTHER', name: spec.legacyParty.name })
      .returning({ id: finParties.id });
    if (!party) throw new Error('fin legacy party was not created');
    await tx.insert(finPartyRefs).values({
      tenantId,
      sourceSystemId: legacySource,
      externalId: spec.legacyParty.ref,
      partyId: party.id,
    });
    await tx.insert(finPartyCompanies).values({ companyId, partyId: party.id, tenantId });
    await recordFinAudit(tx, BOOT, {
      tenantId,
      companyId,
      action: 'CREATE',
      entity: 'party',
      entityId: party.id,
      after: { kind: 'OTHER', name: spec.legacyParty.name, ref: spec.legacyParty.ref },
    });
  }

  for (const branch of spec.branches) {
    await syncBranch(tx, { tenantId, companyId, sourceSystemId: sourceId(branch.system) }, branch);
  }
  return { tenantId, companyId };
}

async function syncBranch(
  tx: FinTx,
  scope: { tenantId: number; companyId: number; sourceSystemId: number },
  branch: FinInstallationSpec['branches'][number],
): Promise<void> {
  const status = branch.active ? ('ACTIVE' as const) : ('INACTIVE' as const);
  const [mapped] = await tx
    .select({
      id: finBranches.id,
      code: finBranches.code,
      name: finBranches.name,
      status: finBranches.status,
    })
    .from(finBranchRefs)
    .innerJoin(
      finBranches,
      and(
        eq(finBranches.companyId, finBranchRefs.companyId),
        eq(finBranches.id, finBranchRefs.branchId),
      ),
    )
    .where(
      and(
        eq(finBranchRefs.companyId, scope.companyId),
        eq(finBranchRefs.sourceSystemId, scope.sourceSystemId),
        eq(finBranchRefs.externalId, branch.externalId),
      ),
    );
  if (mapped) {
    if (mapped.code === branch.code && mapped.name === branch.name && mapped.status === status) {
      return;
    }
    await tx
      .update(finBranches)
      .set({ code: branch.code, name: branch.name, status, updatedAt: sql`now()` })
      .where(and(eq(finBranches.companyId, scope.companyId), eq(finBranches.id, mapped.id)));
    await recordFinAudit(tx, BOOT, {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      action: 'UPDATE',
      entity: 'branch',
      entityId: mapped.id,
      before: { code: mapped.code, name: mapped.name, status: mapped.status },
      after: { code: branch.code, name: branch.name, status },
    });
    return;
  }
  if (!branch.active) return;
  const [created] = await tx
    .insert(finBranches)
    .values({ companyId: scope.companyId, code: branch.code, name: branch.name })
    .returning({ id: finBranches.id });
  if (!created) throw new Error(`fin branch ${branch.code} was not created`);
  await tx.insert(finBranchRefs).values({
    companyId: scope.companyId,
    sourceSystemId: scope.sourceSystemId,
    externalId: branch.externalId,
    branchId: created.id,
  });
  await recordFinAudit(tx, BOOT, {
    tenantId: scope.tenantId,
    companyId: scope.companyId,
    action: 'CREATE',
    entity: 'branch',
    entityId: created.id,
    after: { code: branch.code, name: branch.name, ref: `${branch.system}:${branch.externalId}` },
  });
}
