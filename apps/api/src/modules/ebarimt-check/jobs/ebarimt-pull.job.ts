import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { systemActor } from '../../identity';
import { EbarimtPullFlowService } from '../services/ebarimt-pull-flow.service';

/**
 * ebarimtcheck.pull, every night at 01:30 Ulaanbaatar time (ADR-0228 #3): when the switch is on,
 * this month's purchase receipts up to yesterday from e-Barimt's API, and the month before while
 * today is the 1st to the 10th. The real service answers only between 01:00 and 07:00. A second
 * delivery pulls again and adds nothing when nothing changed.
 */
@Injectable()
export class EbarimtPullJob implements JobHandler<'ebarimtcheck.pull'> {
  readonly name = 'ebarimtcheck.pull' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '30 1 * * *';

  constructor(private readonly flow: EbarimtPullFlowService) {}

  handle() {
    return this.flow.pullNightly(systemActor('job:ebarimtcheck.pull'));
  }
}
