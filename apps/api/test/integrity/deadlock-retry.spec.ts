import type { NestExpressApplication } from '@nestjs/platform-express';
import { sql } from 'drizzle-orm';
import { DB } from '../../src/common/db/db.tokens';
import type { Db, Tx } from '../../src/common/db/db.types';
import { inTransaction, transactionStats } from '../../src/common/db/transaction';
import { createHttpApp } from '../harness/apps';

/**
 * ADR-0190 against a real PostgreSQL: two transactions take the same two rows in opposite order,
 * each waiting until the other holds its first row, so the server must end one of them
 * (`deadlock_detected`, 40P01). `inTransaction` runs that one again and both finish; nobody sees
 * an error. Without the retry this is the «Internal error» the load test of 2026-11-13 met when
 * many orders moved at once.
 */
describe('a transaction ended by a deadlock is run again', () => {
  let app: NestExpressApplication;
  let db: Db;

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
  });
  afterAll(async () => {
    await app.close();
  });

  it('lets both of two opposite lockers finish, one of them at its second run', async () => {
    const found = await db.execute<{ id: string }>(
      sql`SELECT id::text FROM uoms ORDER BY id LIMIT 2`,
    );
    const [first, second] = found.rows.map((row) => row.id);
    if (!first || !second) throw new Error('two units of measure are needed');
    const lock = (tx: Tx, id: string) =>
      tx.execute(sql`SELECT id FROM uoms WHERE id = ${id}::bigint FOR UPDATE`);

    let aHolds: () => void = () => undefined;
    let bHolds: () => void = () => undefined;
    const aHolding = new Promise<void>((resolve) => (aHolds = resolve));
    const bHolding = new Promise<void>((resolve) => (bHolds = resolve));
    // Counted outside on purpose: the test wants to see the second run.
    const runs = { a: 0, b: 0 };
    const before = transactionStats.deadlockRetries;

    const a = inTransaction(db, async (tx) => {
      runs.a += 1;
      await lock(tx, first);
      aHolds();
      await bHolding;
      await lock(tx, second);
      return 'a';
    });
    const b = inTransaction(db, async (tx) => {
      runs.b += 1;
      await lock(tx, second);
      bHolds();
      await aHolding;
      await lock(tx, first);
      return 'b';
    });

    await expect(Promise.all([a, b])).resolves.toEqual(['a', 'b']);
    // PostgreSQL ended exactly one of the two, and that one ran twice.
    expect(runs.a + runs.b).toBe(3);
    expect(transactionStats.deadlockRetries).toBe(before + 1);
  }, 30_000);

  it('still gives a business error to the caller at once', async () => {
    let ran = 0;
    await expect(
      inTransaction(db, async (tx) => {
        ran += 1;
        await tx.execute(sql`SELECT 1`);
        throw new Error('refused');
      }),
    ).rejects.toThrow('refused');
    expect(ran).toBe(1);
  });
});
