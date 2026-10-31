import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { businessDate } from '@tugeel/shared/time';
import { type AuthContext, Authenticated, CurrentUser, RequirePermission } from '../../identity';
import {
  AttendanceDashboardDto,
  AttendanceDayDto,
  AttendanceDayListDto,
  AttendanceEventDto,
  AttendanceEventListDto,
  AttendanceEventRequestDto,
  AttendanceStrikeRequestDto,
  DashboardQueryDto,
  DaysQueryDto,
  EventsQueryDto,
  HrEmployeeDto,
  HrEmployeeRequestDto,
  HrScheduleDto,
  HrScheduleRequestDto,
  MyAttendanceDto,
  MyDaysQueryDto,
  PunchRequestDto,
  WorkSiteArchiveRequestDto,
  WorkSiteDto,
  WorkSiteRequestDto,
} from '../dto/hr.dto';
import {
  type AttendanceEvent,
  AttendanceService,
  type DayRow,
} from '../services/attendance.service';
import {
  type CompanySchedule,
  type Employee,
  HrSettingsService,
} from '../services/hr-settings.service';
import {
  ATTENDANCE_MANAGE,
  ATTENDANCE_VIEW,
  type WorkSite,
  WorkSitesService,
} from '../services/work-sites.service';

const toSite = (site: WorkSite): WorkSiteDto => ({
  ...site,
  archivedAt: site.archivedAt?.toISOString() ?? null,
  updatedAt: site.updatedAt.toISOString(),
});

const toSchedule = (schedule: CompanySchedule): HrScheduleDto => ({
  workStart: schedule.workStart,
  workEnd: schedule.workEnd,
  graceMinutes: schedule.graceMinutes,
  workdays: schedule.workdays,
  updatedAt: schedule.updatedAt?.toISOString() ?? null,
});

const toEmployee = (employee: Employee): HrEmployeeDto => ({ ...employee });

const toEvent = (event: AttendanceEvent): AttendanceEventDto => ({
  id: event.id,
  userId: event.userId,
  kind: event.kind,
  at: event.at.toISOString(),
  businessDate: event.businessDate,
  source: event.source,
  siteId: event.siteId,
  siteName: event.siteName,
  lat: event.lat,
  lng: event.lng,
  accuracyM: event.accuracyM,
  distanceM: event.distanceM,
  note: event.note,
  deletedAt: event.deletedAt?.toISOString() ?? null,
  deleteReason: event.deleteReason,
});

const toDay = (row: DayRow): AttendanceDayDto => ({ ...row });

/** The work sites, the schedule and the employees' terms (ADR-0131 #1–#2): HR's pages. */
@ApiTags('hr')
@Controller('hr')
export class HrSetupController {
  constructor(
    private readonly sites: WorkSitesService,
    private readonly settings: HrSettingsService,
  ) {}

  @Get('work-sites')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [WorkSiteDto] })
  async listSites(@Query('includeArchived') includeArchived?: string): Promise<WorkSiteDto[]> {
    return (await this.sites.list(includeArchived === 'true')).map(toSite);
  }

  @Post('work-sites')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: WorkSiteDto })
  async createSite(
    @CurrentUser() ctx: AuthContext,
    @Body() body: WorkSiteRequestDto,
  ): Promise<WorkSiteDto> {
    return toSite(await this.sites.create(ctx, { ...body, branchId: body.branchId ?? null }));
  }

  @Put('work-sites/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: WorkSiteDto })
  async updateSite(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: WorkSiteRequestDto,
  ): Promise<WorkSiteDto> {
    return toSite(await this.sites.update(ctx, id, { ...body, branchId: body.branchId ?? null }));
  }

  @Put('work-sites/:id/archived')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: WorkSiteDto })
  async archiveSite(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: WorkSiteArchiveRequestDto,
  ): Promise<WorkSiteDto> {
    return toSite(await this.sites.setArchived(ctx, id, body.archived));
  }

  @Get('schedule')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrScheduleDto })
  async schedule(): Promise<HrScheduleDto> {
    return toSchedule(await this.settings.schedule());
  }

  @Put('schedule')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrScheduleDto })
  async updateSchedule(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrScheduleRequestDto,
  ): Promise<HrScheduleDto> {
    return toSchedule(await this.settings.updateSchedule(ctx, body));
  }

  @Get('employees')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrEmployeeDto] })
  async employees(): Promise<HrEmployeeDto[]> {
    return (await this.settings.employees()).map(toEmployee);
  }

  @Put('employees/:userId')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrEmployeeDto })
  async updateEmployee(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: HrEmployeeRequestDto,
  ): Promise<HrEmployeeDto> {
    return toEmployee(
      await this.settings.updateEmployee(ctx, userId, {
        tracked: body.tracked,
        workStart: body.workStart ?? null,
        workEnd: body.workEnd ?? null,
        graceMinutes: body.graceMinutes ?? null,
        workdays: body.workdays ?? null,
        siteIds: body.siteIds,
      }),
    );
  }
}

/**
 * Attendance (ADR-0131 #3–#4): the staff app's punch and own picture (every signed-in staff
 * member), the dashboard and the day log (`hr.attendance.view`), HR's corrections
 * (`hr.attendance.manage`, checked in the service too).
 */
@ApiTags('hr')
@Controller('hr/attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('me')
  @Authenticated()
  @ApiOkResponse({ type: MyAttendanceDto })
  async me(@CurrentUser() ctx: AuthContext): Promise<MyAttendanceDto> {
    const mine = await this.attendance.me(ctx);
    return {
      today: mine.today,
      now: mine.now.toISOString(),
      state: mine.state,
      schedule: mine.schedule,
      tracked: mine.tracked,
      sites: mine.sites,
      todayEvents: mine.todayEvents.map(toEvent),
      day: {
        ...mine.day,
        userId: ctx.userId,
        date: mine.today,
        siteName: mine.todayEvents.find((event) => event.kind === 'IN')?.siteName ?? null,
        state: mine.state,
      },
      month: mine.month,
    };
  }

  @Get('me/days')
  @Authenticated()
  @ApiOkResponse({ type: AttendanceDayListDto })
  async myDays(
    @CurrentUser() ctx: AuthContext,
    @Query() query: MyDaysQueryDto,
  ): Promise<AttendanceDayListDto> {
    return { data: (await this.attendance.myDays(ctx, query.month)).map(toDay) };
  }

  @Post('punch')
  @Authenticated()
  @ApiCreatedResponse({ type: AttendanceEventDto })
  async punch(
    @CurrentUser() ctx: AuthContext,
    @Body() body: PunchRequestDto,
  ): Promise<AttendanceEventDto> {
    return toEvent(
      await this.attendance.punch(ctx, {
        kind: body.kind,
        lat: body.lat,
        lng: body.lng,
        accuracyM: body.accuracyM ?? null,
      }),
    );
  }

  @Get('dashboard')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: AttendanceDashboardDto })
  async dashboard(@Query() query: DashboardQueryDto): Promise<AttendanceDashboardDto> {
    const dashboard = await this.attendance.dashboard(query.date ?? businessDate());
    return {
      ...dashboard,
      now: dashboard.now.toISOString(),
      rows: dashboard.rows.map((row) => ({
        ...toDay(row),
        fullName: row.fullName,
        roles: row.roles,
        schedule: row.schedule,
      })),
    };
  }

  @Get('days')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: AttendanceDayListDto })
  async days(@Query() query: DaysQueryDto): Promise<AttendanceDayListDto> {
    return {
      data: (
        await this.attendance.days({
          from: query.from,
          to: query.to,
          ...(query.userId === undefined ? {} : { userId: query.userId }),
        })
      ).map(toDay),
    };
  }

  @Get('events')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: AttendanceEventListDto })
  async events(@Query() query: EventsQueryDto): Promise<AttendanceEventListDto> {
    return { data: (await this.attendance.events(query.userId, query.date)).map(toEvent) };
  }

  @Post('events')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: AttendanceEventDto })
  async addEvent(
    @CurrentUser() ctx: AuthContext,
    @Body() body: AttendanceEventRequestDto,
  ): Promise<AttendanceEventDto> {
    return toEvent(
      await this.attendance.addEvent(ctx, {
        userId: body.userId,
        kind: body.kind,
        at: new Date(body.at),
        note: body.note,
      }),
    );
  }

  @Delete('events/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: AttendanceEventDto })
  async strike(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AttendanceStrikeRequestDto,
  ): Promise<AttendanceEventDto> {
    return toEvent(await this.attendance.strike(ctx, id, body.reason));
  }
}
