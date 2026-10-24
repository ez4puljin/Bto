import {
  COMMON_JOB_QUEUES,
  type JobName,
  type QueueOptions,
  type ScheduledPayload,
  scheduledQueue,
} from './job-catalog';

/**
 * Bto's jobs and the merged queue map (ADR-0013, ADR-0069 #7). Names are `<module>.<verb>`; the
 * canonical list lives in the "Exposes" column of docs/architecture.md §4. Add the name there and
 * here before writing a handler. `pnpm db:migrate` creates or updates every queue below (ADR-0024).
 */
export {
  JOB_NAME_PATTERN,
  type JobName,
  type JobPayloads,
  PGBOSS_SCHEMA,
  type ScheduledPayload,
} from './job-catalog';

declare module './job-catalog' {
  interface JobPayloads {
    /** Read and check an uploaded import sheet (ADR-0036 #1–2). */
    'imports.validate': { jobId: number };
    /** Apply a checked import in one transaction (ADR-0036 #3). */
    'imports.commit': { jobId: number };
    /** Take back the most recent committed import (ADR-0036 #7). */
    'imports.revert': { jobId: number };
    /** Nightly: the ledger against both balance caches and the day's warehouse snapshot (D10). */
    'inventory.reconcile': ScheduledPayload;
    /** First night of a month: the snapshot partitions and the bin snapshot (D9). */
    'inventory.snapshotMonthly': ScheduledPayload;
    /** Nightly: old sessions, password codes and idempotency keys; abandoned and deleted files. */
    'identity.housekeeping': ScheduledPayload;
    /** Nightly: the rows of old unsuccessful imports and sheets past their retention. */
    'imports.housekeeping': ScheduledPayload;
    /** Nightly: the receivables cache against the ledger and the invoices (ADR-0060 #4). */
    'finance.reconcile': ScheduledPayload;
    /** Mornings: the customer app's «due soon» and «overdue» invoice reminders (ADR-0079 #8). */
    'notifications.invoiceReminders': ScheduledPayload;
    /** Every 15 minutes: the daily sales totals of the management reports (ADR-0108 #6). */
    'reporting.refresh': ScheduledPayload;
  }
}

function importQueue(retryLimit: number, expireInSeconds: number): QueueOptions {
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

/** Bto's queues. */
const BTO_JOB_QUEUES = {
  // One job per import (singletonKey = the import id); a crashed worker is noticed by the heartbeat.
  'imports.validate': importQueue(2, 900),
  'imports.commit': importQueue(1, 3_600),
  'imports.revert': importQueue(1, 3_600),
  'inventory.reconcile': scheduledQueue(),
  'inventory.snapshotMonthly': scheduledQueue(),
  'identity.housekeeping': scheduledQueue(),
  'imports.housekeeping': scheduledQueue(),
  'finance.reconcile': scheduledQueue(),
  'notifications.invoiceReminders': scheduledQueue(),
  'reporting.refresh': scheduledQueue(),
} as const satisfies Readonly<Partial<Record<JobName, QueueOptions>>>;

/** Every owner's queues: a job name without a queue fails typecheck. */
export const JOB_QUEUES: Readonly<Record<JobName, QueueOptions>> = {
  ...COMMON_JOB_QUEUES,
  ...BTO_JOB_QUEUES,
};
