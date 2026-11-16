import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { systemActor } from '../../identity';
import { ErkhetSyncService } from '../services/erkhet-sync.service';

/**
 * erkhet.nightly, every night at 04:40 Ulaanbaatar time (ADR-0203 #5): starts the day's check when
 * a sign-in is saved and the switch is on. Once a day, however often it is delivered.
 */
@Injectable()
export class ErkhetNightlyJob implements JobHandler<'erkhet.nightly'> {
  readonly name = 'erkhet.nightly' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '40 4 * * *';

  constructor(private readonly sync: ErkhetSyncService) {}

  handle() {
    return this.sync.startNightly(systemActor('job:erkhet.nightly'));
  }
}
