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
    /** One check of Erkhet's customers and items against Bto's (ADR-0203 #5). */
    'erkhet.sync': { runId: number };
    /** Nights: starts the day's Erkhet check when its sign-in is saved (ADR-0203 #5). */
    'erkhet.nightly': ScheduledPayload;
    /** One run of the copy of Erkhet's receivable and payable transactions (ADR-0219). */
    'erkhet.ledger': { runId: number };
    /** Nights: keeps Bto's books up with Erkhet once the copy was posted (ADR-0219 #7). */
    'erkhet.ledgerNightly': ScheduledPayload;
    /** Every minute: the new deals of erxes's ticked pipelines as draft orders (ADR-0218 #8). */
    'erxes.pull': ScheduledPayload;
    /** One read of Erkhet's balances by location through erxes (ADR-0221). */
    'erxes.stockRead': { runId: number };
    /** Nights at 01:30: a month's purchase receipts from e-Barimt's API, when switched on (ADR-0228). */
    'ebarimtcheck.pull': ScheduledPayload;
    /** Sends one settlement SMS batch through WeSend, message by message (ADR-0216). */
    'notifications.sendSms': { batchId: number };
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
  // One job per check (singletonKey = the run id). No retry: a failed check says why on its row
  // and the person, or the next night, starts another.
  'erkhet.sync': {
    policy: 'exclusive',
    retryLimit: 0,
    expireInSeconds: 1_200,
    heartbeatSeconds: 60,
    retentionSeconds: 7 * 86_400,
    deleteAfterSeconds: 7 * 86_400,
  },
  'erkhet.nightly': scheduledQueue(),
  // One job per run of the ledger copy (singletonKey = the run id). No retry: a failed run says why
  // on its row, and the next one goes on where it stopped. The first check reads Erkhet's whole
  // history and the addresses follow a run, so it may take long.
  'erkhet.ledger': {
    policy: 'exclusive',
    retryLimit: 0,
    expireInSeconds: 7_200,
    heartbeatSeconds: 60,
    retentionSeconds: 7 * 86_400,
    deleteAfterSeconds: 7 * 86_400,
  },
  'erkhet.ledgerNightly': scheduledQueue(),
  // Every minute, one run at a time. No retry: the next minute reads what this one missed, and a
  // run not started within ten minutes is dropped.
  'erxes.pull': {
    policy: 'exclusive',
    retryLimit: 0,
    expireInSeconds: 600,
    heartbeatSeconds: 60,
    retentionSeconds: 3_600,
    deleteAfterSeconds: 86_400,
  },
  // One job per read (singletonKey = the run id). No retry: a refused call is counted on the run,
  // and a run stopped by a restart is closed INTERRUPTED by the next start (ADR-0221).
  'erxes.stockRead': {
    policy: 'exclusive',
    retryLimit: 0,
    expireInSeconds: 3_600,
    heartbeatSeconds: 60,
    retentionSeconds: 7 * 86_400,
    deleteAfterSeconds: 7 * 86_400,
  },
  'ebarimtcheck.pull': scheduledQueue(),
  // One job per batch (singletonKey = the batch id). A retry skips what is no longer QUEUED and
  // resends with each message's own Idempotency-Key, so WeSend never sends a text twice.
  'notifications.sendSms': {
    policy: 'exclusive',
    retryLimit: 2,
    retryDelay: 60,
    expireInSeconds: 3_600,
    heartbeatSeconds: 60,
    retentionSeconds: 7 * 86_400,
    deleteAfterSeconds: 7 * 86_400,
  },
} as const satisfies Readonly<Partial<Record<JobName, QueueOptions>>>;

/** Every owner's queues: a job name without a queue fails typecheck. */
export const JOB_QUEUES: Readonly<Record<JobName, QueueOptions>> = {
  ...COMMON_JOB_QUEUES,
  ...BTO_JOB_QUEUES,
};
