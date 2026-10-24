import { Injectable } from '@nestjs/common';
import type { JobHandler } from '../../../common/jobs/worker/job-handler';
import { RefreshService } from '../services/refresh.service';

/**
 * reporting.refresh, every 15 minutes (ADR-0108 #6): rebuilds the daily sales totals
 * `reporting.mv_sales_daily` the dashboard and the reports read; a run that finds another one
 * holding the lock returns at once.
 */
@Injectable()
export class ReportingRefreshJob implements JobHandler<'reporting.refresh'> {
  readonly name = 'reporting.refresh' as const;
  readonly workOptions = { pollingIntervalSeconds: 30 };
  readonly cron = '*/15 * * * *';

  constructor(private readonly refresher: RefreshService) {}

  async handle() {
    const state = await this.refresher.refresh();
    return { refreshedAt: state.refreshedAt?.toISOString() ?? null, durationMs: state.durationMs };
  }
}
