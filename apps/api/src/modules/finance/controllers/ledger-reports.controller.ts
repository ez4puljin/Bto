import { Controller, Get, Query, StreamableFile, UseInterceptors } from '@nestjs/common';
import { ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import mn from '@tugeel/shared/i18n/mn.json';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import {
  ReportGateInterceptor,
  UngatedReport,
} from '../../../common/reports/report-gate.interceptor';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  LedgerAccountOptionsDto,
  LedgerLinesDto,
  LedgerLinesQueryDto,
  LedgerReportDto,
  LedgerReportQueryDto,
} from '../dto/ledger-reports.dto';
import { LedgerReportsService } from '../services/ledger-reports.service';
import { money } from './mappers';

/**
 * Erkhet's ledger reports (ADR-0133): «Авлага өглөгийн тайлан» (`kind=PARTY`) and «Мөнгөн
 * хөрөнгийн тайлан» (`kind=MONEY`) with the lines behind a row and an Excel copy; `finance.read`.
 */
@ApiTags('finance')
@Controller('finance/reports/ledger')
@UseInterceptors(ReportGateInterceptor)
export class LedgerReportsController {
  constructor(private readonly ledger: LedgerReportsService) {}

  @Get('accounts')
  @UngatedReport()
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: LedgerAccountOptionsDto })
  async accounts(@CurrentUser() ctx: AuthContext): Promise<LedgerAccountOptionsDto> {
    return { data: await this.ledger.accounts(ctx) };
  }

  @Get()
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: LedgerReportDto })
  async report(
    @CurrentUser() ctx: AuthContext,
    @Query() query: LedgerReportQueryDto,
  ): Promise<LedgerReportDto> {
    const report = await this.ledger.report(ctx, query);
    return {
      kind: report.kind,
      from: report.from,
      to: report.to,
      data: report.rows.map((row) => ({
        accountId: row.accountId,
        code: row.code,
        name: row.name,
        control: row.control,
        groupCode: row.groupCode,
        groupName: row.groupName,
        party: row.party,
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

  @Get('lines')
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: LedgerLinesDto })
  async lines(
    @CurrentUser() ctx: AuthContext,
    @Query() query: LedgerLinesQueryDto,
  ): Promise<LedgerLinesDto> {
    const lines = await this.ledger.lines(ctx, query);
    return {
      opening: money(lines.opening),
      truncated: lines.truncated,
      data: lines.rows.map((row) => ({
        lineId: row.lineId,
        entryId: row.entryId,
        entryNumber: row.entryNumber,
        entryDate: row.entryDate,
        entryDescription: row.entryDescription,
        lineDescription: row.lineDescription,
        system: row.system,
        sourceDocType: row.sourceDocType,
        sourceDocId: row.sourceDocId,
        documentId: row.documentId,
        documentNumber: row.documentNumber,
        party: row.partyId === null ? null : (lines.parties.get(row.partyId) ?? null),
        debit: money(row.debit),
        credit: money(row.credit),
        counters: row.counters,
        balanceAfter: money(row.balanceAfter),
      })),
    };
  }

  @Get('xlsx')
  @RequirePermission('finance.read')
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async xlsx(
    @CurrentUser() ctx: AuthContext,
    @Query() query: LedgerReportQueryDto,
  ): Promise<StreamableFile> {
    return xlsxFile(
      await this.ledger.workbook(ctx, query),
      `ledger-${query.kind.toLowerCase()}-${query.from}-${query.to}`,
      `${mn.reports.ledger.titles[query.kind]} ${query.from} – ${query.to}`,
    );
  }
}
