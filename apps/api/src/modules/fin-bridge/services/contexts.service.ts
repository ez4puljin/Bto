import { Injectable } from '@nestjs/common';
import type { FinActor } from '@tugeel/fin-contract';
import { createFinCallContext, type FinCallContext } from '../../../finance-core';
import { type Actor, type AuthContext, SettingsService } from '../../identity';
import { BTO_SOURCE, BTO_TENANT } from '../installation';

const MAX_LABEL = 120;

/** Who did it, as the core's audit trail records it (attribution only, ADR-0071 #7). */
function finActor(actor: Actor): FinActor {
  if (actor.kind === 'SYSTEM') return { kind: 'SYSTEM', ref: actor.label, label: actor.label };
  const ref = `user:${actor.userId}`;
  const fullName = 'fullName' in actor && typeof actor.fullName === 'string' ? actor.fullName : '';
  return { kind: 'STAFF', ref, label: (fullName.trim() || ref).slice(0, MAX_LABEL) };
}

/**
 * The only place Bto builds Finance Core call contexts (§3.1 rule 8, ADR-0076 #2): Bto acting as
 * source BTO under its grant, or a staff member with the finance rights `user_company_roles` gives
 * them per company (ADR-0084 #2). The principal never comes from a request.
 */
@Injectable()
export class FinContexts {
  private code: Promise<string> | null = null;

  constructor(private readonly settings: SettingsService) {}

  /** The installation's company (`bto.company_code`, locked, so read once per process). */
  companyCode(): Promise<string> {
    this.code ??= this.settings.get('bto.company_code').catch((error: unknown) => {
      this.code = null;
      throw error;
    });
    return this.code;
  }

  /** Bto itself: a sale, a customer change, a boot step; `actor` is recorded, never trusted. */
  forSource(actor: Actor): FinCallContext {
    return createFinCallContext({
      principal: { kind: 'SOURCE', tenant: BTO_TENANT, system: BTO_SOURCE },
      actor: finActor(actor),
      requestId: actor.requestId ?? null,
    });
  }

  /** A signed-in staff member on a finance screen, with their rights per company. */
  forUser(ctx: AuthContext): FinCallContext {
    return createFinCallContext({
      principal: { kind: 'USER', tenant: BTO_TENANT, ref: `user:${ctx.userId}` },
      permissions: Object.fromEntries(
        [...ctx.companyPermissions].map(([company, codes]) => [company, [...codes]]),
      ),
      actor: finActor(ctx),
      requestId: ctx.requestId ?? null,
    });
  }
}
