import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  TrialBalanceDto,
  TrialBalanceQueryDto,
  VatReportDto,
  VatReportQueryDto,
  YearCloseStatusDto,
} from '../dto/finance.dto';
import { ReportsService, type YearCloseStatus } from '../services/reports.service';
import { money } from './mappers';

function year(value: number): number {
  if (value < 2000 || value > 2100) throw invalid('year', 'range', 'a year from 2000 to 2100');
  return value;
}

function yearDto(status: YearCloseStatus): YearCloseStatusDto {
  return {
    year: status.year,
    ended: status.ended,
    documents: status.documents,
    income: money(status.income),
    expense: money(status.expense),
    profit: money(status.profit),
  };
}

/**
 * The reports of F6 (ADR-0105): the trial balance and the month's VAT on screen and in Excel
 * (`finance.read`), and the year close into retained earnings with its revert
 * (`finance.periods.close`).
 */
@ApiTags('finance')
@Controller('finance')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('reports/trial-balance')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: TrialBalanceDto })
  async trialBalance(
    @CurrentUser() ctx: AuthContext,
    @Query() query: TrialBalanceQueryDto,
  ): Promise<TrialBalanceDto> {
    const report = await this.reports.trialBalance(ctx, query);
    return {
      from: report.from,
      to: report.to,
      data: report.rows.map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        kind: row.kind,
        status: row.status,
        groupCode: row.group?.code ?? null,
        groupName: row.group?.name ?? null,
        opening: money(row.opening),
        debit: money(row.debit),
        credit: money(row.credit),
        closing: money(row.closing),
      })),
      opening: money(report.totals.opening),
      debit: money(report.totals.debit),
      credit: money(report.totals.credit),
      closing: money(report.totals.closing),
    };
  }

  @Get('reports/trial-balance.xlsx')
  @RequirePermission('finance.read')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async trialBalanceXlsx(
    @CurrentUser() ctx: AuthContext,
    @Query() query: TrialBalanceQueryDto,
  ): Promise<StreamableFile> {
    return xlsxFile(
      await this.reports.trialBalanceWorkbook(ctx, query),
      `trial-balance-${query.from}-${query.to}`,
      `${mn.finance.reports.trialBalance.title} ${query.from} – ${query.to}`,
    );
  }

  @Get('reports/vat')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: VatReportDto })
  async vat(
    @CurrentUser() ctx: AuthContext,
    @Query() query: VatReportQueryDto,
  ): Promise<VatReportDto> {
    const report = await this.reports.vat(ctx, query.period);
    return {
      period: report.period,
      from: report.from,
      to: report.to,
      groups: report.groups.map((group) => ({
        ...group,
        vat: money(group.vat),
        base: money(group.base),
      })),
      documents: report.documents.map((row) => ({
        entryId: row.entryId,
        entryNumber: row.entryNumber,
        entryDate: row.entryDate,
        system: row.system,
        docType: row.docType,
        documentNumber: row.documentNumber,
        reversal: row.reversal,
        output: money(row.output),
        input: money(row.input),
        base: money(row.base),
      })),
      truncated: report.truncated,
      output: money(report.output),
      input: money(report.input),
      payable: money(report.payable),
    };
  }

  @Get('reports/vat.xlsx')
  @RequirePermission('finance.read')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async vatXlsx(
    @CurrentUser() ctx: AuthContext,
    @Query() query: VatReportQueryDto,
  ): Promise<StreamableFile> {
    return xlsxFile(
      await this.reports.vatWorkbook(ctx, query.period),
      `vat-${query.period}`,
      `${mn.finance.reports.vat.title} ${query.period}`,
    );
  }

  @Get('year-close/:year')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: YearCloseStatusDto })
  async yearClose(
    @CurrentUser() ctx: AuthContext,
    @Param('year', ParseIntPipe) value: number,
  ): Promise<YearCloseStatusDto> {
    return yearDto(await this.reports.yearCloseStatus(ctx, year(value)));
  }

  @Post('year-close/:year')
  @HttpCode(200)
  @RequirePermission('finance.periods.close')
  @Idempotent()
  @ApiOkResponse({ type: YearCloseStatusDto })
  async closeYear(
    @CurrentUser() ctx: AuthContext,
    @Param('year', ParseIntPipe) value: number,
  ): Promise<YearCloseStatusDto> {
    return yearDto(await this.reports.closeYear(ctx, year(value)));
  }

  @Post('year-close/:year/revert')
  @HttpCode(200)
  @RequirePermission('finance.periods.close')
  @Idempotent()
  @ApiOkResponse({ type: YearCloseStatusDto })
  async revertYear(
    @CurrentUser() ctx: AuthContext,
    @Param('year', ParseIntPipe) value: number,
  ): Promise<YearCloseStatusDto> {
    return yearDto(await this.reports.revertYear(ctx, year(value)));
  }
}
