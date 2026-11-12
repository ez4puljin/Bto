import type { Db, Tx } from './db.types';

type IsolationLevel = 'read committed' | 'repeatable read' | 'serializable';

/** SQLSTATE `deadlock_detected`: PostgreSQL ended this transaction to break a cycle of row locks. */
const DEADLOCK = '40P01';

/** How many times one piece of work is run before a deadlock is the caller's error (ADR-0190). */
export const DEADLOCK_ATTEMPTS = 4;

/** Deadlocks met and run again since the process started (the server panel may show it). */
export const transactionStats = { deadlockRetries: 0 };

/** A deadlock anywhere in the error's `cause` chain (Drizzle wraps the driver's error). */
export function isDeadlock(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 6 && typeof current === 'object' && current !== null; depth += 1) {
    if ((current as { code?: unknown }).code === DEADLOCK) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** A short, uneven wait, so the transactions that met do not meet again in the same order. */
const pause = (attempt: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, 20 * attempt + Math.random() * 60));

/**
 * Runs `work` in one transaction (READ COMMITTED unless stated). Pass `tx` explicitly to every service
 * call that must be atomic; never make HTTP calls inside `work` (ADR-0002 #8).
 *
 * When PostgreSQL ends the transaction to break a deadlock, nothing of it was written, and `work` is
 * run again in a new transaction, up to `DEADLOCK_ATTEMPTS` times (ADR-0190). So `work` may run more
 * than once: it must not count or collect into anything outside itself (return the outcome
 * instead). Every other error is the caller's at once.
 */
export async function inTransaction<T>(
  db: Db,
  work: (tx: Tx) => Promise<T>,
  isolationLevel: IsolationLevel = 'read committed',
): Promise<T> {
  // Inside another transaction this would be a savepoint, and a deadlock ends the whole outer
  // transaction: there is nothing to run again from here.
  const nested = typeof (db as { rollback?: unknown }).rollback === 'function';
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await db.transaction(work, { isolationLevel });
    } catch (error) {
      if (nested || attempt >= DEADLOCK_ATTEMPTS || !isDeadlock(error)) throw error;
      transactionStats.deadlockRetries += 1;
      await pause(attempt);
    }
  }
}
