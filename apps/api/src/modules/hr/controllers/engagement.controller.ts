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
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  HrAttendanceInsightsDto,
  HrCalendarItemDto,
  HrCalendarQueryDto,
  HrEventDoneRequestDto,
  HrEventTypeArchiveRequestDto,
  HrEventTypeDto,
  HrEventTypeRequestDto,
  HrEventRequestDto,
  HrFeedbackDecisionDto,
  HrFeedbackDto,
  HrFeedbackQueryDto,
  HrFeedbackRequestDto,
  HrFeedDto,
  HrInsightYearQueryDto,
  HrLocationShareDto,
  HrLocationShareRequestDto,
  HrLocationSharesQueryDto,
  HrMessageDto,
  HrMessageRequestDto,
  HrMessagesQueryDto,
  HrMoodRequestDto,
  HrMoodsDto,
  HrMyMessageDto,
  HrMyMoodDto,
  HrPollAnswersRequestDto,
  HrPollDto,
  HrPollRequestDto,
  HrPollsQueryDto,
  HrProfileDto,
  HrProfileRequestDto,
  HrRangeQueryDto,
  HrReadMessagesRequestDto,
  HrRequestInsightsDto,
  HrStaffDetailsRequestDto,
  HrThanksDto,
  HrThanksEntryDto,
  HrThanksRequestDto,
  HrWorkforceInsightsDto,
} from '../dto/engagement.dto';
import { HrStaffDto } from '../dto/workforce.dto';
import { EngagementService } from '../services/engagement.service';
import { HrInsightsService } from '../services/insights.service';
import { ATTENDANCE_MANAGE, ATTENDANCE_VIEW } from '../services/work-sites.service';
import { WorkforceService } from '../services/workforce.service';

/**
 * The staff's own side (ADR-0146): what every signed-in staff member reads and answers, and what
 * HR writes and reads about it.
 */
@ApiTags('hr')
@Controller('hr')
export class EngagementController {
  constructor(
    private readonly engagement: EngagementService,
    private readonly insights: HrInsightsService,
    private readonly workforce: WorkforceService,
  ) {}

  // ── the employee's own ─────────────────────────────────────────────────────

  @Get('me/feed')
  @Authenticated()
  @ApiOkResponse({ type: HrFeedDto })
  feed(@CurrentUser() ctx: AuthContext): Promise<HrFeedDto> {
    return this.engagement.feed(ctx);
  }

  @Get('me/messages')
  @Authenticated()
  @ApiOkResponse({ type: [HrMyMessageDto] })
  myMessages(
    @CurrentUser() ctx: AuthContext,
    @Query() query: HrMessagesQueryDto,
  ): Promise<HrMyMessageDto[]> {
    return this.engagement.myMessages(ctx, query.kind);
  }

  @Post('me/messages/read')
  @HttpCode(204)
  @Authenticated()
  @ApiNoContentResponse()
  readMessages(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrReadMessagesRequestDto,
  ): Promise<void> {
    return this.engagement.readMessages(ctx, body.ids);
  }

  @Get('me/polls')
  @Authenticated()
  @ApiOkResponse({ type: [HrPollDto] })
  myPolls(@CurrentUser() ctx: AuthContext): Promise<HrPollDto[]> {
    return this.engagement.myPolls(ctx);
  }

  @Post('me/polls/:id/answers')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: HrPollDto })
  answerPoll(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrPollAnswersRequestDto,
  ): Promise<HrPollDto> {
    return this.engagement.answerPoll(ctx, id, body.answers);
  }

  @Put('me/mood')
  @Authenticated()
  @ApiOkResponse({ type: HrMyMoodDto })
  setMood(@CurrentUser() ctx: AuthContext, @Body() body: HrMoodRequestDto): Promise<HrMyMoodDto> {
    return this.engagement.setMood(ctx, body.score);
  }

  @Get('me/feedback')
  @Authenticated()
  @ApiOkResponse({ type: [HrFeedbackDto] })
  myFeedback(@CurrentUser() ctx: AuthContext): Promise<HrFeedbackDto[]> {
    return this.engagement.myFeedback(ctx);
  }

  @Post('me/feedback')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: HrFeedbackDto })
  sendFeedback(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrFeedbackRequestDto,
  ): Promise<HrFeedbackDto> {
    return this.engagement.sendFeedback(ctx, body);
  }

  @Get('me/locations')
  @Authenticated()
  @ApiOkResponse({ type: [HrLocationShareDto] })
  myLocations(@CurrentUser() ctx: AuthContext): Promise<HrLocationShareDto[]> {
    return this.engagement.myLocations(ctx);
  }

  @Post('me/locations')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: HrLocationShareDto })
  shareLocation(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrLocationShareRequestDto,
  ): Promise<HrLocationShareDto> {
    return this.engagement.shareLocation(ctx, body);
  }

  @Get('me/profile')
  @Authenticated()
  @ApiOkResponse({ type: HrProfileDto })
  myProfile(@CurrentUser() ctx: AuthContext): Promise<HrProfileDto> {
    return this.workforce.profile(ctx.userId);
  }

  @Put('me/profile')
  @Authenticated()
  @ApiOkResponse({ type: HrProfileDto })
  saveProfile(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrProfileRequestDto,
  ): Promise<HrProfileDto> {
    return this.workforce.saveProfile(ctx, ctx.userId, body);
  }

  // ── open to every staff member ─────────────────────────────────────────────

  /** As on the old calendar, whoever does the work marks it; who and when are kept (ADR-0171 #8). */
  @Put('events/:id/done')
  @Authenticated()
  @ApiOkResponse({ type: HrCalendarItemDto })
  setEventDone(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrEventDoneRequestDto,
  ): Promise<HrCalendarItemDto> {
    return this.engagement.setEventDone(ctx, id, body.done);
  }

  @Get('calendar')
  @Authenticated()
  @ApiOkResponse({ type: [HrCalendarItemDto] })
  calendar(@Query() query: HrCalendarQueryDto): Promise<HrCalendarItemDto[]> {
    return this.engagement.calendar(query.month);
  }

  /** Open to every staff member: the calendar's legend reads it. */
  @Get('event-types')
  @Authenticated()
  @ApiOkResponse({ type: [HrEventTypeDto] })
  eventTypes(@Query('includeArchived') includeArchived?: string): Promise<HrEventTypeDto[]> {
    return this.engagement.eventTypes(includeArchived === 'true');
  }

  @Get('thanks')
  @Authenticated()
  @ApiOkResponse({ type: HrThanksDto })
  thanks(@Query() query: HrRangeQueryDto): Promise<HrThanksDto> {
    return this.engagement.thanks(query);
  }

  @Post('thanks')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: HrThanksEntryDto })
  sendThanks(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrThanksRequestDto,
  ): Promise<HrThanksEntryDto> {
    return this.engagement.sendThanks(ctx, body);
  }

  // ── HR ─────────────────────────────────────────────────────────────────────

  @Get('messages')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrMessageDto] })
  messages(@Query() query: HrMessagesQueryDto): Promise<HrMessageDto[]> {
    return this.engagement.messages(query);
  }

  @Post('messages')
  @RequirePermission(ATTENDANCE_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: HrMessageDto })
  createMessage(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrMessageRequestDto,
  ): Promise<HrMessageDto> {
    return this.engagement.createMessage(ctx, body);
  }

  @Post('messages/:id/withdraw')
  @HttpCode(200)
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrMessageDto })
  withdrawMessage(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HrMessageDto> {
    return this.engagement.withdrawMessage(ctx, id);
  }

  @Get('polls')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrPollDto] })
  polls(@CurrentUser() ctx: AuthContext, @Query() query: HrPollsQueryDto): Promise<HrPollDto[]> {
    return this.engagement.polls(ctx, query.kind);
  }

  @Post('polls')
  @RequirePermission(ATTENDANCE_MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: HrPollDto })
  createPoll(@CurrentUser() ctx: AuthContext, @Body() body: HrPollRequestDto): Promise<HrPollDto> {
    return this.engagement.createPoll(ctx, body);
  }

  @Post('polls/:id/close')
  @HttpCode(200)
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrPollDto })
  closePoll(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HrPollDto> {
    return this.engagement.closePoll(ctx, id);
  }

  @Get('moods')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrMoodsDto })
  moods(@Query() query: HrRangeQueryDto): Promise<HrMoodsDto> {
    return this.engagement.moods(query);
  }

  @Get('feedback')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrFeedbackDto] })
  feedback(@Query() query: HrFeedbackQueryDto): Promise<HrFeedbackDto[]> {
    return this.engagement.feedback(query);
  }

  @Put('feedback/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrFeedbackDto })
  decideFeedback(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrFeedbackDecisionDto,
  ): Promise<HrFeedbackDto> {
    return this.engagement.decideFeedback(ctx, id, body);
  }

  @Get('location-shares')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: [HrLocationShareDto] })
  locations(@Query() query: HrLocationSharesQueryDto): Promise<HrLocationShareDto[]> {
    return this.engagement.locations(query);
  }

  @Post('event-types')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: HrEventTypeDto })
  createEventType(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrEventTypeRequestDto,
  ): Promise<HrEventTypeDto> {
    return this.engagement.saveEventType(ctx, null, body);
  }

  @Put('event-types/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrEventTypeDto })
  updateEventType(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrEventTypeRequestDto,
  ): Promise<HrEventTypeDto> {
    return this.engagement.saveEventType(ctx, id, body);
  }

  @Put('event-types/:id/archived')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrEventTypeDto })
  archiveEventType(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrEventTypeArchiveRequestDto,
  ): Promise<HrEventTypeDto> {
    return this.engagement.setEventTypeArchived(ctx, id, body.archived);
  }

  @Post('events')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiCreatedResponse({ type: HrCalendarItemDto })
  createEvent(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrEventRequestDto,
  ): Promise<HrCalendarItemDto> {
    return this.engagement.saveEvent(ctx, null, body);
  }

  @Put('events/:id')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrCalendarItemDto })
  updateEvent(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrEventRequestDto,
  ): Promise<HrCalendarItemDto> {
    return this.engagement.saveEvent(ctx, id, body);
  }

  @Delete('events/:id')
  @HttpCode(204)
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiNoContentResponse()
  archiveEvent(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.engagement.archiveEvent(ctx, id);
  }

  @Put('staff/:userId/details')
  @RequirePermission(ATTENDANCE_MANAGE)
  @ApiOkResponse({ type: HrStaffDto })
  saveDetails(
    @CurrentUser() ctx: AuthContext,
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: HrStaffDetailsRequestDto,
  ): Promise<HrStaffDto> {
    return this.workforce.saveDetails(ctx, userId, body);
  }

  @Get('insights/workforce')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrWorkforceInsightsDto })
  workforceInsights(@Query() query: HrRangeQueryDto): Promise<HrWorkforceInsightsDto> {
    return this.insights.workforceFigures(query);
  }

  @Get('insights/attendance')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrAttendanceInsightsDto })
  attendanceInsights(@Query() query: HrRangeQueryDto): Promise<HrAttendanceInsightsDto> {
    return this.insights.attendanceFigures(query);
  }

  @Get('insights/requests')
  @RequirePermission(ATTENDANCE_VIEW)
  @ApiOkResponse({ type: HrRequestInsightsDto })
  requestInsights(@Query() query: HrInsightYearQueryDto): Promise<HrRequestInsightsDto> {
    return this.insights.requestFigures(query.year);
  }
}
