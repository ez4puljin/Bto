import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { PhoneReconcileFlowService } from '../services/phone-reconcile-flow.service';

/**
 * phoneagent.reconcile: one ended call's transcript against the provider's (ADR-0232 #3). A
 * conversation the provider has not finished throws, and the queue tries again a minute later.
 */
@Injectable()
export class PhoneAgentReconcileJob implements JobHandler<'phoneagent.reconcile'> {
  readonly name = 'phoneagent.reconcile' as const;
  readonly workOptions = { pollingIntervalSeconds: 5 };

  constructor(private readonly flow: PhoneReconcileFlowService) {}

  async handle(job: Job<JobPayloads['phoneagent.reconcile']>) {
    return { callId: job.data.callId, ...(await this.flow.reconcile(job.data.callId)) };
  }
}
