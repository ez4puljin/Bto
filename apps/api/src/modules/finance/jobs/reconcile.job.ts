import { Injectable, Logger } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { ArLedgerService } from '../services/ar-ledger.service';

/**
 * finance.reconcile, every night at 03:15 Ulaanbaatar time (ADR-0060 #4): the receivables cache
 * against the ledger and the invoices. A drift is recorded in its run and logged as an error; the
 * cache is rewritten either way, which also moves the overdue amounts with the calendar.
 */
@Injectable()
export class FinanceReconcileJob implements JobHandler<'finance.reconcile'> {
  readonly name = 'finance.reconcile' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '15 3 * * *';
  private readonly logger = new Logger('Finance');

  constructor(private readonly ledger: ArLedgerService) {}

  async handle() {
    const run = await this.ledger.reconcile('NIGHTLY');
    if (run.status === 'DRIFT') {
      this.logger.error(
        { runId: run.id, drifted: run.drifted },
        'receivables reconciliation drift',
      );
    }
    return { runId: run.id, status: run.status, checked: run.checked, drifted: run.drifted };
  }
}
