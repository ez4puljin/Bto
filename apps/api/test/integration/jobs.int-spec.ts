import type { INestApplicationContext } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Client } from 'pg';
import type { PgBoss } from 'pg-boss';
import { DB } from '../../src/common/db/db.tokens';
import type { Db } from '../../src/common/db/db.types';
import { inTransaction } from '../../src/common/db/transaction';
import { JobsService } from '../../src/common/jobs/jobs.service';
import { PG_BOSS } from '../../src/common/jobs/pg-boss.provider';
import { connectAs, createHttpApp, createWorker, waitFor } from '../harness/apps';

const countPings = async (client: Client, note: string): Promise<number> => {
  const { rows } = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM pgboss.job WHERE name = 'system.ping' AND data->>'note' = $1`,
    [note],
  );
  return Number.parseInt(rows[0]?.count ?? '0', 10);
};

describe('transactional enqueue (ADR-0013)', () => {
  let app: NestExpressApplication;
  let observer: Client;
  let jobs: JobsService;
  let db: Db;

  beforeAll(async () => {
    app = await createHttpApp();
    jobs = app.get(JobsService);
    db = app.get<Db>(DB);
    observer = await connectAs('app');
  });
  afterAll(async () => {
    await observer.end();
    await app.close();
  });

  it('a job enqueued in a transaction appears only when it commits', async () => {
    let seenBeforeCommit = -1;
    const id = await inTransaction(db, async (tx) => {
      const jobId = await jobs.enqueue(tx, 'system.ping', {
        requestedAt: new Date().toISOString(),
        note: 'commit',
      });
      seenBeforeCommit = await countPings(observer, 'commit');
      return jobId;
    });
    expect(id).toEqual(expect.any(String));
    expect(seenBeforeCommit).toBe(0);
    expect(await countPings(observer, 'commit')).toBe(1);
  });

  it('a job enqueued in a transaction that fails never exists', async () => {
    await expect(
      inTransaction(db, async (tx) => {
        await jobs.enqueue(tx, 'system.ping', {
          requestedAt: new Date().toISOString(),
          note: 'rollback',
        });
        throw new Error('business write failed');
      }),
    ).rejects.toThrow('business write failed');
    expect(await countPings(observer, 'rollback')).toBe(0);
  });

  describe('worker', () => {
    let worker: INestApplicationContext;

    beforeAll(async () => {
      worker = await createWorker();
    });
    afterAll(async () => {
      await worker.close();
    });

    it('handles system.ping and completes it with a pong', async () => {
      const requestedAt = new Date().toISOString();
      const id = await inTransaction(db, (tx) =>
        jobs.enqueue(tx, 'system.ping', { requestedAt, note: 'worker' }),
      );
      expect(id).toEqual(expect.any(String));
      const boss = worker.get<PgBoss>(PG_BOSS);
      const job = await waitFor(async () => {
        const [found] = await boss.findJobs<{ requestedAt: string }>('system.ping', {
          id: id ?? '',
        });
        return found?.state === 'completed' ? found : undefined;
      });
      expect(job.output).toMatchObject({ pong: true, requestedAt });
    });
  });
});
