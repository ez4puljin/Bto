import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, Idempotent, RequirePermission } from '../../identity';
import {
  RepPlanDayDto,
  RepPlanDayRequestDto,
  RepRefDto,
  RepTodayDto,
  RepVisitPageDto,
  RepVisitQueryDto,
  RepVisitRequestDto,
  RepVisitSummaryRowDto,
} from '../dto/rep-visits.dto';
import { type RepToday, RepVisitsService, type VisitQuery } from '../services/rep-visits.service';

const REP = 'sales.orders.rep';
const READ = 'sales.orders.read';
const MANAGE = 'sales.orders.manage';

const todayDto = (today: RepToday): RepTodayDto => ({
  ...today,
  stops: today.stops.map((stop) => ({
    ...stop,
    visit: stop.visit ? { ...stop.visit, visitedAt: stop.visit.visitedAt.toISOString() } : null,
  })),
});

const queryOf = (query: RepVisitQueryDto): VisitQuery => ({
  ...(query.userId === undefined ? {} : { userId: query.userId }),
  ...(query.customerId === undefined ? {} : { customerId: query.customerId }),
  ...(query.from === undefined ? {} : { from: query.from }),
  ...(query.to === undefined ? {} : { to: query.to }),
  ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
  ...(query.limit === undefined ? {} : { limit: query.limit }),
});

/** The rep's own round and visits in the staff app (ADR-0183). */
@ApiTags('sales')
@Controller('sales-rep')
export class SalesRepVisitsController {
  constructor(private readonly visits: RepVisitsService) {}

  /** Today's stores: the weekday's plan, then what was visited outside it. */
  @Get('visits/today')
  @RequirePermission(REP)
  @ApiOkResponse({ type: RepTodayDto })
  async today(@CurrentUser() ctx: AuthContext): Promise<RepTodayDto> {
    return todayDto(await this.visits.today(ctx));
  }

  /** «Айлчилсан»: a visit of the caller now; answers the day's list afterwards. */
  @Post('visits')
  @HttpCode(200)
  @RequirePermission(REP)
  @Idempotent()
  @ApiOkResponse({ type: RepTodayDto })
  async visit(
    @CurrentUser() ctx: AuthContext,
    @Body() body: RepVisitRequestDto,
  ): Promise<RepTodayDto> {
    return todayDto(
      await this.visits.visit(ctx, {
        customerId: body.customerId,
        result: body.result,
        note: body.note ?? null,
      }),
    );
  }

  /** The caller's own week. */
  @Get('plan')
  @RequirePermission(REP)
  @ApiOkResponse({ type: [RepPlanDayDto] })
  plan(@CurrentUser() ctx: AuthContext): Promise<RepPlanDayDto[]> {
    return this.visits.plan(ctx.userId);
  }

  /** The caller sets a weekday of their own round. */
  @Put('plan/:weekday')
  @RequirePermission(REP)
  @ApiOkResponse({ type: [RepPlanDayDto] })
  setDay(
    @CurrentUser() ctx: AuthContext,
    @Param('weekday', ParseIntPipe) weekday: number,
    @Body() body: RepPlanDayRequestDto,
  ): Promise<RepPlanDayDto[]> {
    return this.visits.setDay(ctx, ctx.userId, weekday, body.customerIds);
  }
}

/** The office's side: every rep's round and the visit log (ADR-0183). */
@ApiTags('sales')
@Controller('rep-visits')
export class RepVisitsController {
  constructor(private readonly visits: RepVisitsService) {}

  @Get('reps')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [RepRefDto] })
  reps(): Promise<RepRefDto[]> {
    return this.visits.reps();
  }

  @Get('plans/:userId')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [RepPlanDayDto] })
  plan(@Param('userId', ParseIntPipe) userId: number): Promise<RepPlanDayDto[]> {
    return this.visits.plan(userId);
  }

  @Put('plans/:userId/:weekday')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [RepPlanDayDto] })
  setDay(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Param('weekday', ParseIntPipe) weekday: number,
    @Body() body: RepPlanDayRequestDto,
  ): Promise<RepPlanDayDto[]> {
    return this.visits.setDay(ctx, userId, weekday, body.customerIds);
  }

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: RepVisitPageDto })
  async list(@Query() query: RepVisitQueryDto): Promise<RepVisitPageDto> {
    const page = await this.visits.visits(queryOf(query));
    return {
      data: page.data.map((row) => ({ ...row, visitedAt: row.visitedAt.toISOString() })),
      nextCursor: page.nextCursor,
    };
  }

  @Get('summary')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [RepVisitSummaryRowDto] })
  summary(@Query() query: RepVisitQueryDto): Promise<RepVisitSummaryRowDto[]> {
    return this.visits.summary(queryOf(query));
  }
}
