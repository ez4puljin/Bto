import type { Db, Tx } from './db.types';
import { DEADLOCK_ATTEMPTS, inTransaction, isDeadlock, transactionStats } from './transaction';

/** The driver's deadlock error, wrapped the way Drizzle wraps a failed query. */
const deadlock = () =>
  new Error('Failed query: update …', {
    cause: Object.assign(new Error('deadlock detected'), { code: '40P01', severity: 'ERROR' }),
  });

/** A database whose `transaction` fails with the given errors in turn, then runs the work. */
function fakeDb(failures: Error[], extra: Record<string, unknown> = {}) {
  let calls = 0;
  const db = {
    ...extra,
    async transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
      calls += 1;
      const failure = failures.shift();
      if (failure !== undefined) throw failure;
      return work({} as Tx);
    },
  };
  return { db: db as unknown as Db, calls: () => calls };
}

describe('inTransaction', () => {
  it('knows a deadlock through the wrapped cause, and nothing else', () => {
    expect(isDeadlock(deadlock())).toBe(true);
    expect(isDeadlock(Object.assign(new Error('x'), { code: '40P01' }))).toBe(true);
    expect(isDeadlock(Object.assign(new Error('x'), { code: '23505' }))).toBe(false);
    expect(isDeadlock(new Error('deadlock detected'))).toBe(false);
    expect(isDeadlock(null)).toBe(false);
    expect(isDeadlock('40P01')).toBe(false);
  });

  it('runs the work again after a deadlock and returns its outcome', async () => {
    const before = transactionStats.deadlockRetries;
    const { db, calls } = fakeDb([deadlock(), deadlock()]);
    let ran = 0;
    const outcome = await inTransaction(db, () => {
      ran += 1;
      return Promise.resolve('done');
    });
    expect(outcome).toBe('done');
    expect(calls()).toBe(3);
    // The two attempts PostgreSQL ended never reached the work in this fake; the third did.
    expect(ran).toBe(1);
    expect(transactionStats.deadlockRetries).toBe(before + 2);
  });

  it('gives the deadlock to the caller after the last attempt', async () => {
    const failures = Array.from({ length: DEADLOCK_ATTEMPTS + 1 }, deadlock);
    const { db, calls } = fakeDb(failures);
    await expect(inTransaction(db, () => Promise.resolve(1))).rejects.toMatchObject({
      cause: { code: '40P01' },
    });
    expect(calls()).toBe(DEADLOCK_ATTEMPTS);
  });

  it('never runs again for another error', async () => {
    const unique = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { db, calls } = fakeDb([unique]);
    await expect(inTransaction(db, () => Promise.resolve(1))).rejects.toBe(unique);
    expect(calls()).toBe(1);
    const thrown = new Error('a business refusal');
    const second = fakeDb([]);
    await expect(inTransaction(second.db, () => Promise.reject(thrown))).rejects.toBe(thrown);
    expect(second.calls()).toBe(1);
  });

  it('does not run a savepoint again: the outer transaction is already lost', async () => {
    const { db, calls } = fakeDb([deadlock()], { rollback: () => undefined });
    await expect(inTransaction(db, () => Promise.resolve(1))).rejects.toMatchObject({
      cause: { code: '40P01' },
    });
    expect(calls()).toBe(1);
  });
});
