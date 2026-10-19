import { Inject, Injectable } from '@nestjs/common';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import type { FinCallContext } from '../../../finance-core';
import { FinContexts } from '../../fin-bridge';
import { type Actor, type AuthContext, systemActor } from '../../identity';

/**
 * How finance reaches the Finance Core's books (ADR-0089): the installation's company, Bto as source
 * BTO for automatic postings and internal reads, a staff member for their own changes (manual
 * entries, the chart, the money accounts), and the core's executor for a Bto executor (the caller's
 * transaction, or the core's own handle when Bto passes its database).
 */
@Injectable()
export class FinBooks {
  private readonly readActor = systemActor('finance');

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly contexts: FinContexts,
  ) {}

  company(): Promise<string> {
    return this.contexts.companyCode();
  }

  /** Bto itself posting or reading (an automatic entry, a voucher's checks, a list). */
  source(actor: Actor = this.readActor): FinCallContext {
    return this.contexts.forSource(actor);
  }

  /** A staff member acting on the core's own records, with their rights in the company. */
  user(ctx: AuthContext): FinCallContext {
    return this.contexts.forUser(ctx);
  }

  /** A transaction for the core, or undefined to let the core read with its own handle. */
  executor(executor: Db | Tx | undefined): Tx | undefined {
    return executor === undefined || executor === this.db ? undefined : (executor as Tx);
  }
}

/** The AuthContext behind an actor that must be a signed-in staff member (a manual entry). */
export function staffContext(actor: Actor): AuthContext {
  if (actor.kind !== 'STAFF' || !('companyPermissions' in actor)) {
    throw new Error('a manual journal entry needs the signed-in staff member');
  }
  return actor as AuthContext;
}
