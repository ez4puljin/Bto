import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { FinCompanyView } from '../../../finance-core';
import { Authenticated, type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { CompanyDto, UpdateCompanyDto } from '../dto/company.dto';
import { FinCompanyBridge } from '../services/company-bridge.service';

const toCompanyDto = (view: FinCompanyView): CompanyDto => ({
  code: view.code,
  legalName: view.legalName,
  registerNo: view.registerNo,
  tin: view.tin,
  functionalCurrency: view.functionalCurrency,
  timezone: view.timezone,
  fiscalYearStartMonth: view.fiscalYearStartMonth,
  status: view.status,
  taxRegistrations: view.taxRegistrations,
  branches: view.branches,
});

/**
 * «Компани» (ADR-0084): the installation's Finance Core company. Every staff member reads it (the
 * print headers carry its name); its legal identity changes with finance.settings.manage, which
 * the core checks again per company.
 */
@ApiTags('company')
@Controller('company')
export class CompanyController {
  constructor(private readonly company: FinCompanyBridge) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: CompanyDto })
  async get(@CurrentUser() ctx: AuthContext): Promise<CompanyDto> {
    return toCompanyDto(await this.company.get(ctx));
  }

  @Patch()
  @RequirePermission('finance.settings.manage')
  @ApiOkResponse({ type: CompanyDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Body() body: UpdateCompanyDto,
  ): Promise<CompanyDto> {
    return toCompanyDto(await this.company.update(ctx, body));
  }
}
