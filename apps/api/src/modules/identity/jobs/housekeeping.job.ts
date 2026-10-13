import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { HousekeepingService } from '../services/housekeeping.service';

/**
 * identity.housekeeping, every night at 04:30 Ulaanbaatar time (ADR-0040): after the imports
 * housekeeping, so the sheets it hands over lose their bytes the same night.
 */
@Injectable()
export class HousekeepingJob implements JobHandler<'identity.housekeeping'> {
  readonly name = 'identity.housekeeping' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '30 4 * * *';
  private readonly logger = new Logger('Identity');

  constructor(private readonly housekeeping: HousekeepingService) {}

  async handle() {
    const result = await this.housekeeping.run();
    this.logger.log(result, 'identity housekeeping done');
    return result;
  }
}
