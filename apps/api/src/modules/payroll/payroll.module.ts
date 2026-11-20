import { Module } from '@nestjs/common';
import { HrModule } from '../hr';
import { IdentityModule } from '../identity';
import { PayrollController } from './controllers/payroll.controller';
import { PayrollAdvancesService } from './services/payroll-advances.service';
import { PayrollExportsService } from './services/payroll-exports.service';
import { PayrollPeopleService } from './services/payroll-people.service';
import { PayrollRunsService } from './services/payroll-runs.service';
import { PayrollSettingsService } from './services/payroll-settings.service';
import { PayrollTermsService } from './services/payroll-terms.service';

/**
 * Payroll with KPI evaluation (docs/modules/payroll.md, ADR-0235): the rates, KPI templates, each
 * employee's pay terms, advances and the monthly runs. Depends on identity and hr (the staff list
 * and the time report's days); nobody imports it.
 */
@Module({
  imports: [IdentityModule, HrModule],
  providers: [
    PayrollPeopleService,
    PayrollSettingsService,
    PayrollTermsService,
    PayrollRunsService,
    PayrollAdvancesService,
  ],
  exports: [
    PayrollSettingsService,
    PayrollTermsService,
    PayrollRunsService,
    PayrollAdvancesService,
  ],
})
export class PayrollModule {}

/** The HTTP side of payroll (api only). */
@Module({
  imports: [PayrollModule, IdentityModule],
  controllers: [PayrollController],
  providers: [PayrollExportsService],
})
export class PayrollHttpModule {}
