import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ImportsHousekeepingService } from '../services/imports-housekeeping.service';

/**
 * imports.housekeeping, every night at 04:00 Ulaanbaatar time (ADR-0040): before identity's at
 * 04:30, so the bytes of the sheets it deletes go the same night.
 */
@Injectable()
export class ImportsHousekeepingJob implements JobHandler<'imports.housekeeping'> {
  readonly name = 'imports.housekeeping' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '0 4 * * *';
  private readonly logger = new Logger('Imports');

  constructor(private readonly housekeeping: ImportsHousekeepingService) {}

  async handle() {
    const result = await this.housekeeping.run();
    this.logger.log(result, 'imports housekeeping done');
    return result;
  }
}
