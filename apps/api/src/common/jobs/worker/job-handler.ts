import type { Job, WorkOptions } from 'pg-boss';
import type { JobName, JobPayloads } from '../job-catalog';

/**
 * One handler per queue. pg-boss delivers at least once, so `handle` must be idempotent.
 * Throwing fails the job; it is retried per the queue policy in the job registry.
 */
export interface JobHandler<N extends JobName> {
  readonly name: N;
  readonly workOptions: WorkOptions;
  /**
   * A cron expression in Ulaanbaatar time for a job the worker sends itself (ADR-0040); the
   * schedule is written each time the worker starts.
   */
  readonly cron?: string;
  handle(job: Job<JobPayloads[N]>): Promise<unknown>;
}
