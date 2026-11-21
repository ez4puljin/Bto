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
  StreamableFile,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiProduces, ApiTags } from '@nestjs/swagger';
import { XLSX_CONTENT_TYPE } from '@tugeel/shared/files';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  PayrollAdjustmentRequestDto,
  PayrollAdvanceDto,
  PayrollAdvanceRequestDto,
  PayrollAdvancesQueryDto,
  PayrollArchiveRequestDto,
  PayrollIncludeArchivedQueryDto,
  PayrollKpiTemplateDto,
  PayrollKpiTemplateRequestDto,
  PayrollLineDto,
  PayrollMyTermsDto,
  PayrollPayslipDto,
  PayrollReasonRequestDto,
  PayrollRecomputeRequestDto,
  PayrollRunCreateRequestDto,
  PayrollRunDetailDto,
  PayrollRunDto,
  PayrollScoresRequestDto,
  PayrollScoringDto,
  PayrollScoringRunDto,
  PayrollSettingsDto,
  PayrollTemplateApplyRequestDto,
  PayrollTermsDto,
  PayrollTermsRequestDto,
} from '../dto/payroll.dto';
import { PAYROLL_MANAGE, PAYROLL_VIEW } from '../payroll.rights';
import { type PayrollAdvance, PayrollAdvancesService } from '../services/payroll-advances.service';
import { PayrollExportsService } from '../services/payroll-exports.service';
import {
  type PayrollLineView,
  type PayrollRunDetail,
  type PayrollRunView,
  PayrollRunsService,
  type PayrollScoringView,
} from '../services/payroll-runs.service';
import { PayrollSettingsService } from '../services/payroll-settings.service';
import {
  type KpiTemplate,
  type PayTerms,
  PayrollTermsService,
} from '../services/payroll-terms.service';

const iso = (at: Date | null): string | null => at?.toISOString() ?? null;

const toTemplate = (row: KpiTemplate): PayrollKpiTemplateDto => ({
  ...row,
  archivedAt: iso(row.archivedAt),
  updatedAt: row.updatedAt.toISOString(),
});
const toTerms = (row: PayTerms): PayrollTermsDto => ({ ...row, updatedAt: iso(row.updatedAt) });
const toAdvance = (row: PayrollAdvance): PayrollAdvanceDto => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  voidedAt: iso(row.voidedAt),
});

/**
 * A payslip as its employee reads it. Written field by field on purpose: the employer's cost and
 * anything added to the line later never reach the employee by a spread.
 */
const toPayslip = (line: PayrollLineView): PayrollPayslipDto => ({
  id: line.id,
  runId: line.runId,
  month: line.month,
  runStatus: line.runStatus,
  approvedAt: iso(line.approvedAt),
  userId: line.userId,
  fullName: line.fullName,
  position: line.position,
  divisionName: line.divisionName,
  baseSalary: line.baseSalary,
  monthlySalary: line.monthlySalary,
  salaryDays: line.salaryDays,
  salaryMonthDays: line.salaryMonthDays,
  paysSocialInsurance: line.paysSocialInsurance,
  attendanceMeasured: line.attendanceMeasured,
  workdays: line.workdays,
  attendedDays: line.attendedDays,
  lateDays: line.lateDays,
  items: line.items.map((item) => ({
    id: item.id,
    key: item.key,
    name: item.name,
    source: item.source,
    amount: item.amount,
    scorePercent: item.scorePercent,
    basePercent: item.basePercent,
    penaltyPercent: item.penaltyPercent,
    earned: item.earned,
    note: item.note,
    scoredByName: item.scoredByName,
    scoredAt: iso(item.scoredAt),
  })),
  adjustments: line.adjustments.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
  advances: line.advances,
  unscoredCount: line.unscoredCount,
  kpiTotal: line.kpiTotal,
  taxableAdditions: line.taxableAdditions,
  gross: line.gross,
  siBase: line.siBase,
  employeeSi: line.employeeSi,
  pitCredit: line.pitCredit,
  pit: line.pit,
  advance: line.advance,
  otherAdditions: line.otherAdditions,
  deductions: line.deductions,
  net: line.net,
});
const toLine = (line: PayrollLineView): PayrollLineDto => ({
  ...toPayslip(line),
  employerSi: line.employerSi,
  totalCost: line.totalCost,
});
const toRun = (run: PayrollRunView): PayrollRunDto => ({
  id: run.id,
  month: run.month,
  status: run.status,
  note: run.note,
  settings: run.settings,
  attendanceTo: run.attendanceTo,
  computedAt: run.computedAt.toISOString(),
  createdAt: run.createdAt.toISOString(),
  createdByName: run.createdByName,
  approvedAt: iso(run.approvedAt),
  approvedByName: run.approvedByName,
  reopenedAt: iso(run.reopenedAt),
  reopenedByName: run.reopenedByName,
  reopenReason: run.reopenReason,
  lineCount: run.lineCount,
  unscoredCount: run.unscoredCount,
  totals: run.totals,
});
const toDetail = (run: PayrollRunDetail): PayrollRunDetailDto => ({
  ...toRun(run),
  lines: run.lines.map(toLine),
});
const toScoring = (view: PayrollScoringView): PayrollScoringDto => ({
  ...view,
  lines: view.lines.map((line) => ({
    ...line,
    items: line.items.map((item) => ({ ...item, scoredAt: iso(item.scoredAt) })),
  })),
});

/**
 * Payroll with KPI (ADR-0235). `hr.payroll.view` reads everything, `hr.payroll.manage` writes,
 * `hr.payroll.score` (or manage) scores the work-evaluation items through the scoring routes, which
 * show no amount. Every signed-in staff member reads their own approved payslips under `/me`.
 */
@ApiTags('payroll')
@Controller('payroll')
export class PayrollController {
  constructor(
    private readonly settings: PayrollSettingsService,
    private readonly terms: PayrollTermsService,
    private readonly advances: PayrollAdvancesService,
    private readonly runs: PayrollRunsService,
    private readonly exports: PayrollExportsService,
  ) {}

  // the caller's own side
  @Get('me/payslips')
  @Authenticated()
  @ApiOkResponse({ type: [PayrollPayslipDto] })
  async myPayslips(@CurrentUser() ctx: AuthContext): Promise<PayrollPayslipDto[]> {
    return (await this.runs.myPayslips(ctx)).map(toPayslip);
  }

  @Get('me/payslips/:month')
  @Authenticated()
  @ApiOkResponse({ type: PayrollPayslipDto })
  async myPayslip(
    @CurrentUser() ctx: AuthContext,
    @Param('month') month: string,
  ): Promise<PayrollPayslipDto> {
    return toPayslip(await this.runs.myPayslip(ctx, month));
  }

  @Get('me/terms')
  @Authenticated()
  @ApiOkResponse({ type: PayrollMyTermsDto })
  myTerms(@CurrentUser() ctx: AuthContext): Promise<PayrollMyTermsDto> {
    return this.terms.mine(ctx.userId);
  }

  // settings
  @Get('settings')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: PayrollSettingsDto })
  getSettings(): Promise<PayrollSettingsDto> {
    return this.settings.get();
  }

  @Put('settings')
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollSettingsDto })
  updateSettings(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PayrollSettingsDto,
  ): Promise<PayrollSettingsDto> {
    return this.settings.update(ctx, body);
  }

  // KPI templates
  @Get('templates')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: [PayrollKpiTemplateDto] })
  async templates(
    @Query() query: PayrollIncludeArchivedQueryDto,
  ): Promise<PayrollKpiTemplateDto[]> {
    return (await this.terms.templates(query.includeArchived ?? false)).map(toTemplate);
  }

  @Post('templates')
  @RequirePermission(PAYROLL_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: PayrollKpiTemplateDto })
  async createTemplate(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PayrollKpiTemplateRequestDto,
  ): Promise<PayrollKpiTemplateDto> {
    return toTemplate(await this.terms.saveTemplate(ctx, null, body));
  }

  @Put('templates/:id')
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollKpiTemplateDto })
  async updateTemplate(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollKpiTemplateRequestDto,
  ): Promise<PayrollKpiTemplateDto> {
    return toTemplate(await this.terms.saveTemplate(ctx, id, body));
  }

  @Put('templates/:id/archived')
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollKpiTemplateDto })
  async archiveTemplate(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollArchiveRequestDto,
  ): Promise<PayrollKpiTemplateDto> {
    return toTemplate(await this.terms.archiveTemplate(ctx, id, body.archived));
  }

  @Post('templates/:id/apply')
  @HttpCode(200)
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: [PayrollTermsDto] })
  async applyTemplate(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollTemplateApplyRequestDto,
  ): Promise<PayrollTermsDto[]> {
    return (await this.terms.applyTemplate(ctx, id, body.userIds)).map(toTerms);
  }

  // pay terms
  @Get('terms')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: [PayrollTermsDto] })
  async listTerms(): Promise<PayrollTermsDto[]> {
    return (await this.terms.list()).map(toTerms);
  }

  @Get('terms/:userId')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: PayrollTermsDto })
  async oneTerms(@Param('userId', ParseIntPipe) userId: number): Promise<PayrollTermsDto> {
    return toTerms(await this.terms.one(userId));
  }

  @Put('terms/:userId')
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollTermsDto })
  async saveTerms(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: PayrollTermsRequestDto,
  ): Promise<PayrollTermsDto> {
    return toTerms(
      await this.terms.save(ctx, userId, {
        baseSalary: body.baseSalary,
        paysSocialInsurance: body.paysSocialInsurance,
        templateId: body.templateId ?? null,
        items: body.items,
        active: body.active,
      }),
    );
  }

  // advances
  @Get('advances')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: [PayrollAdvanceDto] })
  async listAdvances(@Query() query: PayrollAdvancesQueryDto): Promise<PayrollAdvanceDto[]> {
    return (await this.advances.list(query)).map(toAdvance);
  }

  @Post('advances')
  @RequirePermission(PAYROLL_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: PayrollAdvanceDto })
  async createAdvance(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PayrollAdvanceRequestDto,
  ): Promise<PayrollAdvanceDto> {
    return toAdvance(await this.advances.create(ctx, { ...body, note: body.note ?? null }));
  }

  @Post('advances/:id/void')
  @HttpCode(200)
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollAdvanceDto })
  async voidAdvance(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollReasonRequestDto,
  ): Promise<PayrollAdvanceDto> {
    return toAdvance(await this.advances.void(ctx, id, body.reason));
  }

  // scoring: `hr.payroll.score` or `hr.payroll.manage`, checked in the service; no amounts
  @Get('scoring/runs')
  @Authenticated()
  @ApiOkResponse({ type: [PayrollScoringRunDto] })
  scoringRuns(@CurrentUser() ctx: AuthContext): Promise<PayrollScoringRunDto[]> {
    return this.runs.scoringRuns(ctx);
  }

  @Get('scoring/runs/:id')
  @Authenticated()
  @ApiOkResponse({ type: PayrollScoringDto })
  async scoring(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PayrollScoringDto> {
    return toScoring(await this.runs.scoring(ctx, id));
  }

  @Put('scoring/runs/:id/scores')
  @Authenticated()
  @ApiOkResponse({ type: PayrollScoringDto })
  async score(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollScoresRequestDto,
  ): Promise<PayrollScoringDto> {
    return toScoring(await this.runs.score(ctx, id, body.scores));
  }

  // runs
  @Get('runs')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: [PayrollRunDto] })
  async listRuns(): Promise<PayrollRunDto[]> {
    return (await this.runs.list()).map(toRun);
  }

  @Post('runs')
  @RequirePermission(PAYROLL_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: PayrollRunDetailDto })
  async createRun(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PayrollRunCreateRequestDto,
  ): Promise<PayrollRunDetailDto> {
    return toDetail(await this.runs.create(ctx, { month: body.month, note: body.note ?? null }));
  }

  @Get('runs/:id')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: PayrollRunDetailDto })
  async getRun(@Param('id', ParseIntPipe) id: number): Promise<PayrollRunDetailDto> {
    return toDetail(await this.runs.get(id));
  }

  @Get('runs/:id/export.xlsx')
  @RequirePermission(PAYROLL_VIEW)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async runXlsx(@Param('id', ParseIntPipe) id: number): Promise<StreamableFile> {
    const sheet = await this.exports.runWorkbook(id);
    return xlsxFile(sheet.buffer, `payroll-${sheet.month}`, sheet.title);
  }

  @Get('runs/:id/lines/:lineId')
  @RequirePermission(PAYROLL_VIEW)
  @ApiOkResponse({ type: PayrollLineDto })
  async getLine(
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
  ): Promise<PayrollLineDto> {
    return toLine(await this.runs.line(id, lineId));
  }

  @Post('runs/:id/recompute')
  @HttpCode(200)
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollRunDetailDto })
  async recompute(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollRecomputeRequestDto,
  ): Promise<PayrollRunDetailDto> {
    return toDetail(await this.runs.recompute(ctx, id, body.refreshTerms ?? false));
  }

  @Post('runs/:id/approve')
  @HttpCode(200)
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollRunDetailDto })
  async approve(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PayrollRunDetailDto> {
    return toDetail(await this.runs.approve(ctx, id));
  }

  @Post('runs/:id/reopen')
  @HttpCode(200)
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollRunDetailDto })
  async reopen(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PayrollReasonRequestDto,
  ): Promise<PayrollRunDetailDto> {
    return toDetail(await this.runs.reopen(ctx, id, body.reason));
  }

  @Post('runs/:id/lines/:lineId/adjustments')
  @RequirePermission(PAYROLL_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: PayrollLineDto })
  async addAdjustment(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Body() body: PayrollAdjustmentRequestDto,
  ): Promise<PayrollLineDto> {
    return toLine(
      await this.runs.addAdjustment(ctx, id, lineId, {
        kind: body.kind,
        name: body.name,
        amount: body.amount,
        taxable: body.taxable ?? false,
      }),
    );
  }

  @Delete('runs/:id/lines/:lineId/adjustments/:adjustmentId')
  @RequirePermission(PAYROLL_MANAGE)
  @ApiOkResponse({ type: PayrollLineDto })
  async removeAdjustment(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('lineId', ParseIntPipe) lineId: number,
    @Param('adjustmentId', ParseIntPipe) adjustmentId: number,
  ): Promise<PayrollLineDto> {
    return toLine(await this.runs.removeAdjustment(ctx, id, lineId, adjustmentId));
  }
}
