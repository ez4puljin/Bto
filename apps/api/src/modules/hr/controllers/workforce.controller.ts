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
import mn from '@tugeel/shared/i18n/mn.json';
import { xlsxFile } from '../../../common/excel/xlsx-file';
import { GatedReport } from '../../../common/reports/report-gate.interceptor';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  HrArchiveRequestDto,
  HrDivisionDto,
  HrDivisionRequestDto,
  HrPendingCountDto,
  HrReportDto,
  HrReportQueryDto,
  HrRequestsQueryDto,
  HrRequestTypeDto,
  HrRequestTypeRequestDto,
  HrStaffDto,
  HrStaffPasswordRequestDto,
  HrStaffLeftRequestDto,
  HrStaffPhotoRequestDto,
  HrStaffRequestDto,
  HrTimeRequestCreateDto,
  HrTimeRequestDecisionDto,
  HrTimeRequestDto,
  HrWorkScheduleDto,
  HrWorkScheduleRequestDto,
  IncludeArchivedQueryDto,
} from '../dto/workforce.dto';
import { HrExportsService } from '../services/hr-exports.service';
import { HrReportsService } from '../services/reports.service';
import { RequestsService, type TimeRequest } from '../services/requests.service';
import { ATTENDANCE_MANAGE, ATTENDANCE_VIEW } from '../services/work-sites.service';
import {
  type Division,
  type EmployeeInput,
  type WorkSchedule,
  WorkforceService,
} from '../services/workforce.service';

const toDivision = (row: Division): HrDivisionDto => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});
const toSchedule = (row: WorkSchedule): HrWorkScheduleDto => ({
  ...row,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});
const toRequest = (row: TimeRequest): HrTimeRequestDto => ({
  ...row,
  startsAt: row.startsAt?.toISOString() ?? null,
  endsAt: row.endsAt?.toISOString() ?? null,
  decidedAt: row.decidedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});
const staffInput = (body: HrStaffRequestDto): EmployeeInput => ({
  firstName: body.firstName,
  lastName: body.lastName,
  phone: body.phone,
  position: body.position ?? null,
  divisionId: body.divisionId ?? null,
  employmentType: body.employmentType,
  gender: body.gender ?? null,
  employedOn: body.employedOn ?? null,
  scheduleId: body.scheduleId ?? null,
  password: body.password?.length ? body.password : null,
});

/**
 * HR beyond the punch (ADR-0144): divisions, the employees' cards, the schedules, the request
 * types, the requests and the reports. `hr.attendance.view` reads, `hr.attendance.manage`
 * writes; the staff app sends and cancels its own requests.
 */
@ApiTags('hr')
@Controller('hr')
export class WorkforceController {
  constructor(
    private readonly workforce: WorkforceService,
    private readonly requests: RequestsService,
    private readonly reports: HrReportsService,
    private readonly exports: HrExportsService,
  ) {}

  // divisions
  @Get('divisions')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrDivisionDto] })
  async divisions(@Query() query: IncludeArchivedQueryDto): Promise<HrDivisionDto[]> {
    return (await this.workforce.divisions(query.includeArchived ?? false)).map(toDivision);
  }

  @Post('divisions')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: HrDivisionDto })
  async createDivision(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrDivisionRequestDto,
  ): Promise<HrDivisionDto> {
    return toDivision(await this.workforce.saveDivision(ctx, null, body));
  }

  @Put('divisions/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrDivisionDto })
  async updateDivision(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrDivisionRequestDto,
  ): Promise<HrDivisionDto> {
    return toDivision(await this.workforce.saveDivision(ctx, id, body));
  }

  @Put('divisions/:id/archived')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrDivisionDto })
  async archiveDivision(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrArchiveRequestDto,
  ): Promise<HrDivisionDto> {
    return toDivision(await this.workforce.archiveDivision(ctx, id, body.archived));
  }

  // employees
  @Get('staff')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrStaffDto] })
  staff(): Promise<HrStaffDto[]> {
    return this.workforce.employees();
  }

  @Get('staff.xlsx')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async staffXlsx(): Promise<StreamableFile> {
    return xlsxFile(await this.exports.staffWorkbook(), 'staff', mn.hr.staff.title);
  }

  @Post('staff')
  @RequirePermission(ATTENDANCE_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: HrStaffDto })
  createStaff(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrStaffRequestDto,
  ): Promise<HrStaffDto> {
    return this.workforce.create(ctx, staffInput(body));
  }

  @Put('staff/:userId')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrStaffDto })
  updateStaff(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: HrStaffRequestDto,
  ): Promise<HrStaffDto> {
    return this.workforce.update(ctx, userId, staffInput(body));
  }

  @Put('staff/:userId/left')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrStaffDto })
  setLeft(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: HrStaffLeftRequestDto,
  ): Promise<HrStaffDto> {
    return this.workforce.setLeft(ctx, userId, {
      leftOn: body.leftOn ?? null,
      reason: body.reason ?? null,
      reasonKind: body.reasonKind ?? null,
    });
  }

  @Put('staff/:userId/password')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrStaffDto })
  resetPassword(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: HrStaffPasswordRequestDto,
  ): Promise<HrStaffDto> {
    return this.workforce.resetPassword(ctx, userId, body.password);
  }

  @Put('staff/:userId/photo')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrStaffDto })
  setPhoto(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: HrStaffPhotoRequestDto,
  ): Promise<HrStaffDto> {
    return this.workforce.setPhoto(ctx, userId, body.fileId ?? null);
  }

  // schedules
  @Get('schedules')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrWorkScheduleDto] })
  async schedules(@Query() query: IncludeArchivedQueryDto): Promise<HrWorkScheduleDto[]> {
    return (await this.workforce.schedules(query.includeArchived ?? false)).map(toSchedule);
  }

  @Post('schedules')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: HrWorkScheduleDto })
  async createSchedule(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrWorkScheduleRequestDto,
  ): Promise<HrWorkScheduleDto> {
    return toSchedule(await this.workforce.saveSchedule(ctx, null, body));
  }

  @Put('schedules/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrWorkScheduleDto })
  async updateSchedule(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrWorkScheduleRequestDto,
  ): Promise<HrWorkScheduleDto> {
    return toSchedule(await this.workforce.saveSchedule(ctx, id, body));
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  @RequirePermission(ATTENDANCE_MANAGE)
  async archiveSchedule(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.workforce.archiveSchedule(ctx, id);
  }

  // request types
  @Get('request-types')
  @Authenticated()
  @ApiOkResponse({ type: [HrRequestTypeDto] })
  requestTypes(): Promise<HrRequestTypeDto[]> {
    return this.requests.types();
  }

  @Post('request-types')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: HrRequestTypeDto })
  createRequestType(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrRequestTypeRequestDto,
  ): Promise<HrRequestTypeDto> {
    return this.requests.saveType(ctx, null, body);
  }

  @Put('request-types/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrRequestTypeDto })
  updateRequestType(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrRequestTypeRequestDto,
  ): Promise<HrRequestTypeDto> {
    return this.requests.saveType(ctx, id, body);
  }

  // requests
  @Get('requests')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrTimeRequestDto] })
  async requestList(
    @CurrentUser() ctx: AuthContext,
    @Query() query: HrRequestsQueryDto,
  ): Promise<HrTimeRequestDto[]> {
    return (await this.requests.list(ctx, query)).map(toRequest);
  }

  @Get('requests/mine')
  @Authenticated()
  @ApiOkResponse({ type: [HrTimeRequestDto] })
  async myRequests(@CurrentUser() ctx: AuthContext): Promise<HrTimeRequestDto[]> {
    return (await this.requests.mine(ctx)).map(toRequest);
  }

  @Get('requests/pending-count')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrPendingCountDto })
  async pendingCount(): Promise<HrPendingCountDto> {
    return { pending: await this.requests.pendingCount() };
  }

  @Post('requests')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: HrTimeRequestDto })
  async createRequest(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrTimeRequestCreateDto,
  ): Promise<HrTimeRequestDto> {
    return toRequest(
      await this.requests.create(ctx, {
        userId: body.userId ?? ctx.userId,
        typeId: body.typeId,
        fromDate: body.fromDate,
        toDate: body.toDate ?? null,
        startsAt: body.startsAt ? new Date(body.startsAt) : null,
        endsAt: body.endsAt ? new Date(body.endsAt) : null,
        punchKind: body.punchKind ?? null,
        note: body.note ?? null,
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        accuracyM: body.accuracyM ?? null,
      }),
    );
  }

  @Post('requests/:id/decision')
  @HttpCode(200)
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrTimeRequestDto })
  async decide(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrTimeRequestDecisionDto,
  ): Promise<HrTimeRequestDto> {
    return toRequest(
      await this.requests.decide(ctx, id, { approve: body.approve, note: body.note ?? null }),
    );
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: HrTimeRequestDto })
  async cancel(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HrTimeRequestDto> {
    return toRequest(await this.requests.cancel(ctx, id));
  }

  // reports
  @Get('reports/days')
  @GatedReport()
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrReportDto })
  async reportDays(@Query() query: HrReportQueryDto): Promise<HrReportDto> {
    const report = await this.reports.days(query);
    return {
      totals: report.totals,
      rows: report.rows.map((row) => ({
        ...row,
        firstIn: row.firstIn?.toISOString() ?? null,
        lastOut: row.lastOut?.toISOString() ?? null,
      })),
    };
  }

  @Get('reports/days.xlsx')
  @GatedReport()
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiProduces(XLSX_CONTENT_TYPE)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async reportDaysXlsx(@Query() query: HrReportQueryDto): Promise<StreamableFile> {
    return xlsxFile(
      await this.exports.reportWorkbook(query),
      `hr-report-${query.from}-${query.to}`,
      `${mn.hr.report.title} ${query.from} – ${query.to}`,
    );
  }
}
