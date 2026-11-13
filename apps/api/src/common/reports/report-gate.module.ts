import { Global, Module } from '@nestjs/common';
import { ReportGateInterceptor, ReportGateService } from './report-gate.interceptor';

/** The gate of the reports (ADR-0193), one per process, for every module's report controllers. */
@Global()
@Module({
  providers: [ReportGateService, ReportGateInterceptor],
  exports: [ReportGateService, ReportGateInterceptor],
})
export class ReportGateModule {}
