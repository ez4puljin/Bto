import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../common/db/db.types';
import type { Actor } from '../auth-context';
import { auditLog } from '../schema';

export interface AuditEntry {
  /** Upper-case verb: CREATE, UPDATE, DELETE, POST, LOGIN, LOGIN_FAILED, PASSWORD_SET, … */
  action: string;
  /** The table of the changed row, e.g. `users`. */
  entity: string;
  entityId: string | number;
  before?: unknown;
  after?: unknown;
}

/** Keys never stored in an audit snapshot, at any depth (credentials and their hashes). */
const SECRET_KEY = /password|hash|token|secret/i;

/**
 * A JSON-safe copy of a row for audit_log: drops secret keys, renders dates as ISO strings and
 * Decimal (or anything with toJSON) through toJSON.
 */
export function auditSnapshot(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(auditSnapshot);
  if (value instanceof Set) return [...value].map(auditSnapshot);
  if (typeof value === 'object') {
    const withJson = value as { toJSON?: () => unknown };
    if (typeof withJson.toJSON === 'function') return withJson.toJSON();
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !SECRET_KEY.test(key))
        .map(([key, nested]) => [key, auditSnapshot(nested)]),
    );
  }
  return value;
}

/**
 * Writes audit rows inside the caller's transaction, so an audit row exists exactly when the change
 * it describes committed (ADR-0002 #5). audit_log is append-only at the database level.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, actor: Actor, entry: AuditEntry): Promise<void> {
    await tx.insert(auditLog).values(auditRow(actor, entry));
  }

  /** Many entries of one change (an import), a chunk of rows per statement. */
  async recordMany(tx: Tx, actor: Actor, entries: readonly AuditEntry[]): Promise<void> {
    for (let start = 0; start < entries.length; start += AUDIT_CHUNK) {
      await tx
        .insert(auditLog)
        .values(entries.slice(start, start + AUDIT_CHUNK).map((entry) => auditRow(actor, entry)));
    }
  }
}

/** Rows per multi-row insert: far below the bind-parameter limit of one statement. */
const AUDIT_CHUNK = 1_000;

function auditRow(actor: Actor, entry: AuditEntry) {
  return {
    actorKind: actor.kind,
    actorId: actor.kind === 'STAFF' ? actor.userId : null,
    actorLabel: actor.kind === 'SYSTEM' ? actor.label : null,
    action: entry.action,
    entity: entry.entity,
    entityId: String(entry.entityId),
    before: entry.before === undefined ? null : auditSnapshot(entry.before),
    after: entry.after === undefined ? null : auditSnapshot(entry.after),
    requestId: actor.requestId ?? null,
  };
}
