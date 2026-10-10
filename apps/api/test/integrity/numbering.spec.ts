import type { NestExpressApplication } from '@nestjs/platform-express';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { NumberingService } from '../../src/modules/identity';
import { createHttpApp } from '../harness/apps';

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** Gap-free document numbers under concurrency (ADR-0002 #7, SPEC §6.13). */
describe('integrity: gap-free numbering', () => {
  let app: NestExpressApplication;
  let db: Db;
  let numbering: NumberingService;

  beforeAll(async () => {
    app = await createHttpApp();
    db = app.get<Db>(DB);
    numbering = app.get(NumberingService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('20 concurrent allocations return exactly 1..20', async () => {
    const values = await Promise.all(
      range(1, 20).map(() => inTransaction(db, (tx) => numbering.next(tx, 'INT', '2026'))),
    );
    expect(values.sort((a, b) => a - b)).toEqual(range(1, 20));
  });

  it('rolled-back allocations leave no gap among concurrent commits', async () => {
    const results = await Promise.allSettled(
      range(1, 10).map((index) =>
        inTransaction(db, async (tx) => {
          const value = await numbering.next(tx, 'RB', '2026');
          if (index % 2 === 0) throw new Error('rollback');
          return value;
        }),
      ),
    );
    const committed = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value)
      .sort((a, b) => a - b);
    expect(committed).toEqual(range(1, 5));
    expect(await inTransaction(db, (tx) => numbering.next(tx, 'RB', '2026'))).toBe(6);
  });
});
