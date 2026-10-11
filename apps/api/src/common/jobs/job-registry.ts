import type { Queue } from 'pg-boss';

/**
 * The pg-boss job registry (ADR-0013). Names are `<module>.<verb>`; the canonical list lives in the
 * "Exposes" column of docs/architecture.md §4. Add the name there and here before writing a handler.
 * `pnpm db:migrate` creates or updates every queue below (ADR-0024).
 */
export const PGBOSS_SCHEMA = 'pgboss';

export interface JobPayloads {
  /** Infrastructure probe: proves api enqueue -> worker handling end to end. */
  'system.ping': { requestedAt: string; note?: string };
  /** Read and check an uploaded import sheet (ADR-0036 #1–2). */
  'imports.validate': { jobId: number };
  /** Apply a checked import in one transaction (ADR-0036 #3). */
  'imports.commit': { jobId: number };
  /** Take back the most recent committed import (ADR-0036 #7). */
  'imports.revert': { jobId: number };
}

export type JobName = keyof JobPayloads;

function importQueue(retryLimit: number, expireInSeconds: number): Omit<Queue, 'name'> {
  return {
    policy: 'exclusive',
    retryLimit,
    retryDelay: 10,
    expireInSeconds,
    heartbeatSeconds: 60,
    retentionSeconds: 7 * 86_400,
    deleteAfterSeconds: 7 * 86_400,
  };
}

export const JOB_QUEUES: Readonly<Record<JobName, Omit<Queue, 'name'>>> = {
  'system.ping': {
    policy: 'standard',
    retryLimit: 1,
    retryDelay: 5,
    expireInSeconds: 60,
    retentionSeconds: 3_600,
    deleteAfterSeconds: 3_600,
  },
  // One job per import (singletonKey = the import id); a crashed worker is noticed by the heartbeat.
  'imports.validate': importQueue(2, 900),
  'imports.commit': importQueue(1, 3_600),
  'imports.revert': importQueue(1, 3_600),
};

export const JOB_NAME_PATTERN = /^[a-z]+\.[a-z][A-Za-z]*$/;
