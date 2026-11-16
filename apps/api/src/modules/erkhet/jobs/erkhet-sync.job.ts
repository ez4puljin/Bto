import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ErkhetRunFlowService } from '../services/erkhet-run-flow.service';

/** erkhet.sync: one check of Erkhet's lists against Bto's (ADR-0203 #5). */
@Injectable()
export class ErkhetSyncJob implements JobHandler<'erkhet.sync'> {
  readonly name = 'erkhet.sync' as const;
  readonly workOptions = { pollingIntervalSeconds: 2 };

  constructor(private readonly flow: ErkhetRunFlowService) {}

  async handle(job: Job<JobPayloads['erkhet.sync']>) {
    return { runId: job.data.runId, ...(await this.flow.execute(job.data.runId)) };
  }
}
