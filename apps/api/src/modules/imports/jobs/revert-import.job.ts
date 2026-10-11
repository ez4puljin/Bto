import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ImportPipelineService } from '../services/import-pipeline.service';

/** imports.revert: takes back the most recent committed import (ADR-0036 #7). */
@Injectable()
export class RevertImportJob implements JobHandler<'imports.revert'> {
  readonly name = 'imports.revert' as const;
  readonly workOptions = { pollingIntervalSeconds: 1 };

  constructor(private readonly pipeline: ImportPipelineService) {}

  async handle(job: Job<JobPayloads['imports.revert']>) {
    await this.pipeline.revert(job.data.jobId);
    return { jobId: job.data.jobId };
  }
}
