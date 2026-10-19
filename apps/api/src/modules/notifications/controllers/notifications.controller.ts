import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PageQueryDto } from '../../../common/pagination/page';
import {
  Authenticated,
  type AuthContext,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  AppNoticeDto,
  AppNoticePageDto,
  AppNoticeRequestDto,
  MyNotificationPageDto,
  MyNotificationReadRequestDto,
  MyNotificationReadResultDto,
  MyNotificationSummaryDto,
} from '../dto/notifications.dto';
import { InboxService, type MyNotice, type MyNotification } from '../services/inbox.service';
import { NoticesService, type NoticeView } from '../services/notices.service';

const SEND = 'notifications.send';

const noticeDto = (view: NoticeView): AppNoticeDto => ({
  ...view,
  createdAt: view.createdAt.toISOString(),
  withdrawnAt: view.withdrawnAt?.toISOString() ?? null,
});
const myNoticeDto = (notice: MyNotice) => ({
  ...notice,
  createdAt: notice.createdAt.toISOString(),
});
const myNotificationDto = (notification: MyNotification) => ({
  ...notification,
  createdAt: notification.createdAt.toISOString(),
});

/** The admin's notices for the rep app (ADR-0062 #1, #5). */
@ApiTags('notifications')
@Controller('app-notices')
export class AppNoticesController {
  constructor(private readonly notices: NoticesService) {}

  @Get()
  @RequirePermission(SEND)
  @ApiOkResponse({ type: AppNoticePageDto })
  async list(@Query() query: PageQueryDto): Promise<AppNoticePageDto> {
    const page = await this.notices.list(query);
    return { data: page.data.map(noticeDto), nextCursor: page.nextCursor };
  }

  @Post()
  @RequirePermission(SEND)
  @Idempotent()
  @ApiCreatedResponse({ type: AppNoticeDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: AppNoticeRequestDto,
  ): Promise<AppNoticeDto> {
    return noticeDto(await this.notices.create(ctx, body));
  }

  @Post(':id/withdraw')
  @HttpCode(200)
  @RequirePermission(SEND)
  @ApiOkResponse({ type: AppNoticeDto })
  async withdraw(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<AppNoticeDto> {
    return noticeDto(await this.notices.withdraw(ctx, id));
  }
}

/** The signed-in user's notices and notifications (ADR-0062 #3): the rep app's bell. */
@ApiTags('notifications')
@Controller('me/notifications')
export class MyNotificationsController {
  constructor(private readonly inbox: InboxService) {}

  @Get('summary')
  @Authenticated()
  @ApiOkResponse({ type: MyNotificationSummaryDto })
  async summary(@CurrentUser() ctx: AuthContext): Promise<MyNotificationSummaryDto> {
    const summary = await this.inbox.summary(ctx);
    return { unread: summary.unread, notices: summary.notices.map(myNoticeDto) };
  }

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: MyNotificationPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: PageQueryDto,
  ): Promise<MyNotificationPageDto> {
    const page = await this.inbox.list(ctx, query);
    return { data: page.data.map(myNotificationDto), nextCursor: page.nextCursor };
  }

  @Post('read')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: MyNotificationReadResultDto })
  async read(
    @CurrentUser() ctx: AuthContext,
    @Body() body: MyNotificationReadRequestDto,
  ): Promise<MyNotificationReadResultDto> {
    return this.inbox.read(ctx, body);
  }
}
