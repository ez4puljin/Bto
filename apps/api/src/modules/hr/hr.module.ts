import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity';
import { AttendanceController, HrSetupController } from './controllers/hr.controller';
import { AttendanceService } from './services/attendance.service';
import { HrSettingsService } from './services/hr-settings.service';
import { WorkSitesService } from './services/work-sites.service';

/**
 * HR (docs/modules/hr.md, ADR-0131): attendance from the staff app — the work sites, the company
 * schedule and each employee's terms, the punches and what the dashboard makes of them. Depends on
 * identity alone; nobody imports it.
 */
@Module({
  imports: [IdentityModule],
  providers: [WorkSitesService, HrSettingsService, AttendanceService],
  exports: [WorkSitesService, HrSettingsService, AttendanceService],
})
export class HrModule {}

/** The HTTP side of hr (api only). */
@Module({
  imports: [HrModule],
  controllers: [HrSetupController, AttendanceController],
})
export class HrHttpModule {}
