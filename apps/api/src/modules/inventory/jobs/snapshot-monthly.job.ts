import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { StockPostingService } from '../services/stock-posting.service';

/**
 * inventory.snapshotMonthly, on the first of each month at 03:30 Ulaanbaatar time (ADR-0040): the
 * snapshot partitions first (24 months ahead, 13 months kept), then the month's bin snapshot (D9).
 */
@Injectable()
export class SnapshotMonthlyJob implements JobHandler<'inventory.snapshotMonthly'> {
  readonly name = 'inventory.snapshotMonthly' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '30 3 1 * *';
  private readonly logger = new Logger('Inventory');

  constructor(private readonly posting: StockPostingService) {}

  async handle() {
    const partitions = await this.posting.maintainSnapshotPartitions();
    const snapshot = await this.posting.snapshotBins();
    this.logger.log({ ...partitions, ...snapshot }, 'monthly stock snapshot written');
    return { ...partitions, ...snapshot };
  }
}
