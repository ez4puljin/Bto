import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import {
  CHAT_LIMITS,
  CHAT_LIST_STATES,
  CHAT_MODES,
  CHAT_SENDERS,
  type ChatListState,
  type ChatMode,
  type ChatSender,
} from '@tugeel/shared/chat';

// The customer chat (ADR-0224): the wire shapes of the store's routes (`customer-app/chat/*`),
// the staff's (`chat/*`) and both live streams.

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'ChatButton' })
export class ChatButtonDto {
  @ApiProperty({
    description:
      'Opaque: sent back as `buttonId`. The scripted bot offers ORDER_STATUS, DELIVERY_INFO, BALANCE, HOURS_ADDRESS and STAFF',
  })
  id: string;
  @ApiProperty({ description: 'The Mongolian text on the button' }) label: string;
}

@ApiSchema({ name: 'ChatMessage' })
export class ChatMessageDto {
  @ApiProperty() id: number;
  @ApiProperty() conversationId: number;
  @ApiProperty({ enum: CHAT_SENDERS, enumName: 'ChatSender' }) sender: ChatSender;
  @ApiProperty({ type: Number, nullable: true, description: 'The staff member of a STAFF message' })
  staffUserId: number | null;
  @ApiProperty({ type: String, nullable: true, description: 'Their full name' })
  staffName: string | null;
  @ApiProperty({ description: 'Plain text; line breaks are `\\n`' }) body: string;
  @ApiProperty({
    type: [ChatButtonDto],
    nullable: true,
    description: 'The quick replies a BOT message carried when it was written; null = none',
  })
  buttons: ChatButtonDto[] | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The button a CUSTOMER message pressed (its label is the body); null = typed text',
  })
  buttonId: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The step of the bot’s flow that wrote a BOT message: GREETING, ORDER_STATUS, DELIVERY_INFO, BALANCE, HOURS_ADDRESS, HANDOFF, FALLBACK or CLOSED',
  })
  flowNode: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'ChatMessagePage' })
export class ChatMessagePageDto {
  @ApiProperty({ type: [ChatMessageDto], description: 'Oldest first within the page' })
  data: ChatMessageDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The cursor of the page of older messages; null = the conversation starts here',
  })
  nextCursor: string | null;
}

export class ChatMessageQueryDto {
  @ApiPropertyOptional({ description: 'nextCursor of the previous (newer) page' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  cursor?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: CHAT_LIMITS.pageMax,
    default: CHAT_LIMITS.pageDefault,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(CHAT_LIMITS.pageMax)
  limit?: number;
}

// --- the store's side

@ApiSchema({ name: 'CustomerChatConversation' })
export class CustomerChatConversationDto {
  @ApiProperty() id: number;
  @ApiProperty({
    enum: CHAT_MODES,
    enumName: 'ChatMode',
    description: 'Who answers now: the bot, or staff (the bot is then silent)',
  })
  mode: ChatMode;
  @ApiProperty({ description: 'With staff, and nobody has answered the store’s last message yet' })
  awaitingStaff: boolean;
  @ApiProperty({
    description:
      'Messages that reached the store unasked and unread: staff answers and the closing note',
  })
  unread: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  handedOffAt: string | null;
  @ApiProperty({
    type: [ChatButtonDto],
    description:
      'The buttons to offer now: the bot’s latest, «Ажилтантай холбогдох» last; empty while staff answer',
  })
  buttons: ChatButtonDto[];
}

@ApiSchema({ name: 'CustomerChatRep' })
export class CustomerChatRepDto {
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'E.164; null when none is on record' })
  phone: string | null;
}

@ApiSchema({ name: 'CustomerChat' })
export class CustomerChatDto {
  @ApiProperty({ type: CustomerChatConversationDto }) conversation: CustomerChatConversationDto;
  @ApiProperty({ type: [ChatMessageDto], description: 'The newest messages, oldest first' })
  messages: ChatMessageDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'For `GET customer-app/chat/messages`: the older messages; null = none',
  })
  nextCursor: string | null;
  @ApiProperty({
    type: CustomerChatRepDto,
    nullable: true,
    description:
      '«Залгах»: the store’s sales rep (the weekly round it stands on); null = none, the app then shows «Холбоо барих»',
  })
  rep: CustomerChatRepDto | null;
}

@ApiSchema({ name: 'CustomerChatSendRequest' })
export class CustomerChatSendRequestDto {
  @ApiPropertyOptional({
    maxLength: CHAT_LIMITS.messageMax,
    description: 'A typed message (characters, trimmed). Exactly one of `text` and `buttonId`',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  // A coarse bound: the service counts characters (code points) as the database does.
  @MaxLength(CHAT_LIMITS.messageMax * 2)
  text?: string;

  @ApiPropertyOptional({
    maxLength: CHAT_LIMITS.buttonIdMax,
    description: 'The id of a pressed button, one of `conversation.buttons`',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_LIMITS.buttonIdMax)
  buttonId?: string;
}

@ApiSchema({ name: 'CustomerChatSendResult' })
export class CustomerChatSendResultDto {
  @ApiProperty({ type: CustomerChatConversationDto }) conversation: CustomerChatConversationDto;
  @ApiProperty({
    type: [ChatMessageDto],
    description: 'The store’s message, then the bot’s answer when it gave one',
  })
  messages: ChatMessageDto[];
}

@ApiSchema({ name: 'CustomerChatUnread' })
export class CustomerChatUnreadDto {
  @ApiProperty() unread: number;
}

@ApiSchema({ name: 'CustomerChatLiveEvent' })
export class CustomerChatLiveEventDto {
  @ApiProperty({ type: CustomerChatConversationDto }) conversation: CustomerChatConversationDto;
  @ApiProperty({
    type: ChatMessageDto,
    nullable: true,
    description: 'The new message of a `message` event; null on a `conversation` event',
  })
  message: ChatMessageDto | null;
}

// --- the staff's side

@ApiSchema({ name: 'StaffChatRep' })
export class StaffChatRepDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'StaffChatConversation' })
export class StaffChatConversationDto {
  @ApiProperty() id: number;
  @ApiProperty() customerId: number;
  @ApiProperty() customerName: string;
  @ApiProperty() customerCode: string;
  @ApiProperty({ enum: CHAT_MODES, enumName: 'ChatMode' }) mode: ChatMode;
  @ApiProperty({ description: 'With staff, and nobody has answered the store’s last message yet' })
  awaitingStaff: boolean;
  @ApiProperty({ description: 'The store’s messages no staff member has seen since the hand-off' })
  unread: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  handedOffAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'The last close' })
  closedAt: string | null;
  @ApiProperty({ type: ChatMessageDto, nullable: true }) lastMessage: ChatMessageDto | null;
  @ApiProperty({
    type: [StaffChatRepDto],
    description: 'The sales reps on whose weekly round the store stands',
  })
  reps: StaffChatRepDto[];
}

@ApiSchema({ name: 'StaffChatPage' })
export class StaffChatPageDto {
  @ApiProperty({ type: [StaffChatConversationDto] }) data: StaffChatConversationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class StaffChatListQueryDto extends ChatMessageQueryDto {
  @ApiPropertyOptional({
    enum: CHAT_LIST_STATES,
    enumName: 'ChatListState',
    default: 'STAFF',
    description:
      'WAITING: awaiting an answer; STAFF: every conversation with staff; ALL: also those the bot answers (to take one over)',
  })
  @IsOptional()
  @IsIn(CHAT_LIST_STATES)
  state?: ChatListState;
}

@ApiSchema({ name: 'StaffChatReplyRequest' })
export class StaffChatReplyRequestDto {
  @ApiProperty({ maxLength: CHAT_LIMITS.messageMax, description: 'Characters, trimmed' })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_LIMITS.messageMax * 2)
  text: string;
}

@ApiSchema({ name: 'StaffChatReplyResult' })
export class StaffChatReplyResultDto {
  @ApiProperty({ type: StaffChatConversationDto }) conversation: StaffChatConversationDto;
  @ApiProperty({ type: ChatMessageDto }) message: ChatMessageDto;
}

@ApiSchema({ name: 'StaffChatUnread' })
export class StaffChatUnreadDto {
  @ApiProperty({ description: 'Conversations awaiting a staff answer' }) waiting: number;
  @ApiProperty({ description: 'The stores’ unread messages in the conversations with staff' })
  unread: number;
}

@ApiSchema({ name: 'StaffChatLiveEvent' })
export class StaffChatLiveEventDto {
  @ApiProperty({ type: StaffChatConversationDto }) conversation: StaffChatConversationDto;
  @ApiProperty({
    type: ChatMessageDto,
    nullable: true,
    description: 'The new message of a `message` event; null on a `conversation` event',
  })
  message: ChatMessageDto | null;
}

// --- the settings

@ApiSchema({ name: 'ChatTexts' })
export class ChatTextsDto {
  @ApiProperty() greeting: string;
  @ApiProperty() deliveryText: string;
  @ApiProperty() hoursText: string;
}

@ApiSchema({ name: 'ChatSettings' })
export class ChatSettingsDto {
  @ApiProperty({ type: String, nullable: true, description: 'null = the default is in force' })
  greeting: string | null;
  @ApiProperty({ type: String, nullable: true, description: '«Хүргэлтийн мэдээлэл»' })
  deliveryText: string | null;
  @ApiProperty({ type: String, nullable: true, description: '«Ажлын цаг, хаяг»' })
  hoursText: string | null;
  @ApiProperty({ type: ChatTextsDto, description: 'What the bot says where a text is null' })
  defaults: ChatTextsDto;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
}

const settingText = () =>
  ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: CHAT_LIMITS.textMax,
    description: 'Characters, trimmed; null or empty = back to the default',
  });

@ApiSchema({ name: 'ChatSettingsRequest' })
export class ChatSettingsRequestDto {
  @settingText()
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_LIMITS.textMax * 2)
  greeting?: string | null;

  @settingText()
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_LIMITS.textMax * 2)
  deliveryText?: string | null;

  @settingText()
  @IsOptional()
  @IsString()
  @MaxLength(CHAT_LIMITS.textMax * 2)
  hoursText?: string | null;
}
