import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { SmsSendFlowService } from '../services/sms-send-flow.service';

/** notifications.sendSms: one settlement SMS batch through WeSend (ADR-0216). */
@Injectable()
export class SmsSendJob implements JobHandler<'notifications.sendSms'> {
  readonly name = 'notifications.sendSms' as const;
  readonly workOptions = { pollingIntervalSeconds: 2 };

  constructor(private readonly flow: SmsSendFlowService) {}

  async handle(job: Job<JobPayloads['notifications.sendSms']>) {
    return { batchId: job.data.batchId, ...(await this.flow.execute(job.data.batchId)) };
  }
}
