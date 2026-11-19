import { Body, Controller, Get, Headers, HttpCode, Post, Query, Sse } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Observable } from 'rxjs';
import { type CustomerContext, CurrentCustomer, CustomerRoute, Idempotent } from '../../identity';
import { streamDuration } from '../../sales';
import {
  ChatMessagePageDto,
  ChatMessageQueryDto,
  CustomerChatConversationDto,
  CustomerChatDto,
  CustomerChatLiveEventDto,
  CustomerChatSendRequestDto,
  CustomerChatSendResultDto,
  CustomerChatUnreadDto,
} from '../dto/chat.dto';
import {
  customerChatDto,
  customerConversationDto,
  messageDto,
  messagePageDto,
} from '../dto/chat.mappers';
import { ChatHub, type ChatLiveMessage } from '../services/chat.hub';
import { ChatService } from '../services/chat.service';

/**
 * «Bto300»'s chat (ADR-0224): the store's one conversation. Every route is `@CustomerRoute()`:
 * only a customer token reaches it and the store is always the token's own; no route takes a
 * customer or a conversation id.
 */
@ApiTags('customer-app')
@ApiExtraModels(CustomerChatLiveEventDto)
@Controller('customer-app/chat')
export class CustomerChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly hub: ChatHub,
  ) {}

  /**
   * Opens the chat screen: the conversation (made with the bot's greeting the first time), its
   * newest messages, the buttons to offer and the sales rep «Залгах» calls. Marks what waited as
   * read.
   */
  @Post('open')
  @HttpCode(200)
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerChatDto })
  async open(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerChatDto> {
    return customerChatDto(await this.chat.open(ctx));
  }

  /** Older messages: pass `nextCursor` of the open call, then of each page. */
  @Get('messages')
  @CustomerRoute()
  @ApiOkResponse({ type: ChatMessagePageDto })
  async messages(
    @CurrentCustomer() ctx: CustomerContext,
    @Query() query: ChatMessageQueryDto,
  ): Promise<ChatMessagePageDto> {
    return messagePageDto(await this.chat.history(ctx, query));
  }

  /**
   * The store writes a text or presses a button. While the bot answers, its answer comes back in
   * `messages`; «Ажилтантай холбогдох» (`STAFF`) hands the conversation to staff. 429
   * TOO_MANY_REQUESTS past 12 messages a minute; 422 for a button the bot does not offer now.
   */
  @Post('messages')
  @CustomerRoute()
  @Idempotent()
  @ApiCreatedResponse({ type: CustomerChatSendResultDto })
  async send(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() body: CustomerChatSendRequestDto,
  ): Promise<CustomerChatSendResultDto> {
    const sent = await this.chat.send(ctx, {
      text: body.text ?? undefined,
      buttonId: body.buttonId ?? undefined,
    });
    return { conversation: customerConversationDto(sent), messages: sent.messages.map(messageDto) };
  }

  /** The store has seen the messages (the chat screen is open): its unread count goes to 0. */
  @Post('read')
  @HttpCode(200)
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerChatConversationDto })
  async read(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerChatConversationDto> {
    return customerConversationDto(await this.chat.readByCustomerState(ctx));
  }

  /** The badge on the chat button: reads only, and opens nothing. */
  @Get('unread')
  @CustomerRoute()
  @ApiOkResponse({ type: CustomerChatUnreadDto })
  async unread(@CurrentCustomer() ctx: CustomerContext): Promise<CustomerChatUnreadDto> {
    return { unread: await this.chat.customerUnread(ctx) };
  }

  /**
   * The store's live stream: `ready` (refetch with `open`), `message` and `conversation` (data:
   * CustomerChatLiveEvent), `resync` (refetch) and `ping`; it ends at the token's expiry and the
   * phone reconnects. The phone reads it over XHR, like the live stock.
   */
  @Sse('live')
  @CustomerRoute()
  @ApiProduces('text/event-stream')
  @ApiOkResponse({
    description:
      'Server-sent events (ADR-0224 #7): ready, message and conversation (CustomerChatLiveEvent), resync, ping; ends at the token expiry',
  })
  live(
    @CurrentCustomer() ctx: CustomerContext,
    @Headers('authorization') authorization?: string,
  ): Observable<ChatLiveMessage> {
    return this.hub.customerStream(ctx.customerId, streamDuration(authorization));
  }
}
