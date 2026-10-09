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
}

export type JobName = keyof JobPayloads;

export const JOB_QUEUES: Readonly<Record<JobName, Omit<Queue, 'name'>>> = {
  'system.ping': {
    policy: 'standard',
    retryLimit: 1,
    retryDelay: 5,
    expireInSeconds: 60,
    retentionSeconds: 3_600,
    deleteAfterSeconds: 3_600,
  },
};

export const JOB_NAME_PATTERN = /^[a-z]+\.[a-z][A-Za-z]*$/;
