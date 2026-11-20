import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { PhoneReconcileFlowService } from '../services/phone-reconcile-flow.service';

/**
 * phoneagent.sweep: every five minutes, the calls the bridge never ended are closed after fifteen
 * minutes and handed to the reconcile (ADR-0232 #3).
 */
@Injectable()
export class PhoneAgentSweepJob implements JobHandler<'phoneagent.sweep'> {
  readonly name = 'phoneagent.sweep' as const;
  readonly workOptions = { pollingIntervalSeconds: 30 };
  readonly cron = '*/5 * * * *';

  constructor(private readonly flow: PhoneReconcileFlowService) {}

  handle() {
    return this.flow.sweep();
  }
}
