import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import {
  Authenticated,
  type AuthContext,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import { streamDuration } from '../../sales';
import {
  ChatMessagePageDto,
  ChatMessageQueryDto,
  ChatSettingsDto,
  ChatSettingsRequestDto,
  StaffChatConversationDto,
  StaffChatListQueryDto,
  StaffChatLiveEventDto,
  StaffChatPageDto,
  StaffChatReplyRequestDto,
  StaffChatReplyResultDto,
  StaffChatUnreadDto,
} from '../dto/chat.dto';
import { messageDto, messagePageDto, settingsDto, staffConversationDto } from '../dto/chat.mappers';
import { ChatRepsService } from '../services/chat-reps.service';
import { CHAT_SETTINGS_MANAGE, ChatSettingsService } from '../services/chat-settings.service';
import { ChatHub, type ChatLiveMessage } from '../services/chat.hub';
import { ChatService } from '../services/chat.service';

/**
 * The staff's side of the customer chat (ADR-0224 #5). The routes are `@Authenticated()` and the
 * service decides the scope: `chat.answer` reads and answers every store's conversation,
 * `chat.answer_own` (the sales rep) only those of the stores on the caller's own weekly round;
 * with neither every route answers 403 FORBIDDEN, and a conversation outside the scope 404.
 */
@ApiTags('chat')
@ApiExtraModels(StaffChatLiveEventDto)
@Controller('chat')
export class StaffChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly reps: ChatRepsService,
    private readonly hub: ChatHub,
  ) {}

  /** The conversations with staff (or `state`), the latest message first. */
  @Get('conversations')
  @Authenticated()
  @ApiOkResponse({ type: StaffChatPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StaffChatListQueryDto,
  ): Promise<StaffChatPageDto> {
    const page = await this.chat.list(ctx, query);
    return { data: page.data.map(staffConversationDto), nextCursor: page.nextCursor };
  }

  /** The badge: conversations awaiting an answer and the stores' unread messages. */
  @Get('unread')
  @Authenticated()
  @ApiOkResponse({ type: StaffChatUnreadDto })
  unread(@CurrentUser() ctx: AuthContext): Promise<StaffChatUnreadDto> {
    return this.chat.staffUnread(ctx);
  }

  /**
   * The staff's live stream: `ready` (refetch), `message` and `conversation` (data:
   * StaffChatLiveEvent, only of the stores in the caller's scope), `resync` (refetch) and `ping`;
   * it ends at the token's expiry.
   */
  @Sse('live')
  @Authenticated()
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Server-sent events (ADR-0224 #7): ready, message and conversation (StaffChatLiveEvent), resync, ping; ends at the token expiry',
  })
  async live(
    @CurrentUser() ctx: AuthContext,
    @Headers('authorization') authorization?: string,
  ): Promise<Observable<ChatLiveMessage>> {
    const scope = await this.reps.scopeOf(ctx);
    return this.hub.staffStream(ctx, scope, streamDuration(authorization));
  }

  @Get('conversations/:id')
  @Authenticated()
  @ApiOkResponse({ type: StaffChatConversationDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StaffChatConversationDto> {
    return staffConversationDto(await this.chat.get(ctx, id));
  }

  /** The newest messages, oldest first; `nextCursor` reads the older ones. */
  @Get('conversations/:id/messages')
  @Authenticated()
  @ApiOkResponse({ type: ChatMessagePageDto })
  async messages(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ChatMessageQueryDto,
  ): Promise<ChatMessagePageDto> {
    return messagePageDto(await this.chat.messages(ctx, id, query));
  }

  /**
   * A staff answer. Answering a conversation the bot still holds takes it over (ADR-0224 #6): the
   * bot is silent until somebody closes it.
   */
  @Post('conversations/:id/messages')
  @Authenticated()
  @Idempotent()
  @ApiCreatedResponse({ type: StaffChatReplyResultDto })
  async reply(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: StaffChatReplyRequestDto,
  ): Promise<StaffChatReplyResultDto> {
    const { chat, message } = await this.chat.reply(ctx, id, body);
    return { conversation: staffConversationDto(chat), message: messageDto(message) };
  }

  /** The caller has seen the store's messages: the conversation's unread count goes to 0. */
  @Post('conversations/:id/read')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: StaffChatConversationDto })
  async read(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StaffChatConversationDto> {
    return staffConversationDto(await this.chat.readByStaff(ctx, id));
  }

  /** Closes the conversation: it goes back to the bot, the history stays (ADR-0224 #6). */
  @Post('conversations/:id/close')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: StaffChatConversationDto })
  async close(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StaffChatConversationDto> {
    return staffConversationDto(await this.chat.close(ctx, id));
  }
}

/** The bot's greeting and two fixed texts (ADR-0224 #2). */
@ApiTags('chat')
@Controller('chat/settings')
export class ChatSettingsController {
  constructor(private readonly settings: ChatSettingsService) {}

  @Get()
  @RequirePermission(CHAT_SETTINGS_MANAGE)
  @ApiOkResponse({ type: ChatSettingsDto })
  async get(): Promise<ChatSettingsDto> {
    return settingsDto(await this.settings.view());
  }

  /** Writes all three texts; a null or empty one goes back to its default. */
  @Put()
  @RequirePermission(CHAT_SETTINGS_MANAGE)
  @ApiOkResponse({ type: ChatSettingsDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Body() body: ChatSettingsRequestDto,
  ): Promise<ChatSettingsDto> {
    return settingsDto(await this.settings.update(ctx, body));
  }
}
