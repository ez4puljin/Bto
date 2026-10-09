import type { Db, Tx } from './db.types';

type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

/**
 * Runs `work` in one transaction (READ COMMITTED unless stated). Pass `tx` explicitly to every service
 * call that must be atomic; never make HTTP calls inside `work` (ADR-0002 #8).
 */
export function inTransaction<T>(
  db: Db,
  work: (tx: Tx) => Promise<T>,
  isolationLevel: IsolationLevel = 'read committed',
): Promise<T> {
  return db.transaction(work, { isolationLevel });
}
