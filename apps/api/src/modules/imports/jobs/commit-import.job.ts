import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ImportPipelineService } from '../services/import-pipeline.service';

/** imports.commit: applies a checked import in one transaction (ADR-0036 #3). */
@Injectable()
export class CommitImportJob implements JobHandler<'imports.commit'> {
  readonly name = 'imports.commit' as const;
  readonly workOptions = { pollingIntervalSeconds: 1 };

  constructor(private readonly pipeline: ImportPipelineService) {}

  async handle(job: Job<JobPayloads['imports.commit']>) {
    await this.pipeline.commit(job.data.jobId);
    return { jobId: job.data.jobId };
  }
}
