import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { daysInMonth } from '@tugeel/shared/time';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  BankCalendarDayDto,
  BankCalendarQueryDto,
  BankDateFileQueryDto,
  BankDateQueryDto,
  BankExportManifestDto,
  BankFeesQueryDto,
  BankFileQueryDto,
  BankLinePatchDto,
  BankLineReverseRequestDto,
  BankLinesBulkRequestDto,
  BankLinesBulkResultDto,
  BankStatementDetailDto,
  BankStatementDto,
  BankStatementLineDto,
  BankStatementLinkRequestDto,
  BankStatementPostRequestDto,
  BankStatementPostResultDto,
  BankStatementRulesDto,
  BankStatementRulesRequestDto,
  BankStatementUploadDto,
  BankStatementUploadRequestDto,
} from '../dto/bank-statements.dto';
import {
  type BankLineView,
  type BankStatementDetail,
  BankStatementsService,
  type BankStatementSummary,
} from '../services/bank-statements.service';
import { money } from './mappers';

const READ = 'finance.read';
/** The accountant's work on a statement: it ends in journal entries (ADR-0169 #7). */
const WORK = 'finance.journal.manage';
/** Writing to the books also records customers' money. */
const RECORD = 'finance.payments.record';

function summaryDto(row: BankStatementSummary): BankStatementDto {
  return {
    ...row,
    uploadedAt: row.uploadedAt.toISOString(),
    totalCredit: money(row.totalCredit),
    totalDebit: money(row.totalDebit),
  };
}

function lineDto(row: BankLineView): BankStatementLineDto {
  return {
    ...row,
    txnAt: row.txnAt.toISOString(),
    debit: money(row.debit),
    credit: money(row.credit),
    postedAt: row.postedAt?.toISOString() ?? null,
  };
}

function detailDto(row: BankStatementDetail): BankStatementDetailDto {
  return { ...summaryDto(row), lines: row.lines.map(lineDto) };
}

/**
 * «Тооцоо хаах» (ADR-0169): the bank's statements by day, their lines filled and written to the books,
 * Erkhet's import files, the rules.
 */
@ApiTags('finance')
@Controller('finance/bank-statements')
export class BankStatementsController {
  constructor(private readonly statements: BankStatementsService) {}

  @Get('calendar')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [BankCalendarDayDto] })
  calendar(@Query() query: BankCalendarQueryDto): Promise<BankCalendarDayDto[]> {
    return this.statements.calendar(
      `${query.month}-01`,
      `${query.month}-${String(daysInMonth(query.month)).padStart(2, '0')}`,
    );
  }

  @Get('rules')
  @RequirePermission(READ)
  @ApiOkResponse({ type: BankStatementRulesDto })
  rules(): Promise<BankStatementRulesDto> {
    return this.statements.rules();
  }

  @Put('rules')
  @RequirePermission(WORK)
  @ApiOkResponse({ type: BankStatementRulesDto })
  saveRules(
    @CurrentUser() ctx: AuthContext,
    @Body() body: BankStatementRulesRequestDto,
  ): Promise<BankStatementRulesDto> {
    return this.statements.saveRules(ctx, {
      ...body,
      settlementAccountId: body.settlementAccountId ?? null,
      feeAccountId: body.feeAccountId ?? null,
    });
  }

  @Get('export-manifest')
  @RequirePermission(READ)
  @ApiOkResponse({ type: BankExportManifestDto })
  manifest(@Query() query: BankDateQueryDto): Promise<BankExportManifestDto> {
    return this.statements.manifest(query.date);
  }

  @Get('export-by-date.xlsx')
  @RequirePermission(READ)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async exportByDate(@Query() query: BankDateFileQueryDto): Promise<StreamableFile> {
    const file = await this.statements.exportDate(query.date, query.file);
    return xlsxFile(file.buffer, file.asciiName, file.name);
  }

  @Get('export-fees.xlsx')
  @RequirePermission(READ)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async exportFees(@Query() query: BankFeesQueryDto): Promise<StreamableFile> {
    const file = await this.statements.exportFees(query.from, query.to);
    return xlsxFile(file.buffer, file.asciiName, file.name);
  }

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [BankStatementDto] })
  async byDate(@Query() query: BankDateQueryDto): Promise<BankStatementDto[]> {
    return (await this.statements.byDate(query.date)).map(summaryDto);
  }

  /** The file came through `POST /files/presign`; its lines are read here, at once. */
  @Post()
  @RequirePermission(WORK)
  @Idempotent()
  @ApiCreatedResponse({ type: BankStatementUploadDto })
  async upload(
    @CurrentUser() ctx: AuthContext,
    @Body() body: BankStatementUploadRequestDto,
  ): Promise<BankStatementUploadDto> {
    const result = await this.statements.upload(ctx, body);
    return { ...result, statement: result.statement ? summaryDto(result.statement) : null };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: BankStatementDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<BankStatementDetailDto> {
    return detailDto(await this.statements.get(id));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(WORK)
  @ApiNoContentResponse()
  async remove(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.statements.remove(ctx, id);
  }

  @Put(':id/money-account')
  @RequirePermission(WORK)
  @ApiOkResponse({ type: BankStatementDto })
  async link(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: BankStatementLinkRequestDto,
  ): Promise<BankStatementDto> {
    return summaryDto(await this.statements.linkMoneyAccount(ctx, id, body.moneyAccountId));
  }

  @Post(':id/swap')
  @HttpCode(200)
  @RequirePermission(WORK)
  @ApiOkResponse({ type: BankStatementDetailDto })
  async swap(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BankStatementDetailDto> {
    return detailDto(await this.statements.swap(ctx, id));
  }

  @Patch(':id/lines/:lineId')
  @RequirePermission(WORK)
  @ApiOkResponse({ type: BankStatementLineDto })
  async updateLine(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() body: BankLinePatchDto,
  ): Promise<BankStatementLineDto> {
    return lineDto(await this.statements.updateLine(ctx, id, lineId, body));
  }

  @Post(':id/lines/bulk')
  @HttpCode(200)
  @RequirePermission(WORK)
  @ApiOkResponse({ type: BankLinesBulkResultDto })
  async updateLines(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: BankLinesBulkRequestDto,
  ): Promise<BankLinesBulkResultDto> {
    const { lineIds, descriptionFromBank, ...patch } = body;
    const result = await this.statements.updateLines(ctx, id, {
      lineIds,
      patch,
      ...(descriptionFromBank === undefined ? {} : { descriptionFromBank }),
    });
    return { updated: result.updated, statement: detailDto(result.statement) };
  }

  /** Each line's posting is keyed by the line itself, so a resend finds them in the books already. */
  @Post(':id/post')
  @HttpCode(200)
  @RequirePermission(WORK, RECORD)
  @Idempotent()
  @ApiOkResponse({ type: BankStatementPostResultDto })
  async post(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: BankStatementPostRequestDto,
  ): Promise<BankStatementPostResultDto> {
    const result = await this.statements.post(ctx, id, body);
    return { ...result, statement: detailDto(result.statement) };
  }

  @Post(':id/lines/:lineId/reverse')
  @HttpCode(200)
  @RequirePermission(WORK, RECORD)
  @Idempotent()
  @ApiOkResponse({ type: BankStatementDetailDto })
  async reverse(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() body: BankLineReverseRequestDto,
  ): Promise<BankStatementDetailDto> {
    return detailDto(await this.statements.reverseLine(ctx, id, lineId, body.reason));
  }

  @Get(':id/export.xlsx')
  @RequirePermission(READ)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async exportStatement(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BankFileQueryDto,
  ): Promise<StreamableFile> {
    const file = await this.statements.exportStatement(id, query.file);
    return xlsxFile(file.buffer, file.asciiName, file.name);
  }
}
