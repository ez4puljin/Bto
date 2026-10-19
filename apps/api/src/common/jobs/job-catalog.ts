import type { Queue } from 'pg-boss';

/**
 * The owner-agnostic half of the pg-boss job registry (ADR-0013, ADR-0069 #7). Every owner adds its
 * jobs to `JobPayloads` by interface merging (`declare module '…/job-catalog'`) and keeps its own
 * queue map; `job-registry.ts` merges Bto's, and the Finance Core's joins when it has jobs (A1).
 * Names are `<owner>.<verb>`; `pnpm db:migrate` creates or updates every merged queue (ADR-0024).
 */
export const PGBOSS_SCHEMA = 'pgboss';

export interface JobPayloads {
  /** Infrastructure probe: proves api enqueue -> worker handling end to end. */
  'system.ping': { requestedAt: string; note?: string };
}

/** Scheduled jobs carry no data: the schedule sends null (ADR-0040). */
export type ScheduledPayload = null;

export type JobName = keyof JobPayloads;

/** A queue's policy, retries, expiry and retention. */
export type QueueOptions = Omit<Queue, 'name'>;

/**
 * Scheduled maintenance (ADR-0040): one run at a time, one retry ten minutes later, a crashed worker
 * noticed by the heartbeat, a run not started within a day dropped (the schedule catches up) and
 * 30 days of history.
 */
export function scheduledQueue(): QueueOptions {
  return {
    policy: 'exclusive',
    retryLimit: 1,
    retryDelay: 600,
    expireInSeconds: 1_800,
    heartbeatSeconds: 60,
    retentionSeconds: 86_400,
    deleteAfterSeconds: 30 * 86_400,
  };
}

/** The platform's own queues. */
export const COMMON_JOB_QUEUES = {
  'system.ping': {
    policy: 'standard',
    retryLimit: 1,
    retryDelay: 5,
    expireInSeconds: 60,
    retentionSeconds: 3_600,
    deleteAfterSeconds: 3_600,
  },
} as const satisfies Readonly<Record<'system.ping', QueueOptions>>;

export const JOB_NAME_PATTERN = /^[a-z]+\.[a-z][A-Za-z]*$/;
