import type { FinTx } from '../db/fin-db';
import { finAuditLog } from '../schema';
import { type FinCallContext, principalLabel } from '../context/call-context';

export interface FinAuditEntry {
  tenantId: number;
  companyId: number | null;
  /** UPPER_SNAKE: CREATE, UPDATE, LINK … */
  action: string;
  entity: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
}

/** A boot step or a job acting for the core itself. */
export interface FinSystemActor {
  system: string;
}

/**
 * Writes one row of the core's own audit trail inside `tx` (ADR-0069; the Bto convention
 * `AuditService.record(tx, …)`). The actor is given by value: the core never reads Bto's users.
 */
export async function recordFinAudit(
  tx: FinTx,
  who: FinCallContext | FinSystemActor,
  entry: FinAuditEntry,
): Promise<void> {
  const actor =
    'principal' in who
      ? {
          actorKind: who.actor.kind,
          actorRef: who.actor.ref,
          actorLabel: who.actor.label,
          principal: principalLabel(who.principal),
          requestId: who.requestId,
        }
      : {
          actorKind: 'SYSTEM' as const,
          actorRef: who.system,
          actorLabel: who.system,
          principal: 'SYSTEM',
          requestId: null,
        };
  await tx.insert(finAuditLog).values({
    tenantId: entry.tenantId,
    companyId: entry.companyId,
    ...actor,
    action: entry.action,
    entity: entry.entity,
    entityId: String(entry.entityId),
    before: entry.before ?? null,
    after: entry.after ?? null,
  });
}
