import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { StockPostingService } from '../services/stock-posting.service';

/**
 * inventory.reconcile, every night at 03:00 Ulaanbaatar time (ADR-0040): the ledger against both
 * balance caches and the day's warehouse snapshot (D10). A drift is recorded in its run, shown to
 * admins as a banner and logged as an error; the job itself succeeds.
 */
@Injectable()
export class ReconcileJob implements JobHandler<'inventory.reconcile'> {
  readonly name = 'inventory.reconcile' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '0 3 * * *';
  private readonly logger = new Logger('Inventory');

  constructor(private readonly posting: StockPostingService) {}

  async handle() {
    const run = await this.posting.reconcile('NIGHTLY');
    if (run.status === 'DRIFT') {
      this.logger.error({ runId: run.id, diffCount: run.diffCount }, 'stock reconciliation drift');
    }
    return {
      runId: run.id,
      status: run.status,
      diffCount: run.diffCount,
      snapshotDate: run.snapshotDate,
    };
  }
}
