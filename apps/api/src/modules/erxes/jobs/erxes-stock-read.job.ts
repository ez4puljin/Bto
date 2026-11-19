import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ErxesStockRunFlowService } from '../services/erxes-stock-run-flow.service';

/**
 * erxes.stockRead: one read of Erkhet's balances by location through erxes, started by
 * «Үлдэгдэл татах» (ADR-0221). Nothing here writes stock or erxes.
 */
@Injectable()
export class ErxesStockReadJob implements JobHandler<'erxes.stockRead'> {
  readonly name = 'erxes.stockRead' as const;
  readonly workOptions = { pollingIntervalSeconds: 2 };

  constructor(private readonly flow: ErxesStockRunFlowService) {}

  async handle(job: Job<JobPayloads['erxes.stockRead']>) {
    return { runId: job.data.runId, ...(await this.flow.execute(job.data.runId)) };
  }
}
