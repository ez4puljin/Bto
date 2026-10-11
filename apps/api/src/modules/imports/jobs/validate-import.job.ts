import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ImportPipelineService } from '../services/import-pipeline.service';

/** imports.validate: reads and checks an uploaded sheet (ADR-0036 #1–2). */
@Injectable()
export class ValidateImportJob implements JobHandler<'imports.validate'> {
  readonly name = 'imports.validate' as const;
  readonly workOptions = { pollingIntervalSeconds: 1 };

  constructor(private readonly pipeline: ImportPipelineService) {}

  async handle(job: Job<JobPayloads['imports.validate']>) {
    await this.pipeline.validate(job.data.jobId);
    return { jobId: job.data.jobId };
  }
}
