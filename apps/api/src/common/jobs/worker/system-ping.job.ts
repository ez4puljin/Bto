import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../job-registry';
import type { JobHandler } from './job-handler';

/** Infrastructure probe: completes with a pong so tests and operators can see the worker running. */
@Injectable()
export class SystemPingJob implements JobHandler<'system.ping'> {
  readonly name = 'system.ping' as const;
  readonly workOptions = { pollingIntervalSeconds: 1 };

  handle(job: Job<JobPayloads['system.ping']>) {
    return Promise.resolve({
      pong: true as const,
      requestedAt: job.data.requestedAt,
      handledAt: new Date().toISOString(),
    });
  }
}
