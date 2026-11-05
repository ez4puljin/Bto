import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { EngagementController } from './controllers/engagement.controller';
import { AttendanceController, HrSetupController } from './controllers/hr.controller';
import { WorkforceController } from './controllers/workforce.controller';
import { AttendanceService } from './services/attendance.service';
import { EngagementService } from './services/engagement.service';
import { HrExportsService } from './services/hr-exports.service';
import { HrSettingsService } from './services/hr-settings.service';
import { HrInsightsService } from './services/insights.service';
import { HrReportsService } from './services/reports.service';
import { RequestsService } from './services/requests.service';
import { WorkforceService } from './services/workforce.service';
import { WorkSitesService } from './services/work-sites.service';

/**
 * HR (docs/modules/hr.md, ADR-0131): attendance from the staff app — the work sites, the company
 * schedule and each employee's terms, the punches and what the dashboard makes of them. Depends on
 * identity alone; nobody imports it.
 */
@Module({
  imports: [IdentityModule],
  providers: [
    WorkSitesService,
    HrSettingsService,
    AttendanceService,
    WorkforceService,
    RequestsService,
    HrReportsService,
  ],
  exports: [
    WorkSitesService,
    HrSettingsService,
    AttendanceService,
    WorkforceService,
    RequestsService,
    HrReportsService,
  ],
})
export class HrModule {}

/** The HTTP side of hr (api only). */
@Module({
  imports: [HrModule, IdentityModule],
  controllers: [HrSetupController, AttendanceController, WorkforceController, EngagementController],
  providers: [HrExportsService, EngagementService, HrInsightsService],
})
export class HrHttpModule {}
