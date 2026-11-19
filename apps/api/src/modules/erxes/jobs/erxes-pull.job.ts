import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ErxesPullFlowService } from '../services/erxes-pull-flow.service';

/**
 * erxes.pull, every minute (ADR-0218 #8): reads the new deals of the ticked pipelines and tries
 * the waiting ones again. Nothing happens while the switch on the settings page is off. A run
 * that meets another is harmless: a deal is one row and one order however often it is read.
 */
@Injectable()
export class ErxesPullJob implements JobHandler<'erxes.pull'> {
  readonly name = 'erxes.pull' as const;
  readonly workOptions = { pollingIntervalSeconds: 5 };
  readonly cron = '* * * * *';

  constructor(private readonly flow: ErxesPullFlowService) {}

  handle() {
    return this.flow.scheduled();
  }
}
