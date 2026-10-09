import type { Job, WorkOptions } from 'pg-boss';
import type { JobName, JobPayloads } from '../job-registry';

/**
 * One handler per queue. pg-boss delivers at least once, so `handle` must be idempotent.
 * Throwing fails the job; it is retried per the queue policy in the job registry.
 */
export interface JobHandler<N extends JobName> {
  readonly name: N;
  readonly workOptions: WorkOptions;
  handle(job: Job<JobPayloads[N]>): Promise<unknown>;
}
