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
import { AppError } from '../../../common/errors/app-error';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { PageQueryDto } from '../../../common/pagination/page';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  AiAnswerDto,
  AiConversationDetailDto,
  AiConversationPageDto,
  AiReportDto,
  AiReportPageDto,
  AiResultDto,
  AiStatusDto,
  AskQuestionDto,
  CreateReportDto,
  RenameReportDto,
} from '../dto/ai.dto';
import { AiExportService, queryFailed } from '../services/ai-export.service';
import { AskFlowService } from '../services/ask-flow.service';
import { ConversationsService } from '../services/conversations.service';
import { type AiReportView, ReportsService } from '../services/reports.service';
import { AiQueryError, AiReaderService, type AiResult } from '../sql/ai-reader.service';

const ASK = 'ai.ask';

/** Runs stored SQL again (guard + read-only reader); a failure is 422 AI_QUERY_FAILED. */
async function rerun(reader: AiReaderService, sql: string): Promise<AiResult> {
  if (!reader.configured) throw new AppError('AI_NOT_CONFIGURED', 'no read-only database');
  try {
    return await reader.run(sql);
  } catch (error: unknown) {
    if (error instanceof AiQueryError) throw queryFailed(error);
    throw error;
  }
}

/** The AI assistant: questions, conversations, rows again and Excel (ADR-0045, docs/modules/ai.md). */
@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly flow: AskFlowService,
    private readonly conversations: ConversationsService,
    private readonly reader: AiReaderService,
    private readonly exports: AiExportService,
  ) {}

  @Get('status')
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiStatusDto })
  status(): AiStatusDto {
    return this.flow.status();
  }

  @Post('questions')
  @RequirePermission(ASK)
  @Idempotent({ storeWithout: ['result'] })
  @ApiCreatedResponse({ type: AiAnswerDto })
  ask(@CurrentUser() ctx: AuthContext, @Body() body: AskQuestionDto): Promise<AiAnswerDto> {
    return this.flow.ask(ctx, body);
  }

  @Get('conversations')
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiConversationPageDto })
  conversationList(
    @CurrentUser() ctx: AuthContext,
    @Query() query: PageQueryDto,
  ): Promise<AiConversationPageDto> {
    return this.conversations.list(ctx, query);
  }

  @Get('conversations/:id')
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiConversationDetailDto })
  conversation(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AiConversationDetailDto> {
    return this.conversations.get(ctx, id);
  }

  @Post('questions/:id/run')
  @HttpCode(200)
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiResultDto })
  async run(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AiResultDto> {
    return rerun(this.reader, await this.answeredSql(ctx, id));
  }

  @Get('questions/:id/export')
  @RequirePermission(ASK)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async export(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const sql = await this.answeredSql(ctx, id);
    return xlsxFile(await this.exports.workbook(sql, `AI ${id}`), `ai-${id}`, `AI ${id}`);
  }

  /** The SQL of one of the caller's answered questions. */
  private async answeredSql(ctx: AuthContext, id: number): Promise<string> {
    const question = await this.conversations.question(ctx, id);
    if (question.status !== 'ANSWERED' || !question.sql) {
      throw new AppError('CONFLICT', `question ${id} has no answer to run`);
    }
    return question.sql;
  }
}

/** Saved reports: every holder of ai.ask sees and runs them (ADR-0045 #8). */
@ApiTags('ai')
@Controller('ai/reports')
export class AiReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly reader: AiReaderService,
    private readonly exports: AiExportService,
  ) {}

  @Get()
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiReportPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: PageQueryDto,
  ): Promise<AiReportPageDto> {
    const page = await this.reports.list(query);
    return { data: page.data.map((report) => this.dto(ctx, report)), nextCursor: page.nextCursor };
  }

  @Post()
  @RequirePermission(ASK)
  @Idempotent()
  @ApiCreatedResponse({ type: AiReportDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateReportDto,
  ): Promise<AiReportDto> {
    return this.dto(ctx, await this.reports.create(ctx, body));
  }

  @Patch(':id')
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiReportDto })
  async rename(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RenameReportDto,
  ): Promise<AiReportDto> {
    return this.dto(ctx, await this.reports.rename(ctx, id, body.name));
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(ASK)
  @ApiNoContentResponse()
  async remove(@CurrentUser() ctx: AuthContext, @Param('id', ParseIntPipe) id: number) {
    await this.reports.remove(ctx, id);
  }

  @Post(':id/run')
  @HttpCode(200)
  @RequirePermission(ASK)
  @ApiOkResponse({ type: AiResultDto })
  async run(@Param('id', ParseIntPipe) id: number): Promise<AiResultDto> {
    return rerun(this.reader, (await this.reports.get(id)).sql);
  }

  @Get(':id/export')
  @RequirePermission(ASK)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async export(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const report = await this.reports.get(id);
    return xlsxFile(
      await this.exports.workbook(report.sql, report.name),
      `report-${id}`,
      report.name,
    );
  }

  private dto(ctx: AuthContext, report: AiReportView): AiReportDto {
    return { ...report, canChange: this.reports.canChange(ctx, report) };
  }
}
