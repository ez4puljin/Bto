import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { IdentityModule } from '../identity';
import { ReportsController } from './controllers/reports.controller';
import { ReportingRefreshJob } from './jobs/refresh.job';
import { AgingService } from './services/aging.service';
import { DashboardService } from './services/dashboard.service';
import { ProfitService } from './services/profit.service';
import { RefreshService } from './services/refresh.service';
import { ReportContext } from './services/report-context';
import { StockReportService } from './services/stock-report.service';
import { SupplierReportService } from './services/supplier-report.service';

/**
 * Management reports (ADR-0108, docs/modules/reporting.md): read only, imported by nobody. Other
 * modules' data through SQL over their tables and the views of schema `reporting` (the Finance
 * Core's only through those views, architecture §3.1 rule 4).
 */
const SERVICES = [
  ReportContext,
  RefreshService,
  DashboardService,
  AgingService,
  ProfitService,
  StockReportService,
  SupplierReportService,
];

@Module({ imports: [IdentityModule], providers: SERVICES, exports: SERVICES })
export class ReportingModule {}

/** The HTTP side of the reports. */
@Module({ imports: [ReportingModule], controllers: [ReportsController] })
export class ReportingHttpModule {}

/** Registers the refresh of the daily totals once the worker has started (worker only). */
@Injectable()
export class ReportingJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly refresh: ReportingRefreshJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.refresh);
  }
}

/** The worker side: the 15-minute refresh of the daily sales totals (ADR-0108 #6). */
@Module({
  imports: [ReportingModule, JobsWorkerModule],
  providers: [ReportingRefreshJob, ReportingJobsBootstrap],
})
export class ReportingWorkerModule {}
