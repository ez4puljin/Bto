import { Injectable } from '@nestjs/common';
import { type PartyIn, PartyInSchema } from '@tugeel/fin-contract';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { recordFinAudit } from '../audit/fin-audit';
import { type CompanyScope, type FinExecutor, resolveCompany } from '../context/authorize';
import type { FinCallContext } from '../context/call-context';
import type { FinTx } from '../db/fin-db';
import { FinError } from '../errors';
import { finParties, finPartyCompanies, finPartyRefs } from '../schema';

export const PARTY_REF_LOCK = 72_026_131;

/** A party as its source knows it. */
export interface FinPartyRef {
  partyId: string;
  system: string;
  ref: string;
}

/**
 * Parties (ADR-0070 #8): a source system's counterparty becomes a tenant-wide party on first
 * sight, joins the company, and follows the source's name, kind, TIN and register number later
 * (the P1 part of `FinConfig.updateParty`). Only a SOURCE principal speaks for its own refs; a
 * party is never matched by TIN (stores share TINs, ADR-0032).
 */
@Injectable()
export class FinPartiesService {
  /** Creates or updates the party of `party.ref` inside the caller's transaction. */
  async upsertPartyInTx(
    tx: FinTx,
    ctx: FinCallContext,
    input: { company: string; party: PartyIn },
  ): Promise<FinPartyRef> {
    const parsed = PartyInSchema.safeParse(input.party);
    if (!parsed.success) {
      throw new FinError('FIN_PAYLOAD_INVALID', undefined, {
        path: `party.${parsed.error.issues[0]?.path.join('.') ?? ''}`,
      });
    }
    const party = parsed.data;
    const scope = await this.sourceScope(tx, ctx, input.company);
    await this.lock(tx, scope, party.ref);
    const existing = await this.find(tx, scope, party.ref);
    const values = {
      kind: party.kind,
      name: party.name.trim(),
      tin: party.tin ?? null,
      registerNo: party.registerNo ?? null,
    };
    if (!existing) {
      const [created] = await tx
        .insert(finParties)
        .values({ tenantId: scope.tenantId, ...values })
        .returning({ id: finParties.id });
      if (!created) throw new Error('fin party was not created');
      await tx.insert(finPartyRefs).values({
        tenantId: scope.tenantId,
        sourceSystemId: scope.sourceSystemId,
        externalId: party.ref,
        partyId: created.id,
      });
      await this.joinCompany(tx, scope, created.id);
      await recordFinAudit(tx, ctx, {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        action: 'CREATE',
        entity: 'party',
        entityId: created.id,
        after: { ...values, ref: party.ref },
      });
      return { partyId: String(created.id), system: scope.system, ref: party.ref };
    }
    const [current] = await tx
      .select({
        kind: finParties.kind,
        name: finParties.name,
        tin: finParties.tin,
        registerNo: finParties.registerNo,
      })
      .from(finParties)
      .where(and(eq(finParties.tenantId, scope.tenantId), eq(finParties.id, existing)));
    if (!current) throw new Error(`fin party ${existing} vanished`);
    if (
      current.kind !== values.kind ||
      current.name !== values.name ||
      current.tin !== values.tin ||
      current.registerNo !== values.registerNo
    ) {
      await tx
        .update(finParties)
        .set({ ...values, updatedAt: sql`now()` })
        .where(and(eq(finParties.tenantId, scope.tenantId), eq(finParties.id, existing)));
      await recordFinAudit(tx, ctx, {
        tenantId: scope.tenantId,
        companyId: scope.companyId,
        action: 'UPDATE',
        entity: 'party',
        entityId: existing,
        before: current,
        after: values,
      });
    }
    await this.joinCompany(tx, scope, existing);
    return { partyId: String(existing), system: scope.system, ref: party.ref };
  }

  /** The party of `ref` for the calling source, or null when the core has not seen it yet. */
  async resolvePartyInTx(
    tx: FinTx,
    ctx: FinCallContext,
    query: { company: string; ref: string },
  ): Promise<FinPartyRef | null> {
    const scope = await this.sourceScope(tx, ctx, query.company);
    const partyId = await this.find(tx, scope, query.ref);
    return partyId === null
      ? null
      : { partyId: String(partyId), system: scope.system, ref: query.ref };
  }

  /**
   * The calling source's refs of these parties (Bto: `customer:<id>`), by party id; a party the
   * source does not know is left out. Used to show a journal line's counterparty in the source's terms.
   */
  async refsOf(
    executor: FinExecutor,
    ctx: FinCallContext,
    query: { company: string; partyIds: readonly string[] },
  ): Promise<Map<string, string>> {
    const scope = await this.sourceScope(executor, ctx, query.company);
    const ids = [...new Set(query.partyIds)].map((id) => Number.parseInt(id, 10));
    if (ids.length === 0) return new Map();
    const rows = await executor
      .select({ partyId: finPartyRefs.partyId, ref: finPartyRefs.externalId })
      .from(finPartyRefs)
      .where(
        and(
          eq(finPartyRefs.tenantId, scope.tenantId),
          eq(finPartyRefs.sourceSystemId, scope.sourceSystemId),
          inArray(finPartyRefs.partyId, ids),
        ),
      );
    return new Map(rows.map((row) => [String(row.partyId), row.ref]));
  }

  /** The parties of these refs of the calling source, by ref; an unseen ref is left out. */
  async partiesOf(
    executor: FinExecutor,
    ctx: FinCallContext,
    query: { company: string; refs: readonly string[] },
  ): Promise<Map<string, string>> {
    const scope = await this.sourceScope(executor, ctx, query.company);
    const refs = [...new Set(query.refs)];
    if (refs.length === 0) return new Map();
    const rows = await executor
      .select({ partyId: finPartyRefs.partyId, ref: finPartyRefs.externalId })
      .from(finPartyRefs)
      .where(
        and(
          eq(finPartyRefs.tenantId, scope.tenantId),
          eq(finPartyRefs.sourceSystemId, scope.sourceSystemId),
          inArray(finPartyRefs.externalId, refs),
        ),
      );
    return new Map(rows.map((row) => [row.ref, String(row.partyId)]));
  }

  private async sourceScope(
    tx: FinExecutor,
    ctx: FinCallContext,
    company: string,
  ): Promise<CompanyScope & { sourceSystemId: number; system: string }> {
    if (ctx.principal.kind !== 'SOURCE') {
      throw new FinError('FIN_COMPANY_FORBIDDEN', undefined, { company });
    }
    const scope = await resolveCompany(tx, ctx, company, { source: true, userAnyOf: [] });
    if (scope.sourceSystemId === null) throw new Error('a SOURCE scope without its source');
    return { ...scope, sourceSystemId: scope.sourceSystemId, system: ctx.principal.system };
  }

  /** One writer per (source, ref) at a time, so two first sights never make two parties. */
  private async lock(tx: FinTx, scope: { sourceSystemId: number }, ref: string): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${PARTY_REF_LOCK}, hashtext(${`${scope.sourceSystemId}:${ref}`}))`,
    );
  }

  private async find(
    tx: FinExecutor,
    scope: { tenantId: number; sourceSystemId: number },
    ref: string,
  ): Promise<number | null> {
    const [row] = await tx
      .select({ partyId: finPartyRefs.partyId })
      .from(finPartyRefs)
      .where(
        and(
          eq(finPartyRefs.tenantId, scope.tenantId),
          eq(finPartyRefs.sourceSystemId, scope.sourceSystemId),
          eq(finPartyRefs.externalId, ref),
        ),
      );
    return row?.partyId ?? null;
  }

  private async joinCompany(
    tx: FinTx,
    scope: { tenantId: number; companyId: number },
    partyId: number,
  ): Promise<void> {
    await tx
      .insert(finPartyCompanies)
      .values({ companyId: scope.companyId, partyId, tenantId: scope.tenantId })
      .onConflictDoNothing();
  }
}
