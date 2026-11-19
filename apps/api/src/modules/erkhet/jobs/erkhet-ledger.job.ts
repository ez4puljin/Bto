import { Injectable } from '@nestjs/common';
import type { Job } from 'pg-boss';
import type { JobPayloads } from '../../../common/jobs/job-registry';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { systemActor } from '../../identity';
import { ErkhetLedgerFlowService } from '../services/erkhet-ledger-flow.service';
import { ErkhetLedgerService } from '../services/erkhet-ledger.service';

/** erkhet.ledger: one run of the copy of Erkhet's receivable and payable transactions (ADR-0219). */
@Injectable()
export class ErkhetLedgerJob implements JobHandler<'erkhet.ledger'> {
  readonly name = 'erkhet.ledger' as const;
  readonly workOptions = { pollingIntervalSeconds: 2 };

  constructor(private readonly flow: ErkhetLedgerFlowService) {}

  async handle(job: Job<JobPayloads['erkhet.ledger']>) {
    return { runId: job.data.runId, ...(await this.flow.execute(job.data.runId)) };
  }
}

/**
 * erkhet.ledgerNightly, every night at 03:10 Ulaanbaatar time (ADR-0219): keeps Bto's books up with
 * Erkhet once «Bto-д оруулах» ran. Before the check of 04:40, so the two never sign in at once.
 */
@Injectable()
export class ErkhetLedgerNightlyJob implements JobHandler<'erkhet.ledgerNightly'> {
  readonly name = 'erkhet.ledgerNightly' as const;
  readonly workOptions = { pollingIntervalSeconds: 10 };
  readonly cron = '10 3 * * *';

  constructor(private readonly ledger: ErkhetLedgerService) {}

  handle() {
    return this.ledger.startNightly(systemActor('job:erkhet.ledgerNightly'));
  }
}
