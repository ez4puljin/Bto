import { pipeline } from 'node:stream/promises';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { isPeriod } from '@tugeel/shared/ebarimt-check';
import { Decimal } from '@tugeel/shared/money';
import type { Response } from 'express';
import { invalid } from '../../../common/errors/app-error';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  EbarimtAssignRequestDto,
  EbarimtAssignResultDto,
  EbarimtEntriesDto,
  EbarimtEntriesQueryDto,
  EbarimtFileOverviewDto,
  EbarimtFileRemoveQueryDto,
  EbarimtFilesQueryDto,
  EbarimtImportRequestDto,
  EbarimtImportResultDto,
  EbarimtLinkRequestDto,
  EbarimtLinkResultDto,
  EbarimtMonthFileDto,
  EbarimtMonthValueRequestDto,
  EbarimtPeriodsQueryDto,
  EbarimtProfileRequestDto,
  EbarimtReceiptListDto,
  EbarimtReceiptsQueryDto,
  EbarimtReportDto,
  EbarimtVersionDto,
  EbarimtSettingsDto,
  EbarimtSettingsRequestDto,
} from '../dto/ebarimt-check.dto';
import { EbarimtEditsService } from '../services/ebarimt-edits.service';
import { EbarimtFilesService, type EbarimtMonthFile } from '../services/ebarimt-files.service';
import { EbarimtReportService } from '../services/ebarimt-report.service';
import { EbarimtSettingsService } from '../services/ebarimt-settings.service';

const READ = 'ebarimt.check.read';
const EDIT = 'ebarimt.check.edit';
const ASSIGN = 'ebarimt.check.assign';
const SETTINGS = 'ebarimt.check.settings';

const money = (value: Decimal): string => value.toFixed(2);

const toFileDto = (file: EbarimtMonthFile): EbarimtMonthFileDto => ({
  ...file,
  vatAmount: money(file.vatAmount),
  totalAmount: money(file.totalAmount),
  uploadedAt: file.uploadedAt.toISOString(),
});

/**
 * «Ebarimt» (ADR-0168): a month's purchases from the goods receipts against e-Barimt's file, by
 * supplier. Read as a whole and filtered in the browser, like the old list.
 */
@ApiTags('ebarimt-check')
@Controller('ebarimt-check')
export class EbarimtCheckController {
  constructor(
    private readonly report: EbarimtReportService,
    private readonly files: EbarimtFilesService,
    private readonly edits: EbarimtEditsService,
    private readonly settings: EbarimtSettingsService,
  ) {}

  @Get('report')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtReportDto })
  async getReport(@Query() query: EbarimtPeriodsQueryDto): Promise<EbarimtReportDto> {
    const report = await this.report.report(query.periods);
    return {
      ...report,
      rows: report.rows.map((row) => ({
        ...row,
        purchaseAmount: money(row.purchaseAmount),
        ebarimtAmount: money(row.ebarimtAmount),
        linkedAmount: money(row.linkedAmount),
        exemptAmount: money(row.exemptAmount),
        diffAmount: money(row.diffAmount),
        byPeriod: row.byPeriod.map((values) => ({
          ...values,
          purchaseAmount: money(values.purchaseAmount),
          ebarimtAmount: money(values.ebarimtAmount),
          exemptAmount: money(values.exemptAmount),
        })),
        history: row.history.map((event) => ({
          ...event,
          amount: event.amount === null ? null : money(event.amount),
          changedAt: event.changedAt.toISOString(),
        })),
      })),
      unregistered: report.unregistered.map((row) => ({ ...row, amount: money(row.amount) })),
      links: report.links.map((link) => ({
        ...link,
        amount: money(link.amount),
        createdAt: link.createdAt.toISOString(),
      })),
    };
  }

  /** The receipts behind a supplier's purchases; each row opens the receipt. */
  @Get('receipts')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtReceiptListDto })
  async receipts(@Query() query: EbarimtReceiptsQueryDto): Promise<EbarimtReceiptListDto> {
    const rows = await this.report.receiptsOf(query.periods, query.supplierId);
    return {
      data: rows.map((row) => ({
        ...row,
        amount: row.amount === null ? null : money(row.amount),
      })),
    };
  }

  /** e-Barimt's lines behind a figure: a supplier's, or one register's. */
  @Get('entries')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtEntriesDto })
  async entries(@Query() query: EbarimtEntriesQueryDto): Promise<EbarimtEntriesDto> {
    if (query.supplierId === undefined && !query.ttd) {
      throw invalid('supplierId', 'required', 'a supplier or a register');
    }
    const result = await this.report.entriesOf(query.periods, {
      supplierId: query.supplierId,
      ttd: query.ttd,
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        vatAmount: money(row.vatAmount),
        netAmount: money(row.netAmount),
        totalAmount: money(row.totalAmount),
        link: row.link ? { ...row.link, createdAt: row.link.createdAt.toISOString() } : null,
      })),
    };
  }

  @Get('version')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtVersionDto })
  async version(@Query() query: EbarimtPeriodsQueryDto): Promise<EbarimtVersionDto> {
    return { stamp: await this.report.version(query.periods) };
  }

  @Get('files')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtFileOverviewDto })
  async overview(@Query() query: EbarimtFilesQueryDto): Promise<EbarimtFileOverviewDto> {
    const overview = await this.files.overview(query.year);
    return {
      latestPeriod: overview.latestPeriod,
      months: overview.months.map((month) => ({
        period: month.period,
        file: month.file ? toFileDto(month.file) : null,
      })),
    };
  }

  /** Attaches an uploaded export to the month its dates fall in; replaces that month's file. */
  @Post('files')
  @RequirePermission(EDIT)
  @Idempotent()
  @ApiCreatedResponse({ type: EbarimtImportResultDto })
  async importFile(
    @CurrentUser() ctx: AuthContext,
    @Body() body: EbarimtImportRequestDto,
  ): Promise<EbarimtImportResultDto> {
    const result = await this.files.importFile(ctx, body);
    return { ...toFileDto(result), replacedRowCount: result.replacedRowCount };
  }

  @Delete('files/:period')
  @HttpCode(204)
  @RequirePermission(SETTINGS)
  @ApiNoContentResponse()
  async removeFile(
    @CurrentUser() ctx: AuthContext,
    @Param('period', ParseIntPipe) period: number,
    @Query() query: EbarimtFileRemoveQueryDto,
  ): Promise<void> {
    if (!isPeriod(period)) throw invalid('period', 'isPeriod', 'a month like 202610');
    await this.files.remove(ctx, period, query.fileId);
  }

  @Get('files/:id/download')
  @RequirePermission(READ)
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOkResponse({ description: 'The file as uploaded' })
  async download(@Param('id', ParseIntPipe) id: number, @Res() response: Response): Promise<void> {
    const { file, body, fileName } = await this.files.open(id);
    response.status(200);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Length', String(file.sizeBytes));
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    await pipeline(body, response);
  }

  @Get('settings')
  @RequirePermission(READ)
  @ApiOkResponse({ type: EbarimtSettingsDto })
  async getSettings(): Promise<EbarimtSettingsDto> {
    return { accounts: await this.settings.options() };
  }

  @Put('settings')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: EbarimtSettingsDto })
  async saveSettings(
    @CurrentUser() ctx: AuthContext,
    @Body() body: EbarimtSettingsRequestDto,
  ): Promise<EbarimtSettingsDto> {
    return { accounts: await this.settings.save(ctx, body.accountCodes) };
  }

  @Put('month-values')
  @HttpCode(204)
  @RequirePermission(EDIT)
  @ApiNoContentResponse()
  async saveMonthValue(
    @CurrentUser() ctx: AuthContext,
    @Body() body: EbarimtMonthValueRequestDto,
  ): Promise<void> {
    await this.edits.saveMonthValue(ctx, {
      period: body.period,
      supplierId: body.supplierId,
      exemptAmount: body.exemptAmount === undefined ? undefined : new Decimal(body.exemptAmount),
      previousExemptAmount:
        body.previousExemptAmount === undefined
          ? undefined
          : new Decimal(body.previousExemptAmount),
      note: body.note,
      previousNote: body.previousNote,
    });
  }

  @Put('assignments')
  @RequirePermission(ASSIGN)
  @ApiOkResponse({ type: EbarimtAssignResultDto })
  assign(
    @CurrentUser() ctx: AuthContext,
    @Body() body: EbarimtAssignRequestDto,
  ): Promise<EbarimtAssignResultDto> {
    return this.edits.assignEmployee(ctx, body);
  }

  @Put('suppliers/:id/profile')
  @HttpCode(204)
  @RequirePermission(EDIT)
  @ApiNoContentResponse()
  async saveProfile(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: EbarimtProfileRequestDto,
  ): Promise<void> {
    await this.edits.saveProfile(ctx, id, body);
  }

  @Put('receipt-links')
  @RequirePermission(EDIT)
  @ApiOkResponse({ type: EbarimtLinkResultDto })
  link(
    @CurrentUser() ctx: AuthContext,
    @Body() body: EbarimtLinkRequestDto,
  ): Promise<EbarimtLinkResultDto> {
    return this.edits.linkReceipts(ctx, body);
  }
}
