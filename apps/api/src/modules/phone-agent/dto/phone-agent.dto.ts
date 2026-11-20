import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import {
  PHONE_CALL_OUTCOMES,
  PHONE_CALLBACK_STATUSES,
  PHONE_DECLINE_REASONS,
  PHONE_END_REASONS,
  PHONE_LIMITS,
  PHONE_MESSAGE_ROLES,
  type PhoneCallbackStatus,
  type PhoneCallOutcome,
  type PhoneDeclineReason,
  type PhoneEndReason,
  type PhoneMessageRole,
} from '../phone-agent.rules';

// The phone AI order line (ADR-0232): the station's routes (`phone-agent/*`, the line's key) and
// the office's (`phone-lines`, `phone-calls`, `phone-callbacks`, `phone-searches`). The tools'
// argument and answer shapes are documented in docs/modules/phone-agent.md §4.

const EVENT_ROLES = ['USER', 'AGENT'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ------------------------------------------------------------------------------------------------
// The station.

@ApiSchema({ name: 'PhoneStationStatus' })
export class PhoneStationStatusDto {
  @ApiProperty() lineId: number;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Off: the AI answers no call' }) active: boolean;
  @ApiProperty({ description: 'Inside the working hours now: staff answer, the AI does not' })
  workingHours: boolean;
  @ApiProperty({ description: 'The agent’s key and id are set on the server' })
  agentConfigured: boolean;
}

export class PhoneCallStartRequestDto {
  @ApiProperty({ description: 'Android’s id of the call, unique per line', maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(PHONE_LIMITS.callRefMax)
  callRef: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The caller’s number as the phone shows it; null or absent when withheld',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  callerPhone?: string | null;
}

@ApiSchema({ name: 'PhoneCallStart' })
export class PhoneCallStartDto {
  @ApiProperty({ description: 'false: do not pick up, the phone rings for staff' })
  answer: boolean;
  @ApiProperty() callId: number;
  @ApiProperty({
    enum: PHONE_DECLINE_REASONS,
    nullable: true,
    description: 'Why not, when `answer` is false',
  })
  reason: PhoneDeclineReason | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The conversation’s signed URL, for this call only; never stored. Null when `answer` is false and in a replayed answer (then do not pick up)',
  })
  signedUrl: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'call_id, caller_known, store_name, can_deliver, greeting',
  })
  dynamicVariables: Record<string, string | number | boolean> | null;
}

export class PhoneCallEventDto {
  @ApiProperty({ minimum: 1, maximum: PHONE_LIMITS.seqMax })
  @IsInt()
  @Min(1)
  @Max(PHONE_LIMITS.seqMax)
  seq: number;

  @ApiProperty({ enum: EVENT_ROLES })
  @IsIn(EVENT_ROLES)
  role: (typeof EVENT_ROLES)[number];

  @ApiProperty({ maxLength: PHONE_LIMITS.textMax })
  @IsString()
  @MaxLength(PHONE_LIMITS.textMax)
  text: string;

  @ApiProperty({ description: 'Milliseconds from the call’s start', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(PHONE_LIMITS.atMsMax)
  atMs: number;
}

export class PhoneCallEventsRequestDto {
  @ApiProperty({ type: [PhoneCallEventDto], minItems: 1, maxItems: PHONE_LIMITS.eventsMax })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PHONE_LIMITS.eventsMax)
  @ValidateNested({ each: true })
  @Type(() => PhoneCallEventDto)
  events: PhoneCallEventDto[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The provider’s conversation id, once the bridge knows it',
  })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_LIMITS.conversationIdMax)
  conversationId?: string | null;
}

@ApiSchema({ name: 'PhoneCallEventsResult' })
export class PhoneCallEventsResultDto {
  @ApiProperty({ description: 'How many of the batch were new' }) stored: number;
  @ApiProperty({ description: 'The highest sequence number stored for the call' }) lastSeq: number;
}

export class PhoneToolCallRequestDto {
  @ApiProperty({ description: 'Every sequence number up to this one was delivered', minimum: 0 })
  @IsInt()
  @Min(0)
  @Max(PHONE_LIMITS.seqMax)
  afterSeq: number;

  @ApiProperty({ description: 'The tool call’s own sequence number', minimum: 1 })
  @IsInt()
  @Min(1)
  @Max(PHONE_LIMITS.seqMax)
  seq: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Milliseconds from the start' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PHONE_LIMITS.atMsMax)
  atMs?: number | null;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The tool’s arguments' })
  @IsObject()
  args: Record<string, unknown>;
}

@ApiSchema({ name: 'PhoneToolAnswer' })
export class PhoneToolAnswerDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'What the agent may say; a refusal is a problem+json with its code instead',
  })
  answer: Record<string, unknown>;
}

export class PhoneCallEndRequestDto {
  @ApiProperty({ enum: PHONE_END_REASONS })
  @IsIn(PHONE_END_REASONS)
  reason: PhoneEndReason;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The call’s length, seconds' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(PHONE_LIMITS.durationMax)
  durationS?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_LIMITS.conversationIdMax)
  conversationId?: string | null;
}

@ApiSchema({ name: 'PhoneCallEnd' })
export class PhoneCallEndDto {
  @ApiProperty() callId: number;
  @ApiProperty({ enum: PHONE_CALL_OUTCOMES, nullable: true }) outcome: PhoneCallOutcome | null;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
}

// ------------------------------------------------------------------------------------------------
// The office.

@ApiSchema({ name: 'PhoneScheduleException' })
export class PhoneScheduleExceptionDto {
  @ApiProperty({ format: 'date' }) date: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
    description: 'That day’s working intervals `[from, to)`, `HH:MM`; empty: the AI all day',
  })
  intervals: [string, string][];
}

@ApiSchema({ name: 'PhoneSchedule' })
export class PhoneScheduleDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'array',
      items: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 2 },
    },
    description:
      'Per ISO weekday `1` (Monday) … `7` (Sunday): the working intervals `[from, to)`, `HH:MM`, Asia/Ulaanbaatar, in which staff answer; outside them the AI answers',
  })
  week: Record<string, [string, string][]>;
  @ApiProperty({ type: [PhoneScheduleExceptionDto] }) exceptions: PhoneScheduleExceptionDto[];
}

@ApiSchema({ name: 'PhoneLine' })
export class PhoneLineDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() active: boolean;
  @ApiProperty({ type: PhoneScheduleDto }) schedule: PhoneScheduleDto;
  @ApiProperty({ type: String, nullable: true }) greeting: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSeenAt: string | null;
  @ApiProperty({ description: 'The station called within the last two minutes' }) online: boolean;
  @ApiProperty({ description: 'Inside the working hours now' }) workingHours: boolean;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'PhoneLineCreated' })
export class PhoneLineCreatedDto {
  @ApiProperty({ type: PhoneLineDto }) line: PhoneLineDto;
  @ApiProperty({ description: 'The station’s key `bpl_<line>_<secret>`, shown this once' })
  key: string;
}

export class PhoneLineCreateRequestDto {
  @ApiProperty({ maxLength: PHONE_LIMITS.nameMax })
  @IsString()
  @MinLength(1)
  @MaxLength(PHONE_LIMITS.nameMax)
  name: string;

  @ApiPropertyOptional({ type: PhoneScheduleDto })
  @IsOptional()
  @IsObject()
  schedule?: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: PHONE_LIMITS.greetingMax })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_LIMITS.greetingMax)
  greeting?: string | null;
}

export class PhoneLineUpdateRequestDto {
  @ApiPropertyOptional({ maxLength: PHONE_LIMITS.nameMax })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(PHONE_LIMITS.nameMax)
  name?: string;

  @ApiPropertyOptional({ description: 'On: the AI answers outside the working hours' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ type: PhoneScheduleDto })
  @IsOptional()
  @IsObject()
  schedule?: Record<string, unknown>;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: PHONE_LIMITS.greetingMax })
  @IsOptional()
  @IsString()
  @MaxLength(PHONE_LIMITS.greetingMax)
  greeting?: string | null;
}

@ApiSchema({ name: 'PhoneCall' })
export class PhoneCallDto {
  @ApiProperty() id: number;
  @ApiProperty() lineId: number;
  @ApiProperty() lineName: string;
  @ApiProperty({ type: String, nullable: true, description: 'E.164 when a Mongolian number' })
  callerPhone: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'As the phone showed it' })
  callerRaw: string | null;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty({ description: 'false: the phone rang for staff' }) answered: boolean;
  @ApiProperty({ enum: PHONE_DECLINE_REASONS, nullable: true })
  declineReason: PhoneDeclineReason | null;
  @ApiProperty({ format: 'date-time' }) startedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) endedAt: string | null;
  @ApiProperty({ enum: PHONE_END_REASONS, nullable: true }) endReason: PhoneEndReason | null;
  @ApiProperty({ type: Number, nullable: true }) durationS: number | null;
  @ApiProperty({ enum: PHONE_CALL_OUTCOMES, nullable: true }) outcome: PhoneCallOutcome | null;
  @ApiProperty({ type: Number, nullable: true }) salesOrderId: number | null;
  @ApiProperty({ type: String, nullable: true }) orderNumber: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The provider’s cost figure for the conversation (its credits)',
  })
  costEstimate: string | null;
  @ApiProperty({ description: 'The transcript was checked against the provider’s' })
  reconciled: boolean;
}

@ApiSchema({ name: 'PhoneCallPage' })
export class PhoneCallPageDto {
  @ApiProperty({ type: [PhoneCallDto] }) data: PhoneCallDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class PhoneCallQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PHONE_CALL_OUTCOMES })
  @IsOptional()
  @IsIn(PHONE_CALL_OUTCOMES)
  outcome?: PhoneCallOutcome;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only calls the AI answered, or not',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  answered?: 'true' | 'false';

  @ApiPropertyOptional({
    format: 'date',
    description: 'Started on or after this day (Ulaanbaatar)',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    description: 'Started on or before this day (Ulaanbaatar)',
  })
  @IsOptional()
  @Matches(ISO_DATE)
  to?: string;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    description: 'Only calls that placed an order, or only calls that did not',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  hasOrder?: 'true' | 'false';
}

@ApiSchema({ name: 'PhoneCallMessage' })
export class PhoneCallMessageDto {
  @ApiProperty() seq: number;
  @ApiProperty({ enum: PHONE_MESSAGE_ROLES }) role: PhoneMessageRole;
  @ApiProperty({ description: 'The words; a tool’s name for a TOOL message' }) text: string;
  @ApiProperty({ description: 'Milliseconds from the call’s start' }) atMs: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'source BRIDGE or RECONCILED; for a tool: tool, args, ok, code, answer, no_hit',
  })
  meta: Record<string, unknown>;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PhoneCallDetail' })
export class PhoneCallDetailDto {
  @ApiProperty({ type: PhoneCallDto }) call: PhoneCallDto;
  @ApiProperty({ type: [PhoneCallMessageDto] }) messages: PhoneCallMessageDto[];
}

@ApiSchema({ name: 'PhoneCallback' })
export class PhoneCallbackDto {
  @ApiProperty() id: number;
  @ApiProperty() callId: number;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ type: Number, nullable: true }) customerId: number | null;
  @ApiProperty({ type: String, nullable: true }) customerName: string | null;
  @ApiProperty() reason: string;
  @ApiProperty({ enum: PHONE_CALLBACK_STATUSES }) status: PhoneCallbackStatus;
  @ApiProperty({ type: Number, nullable: true }) doneBy: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) doneAt: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PhoneCallbackPage' })
export class PhoneCallbackPageDto {
  @ApiProperty({ type: [PhoneCallbackDto] }) data: PhoneCallbackDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class PhoneCallbackQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: PHONE_CALLBACK_STATUSES, default: 'OPEN' })
  @IsOptional()
  @IsIn(PHONE_CALLBACK_STATUSES)
  status?: PhoneCallbackStatus;
}

export class PhoneCallbackCloseRequestDto {
  @ApiProperty({ enum: ['DONE', 'DROPPED'], description: 'Rang back, or left' })
  @IsIn(['DONE', 'DROPPED'])
  status: 'DONE' | 'DROPPED';
}

@ApiSchema({ name: 'PhoneNoHitSearch' })
export class PhoneNoHitSearchDto {
  @ApiProperty() callId: number;
  @ApiProperty() seq: number;
  @ApiProperty({ description: 'What the caller asked for and the catalog did not find' })
  query: string;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'PhoneNoHitSearchPage' })
export class PhoneNoHitSearchPageDto {
  @ApiProperty({ type: [PhoneNoHitSearchDto] }) data: PhoneNoHitSearchDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}
