import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SETTLEMENT_GROUPS, type SettlementGroup } from '@tugeel/shared/finance';
import {
  SMS_BATCH_STATUSES,
  SMS_LIMITS,
  SMS_MESSAGE_STATUSES,
  SMS_PURPOSES,
  type SmsBatchStatus,
  type SmsMessageStatus,
  type SmsPurpose,
} from '@tugeel/shared/notifications';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

// ------------------------------------------------------------------------------------------------
// The list

@ApiSchema({ name: 'SettlementSmsCustomersQuery' })
export class SettlementSmsCustomersQueryDto {
  @ApiProperty({ enum: SETTLEMENT_GROUPS, enumName: 'SettlementGroup' })
  @IsIn(SETTLEMENT_GROUPS)
  group: SettlementGroup;

  @ApiPropertyOptional({ description: "Part of a customer's code, name or phone" })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Only customers whose balance is above zero' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  withBalance?: boolean;
}

@ApiSchema({ name: 'SettlementPeriod' })
export class SettlementPeriodDto {
  @ApiProperty({ example: '2026-10-21' }) from: string;
  @ApiProperty({ example: '2026-11-20' }) to: string;
  @ApiProperty({ example: '2026-11-20' }) dueDate: string;
}

@ApiSchema({ name: 'SettlementSmsCustomer' })
export class SettlementSmsCustomerDto {
  @ApiProperty() customerId: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, example: '+97699112233' }) phone: string | null;
  @ApiProperty({ enum: SETTLEMENT_GROUPS, enumName: 'SettlementGroup' })
  settlementGroup: SettlementGroup;
  @ApiProperty({ example: '1250000.00', description: 'The receivable balance now' })
  balance: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) lastSentAt: string | null;
}

@ApiSchema({ name: 'SettlementSmsCustomers' })
export class SettlementSmsCustomersDto {
  @ApiProperty({ enum: SETTLEMENT_GROUPS, enumName: 'SettlementGroup' }) group: SettlementGroup;
  @ApiProperty({ type: SettlementPeriodDto }) period: SettlementPeriodDto;
  @ApiProperty({ type: [SettlementSmsCustomerDto] }) data: SettlementSmsCustomerDto[];
}

// ------------------------------------------------------------------------------------------------
// Batches

@ApiSchema({ name: 'SmsBatchRequest' })
export class CreateSmsBatchDto {
  @ApiProperty({ enum: SETTLEMENT_GROUPS, enumName: 'SettlementGroup' })
  @IsIn(SETTLEMENT_GROUPS)
  group: SettlementGroup;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SMS_LIMITS.batchMax)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  customerIds: number[];

  @ApiProperty({ description: 'The text with its placeholders, as typed' })
  @IsString()
  @MinLength(1)
  @MaxLength(SMS_LIMITS.templateMax)
  template: string;

  @ApiPropertyOptional({ description: 'Skip a customer whose balance is no longer above zero' })
  @IsOptional()
  @IsBoolean()
  onlyWithBalance?: boolean;
}

@ApiSchema({ name: 'SmsBatch' })
export class SmsBatchDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: SMS_PURPOSES, enumName: 'SmsPurpose' }) purpose: SmsPurpose;
  @ApiProperty({ enum: SETTLEMENT_GROUPS, enumName: 'SettlementGroup', nullable: true })
  settlementGroup: SettlementGroup | null;
  @ApiProperty() template: string;
  @ApiProperty({ enum: SMS_BATCH_STATUSES, enumName: 'SmsBatchStatus' }) status: SmsBatchStatus;
  @ApiProperty() totalCount: number;
  @ApiProperty() queuedCount: number;
  @ApiProperty() sentCount: number;
  @ApiProperty() failedCount: number;
  @ApiProperty() skippedCount: number;
  @ApiProperty({ description: "WeSend's credits the sent texts took (1 credit = 1₮)" })
  creditsUsed: number;
  @ApiProperty({ type: String, nullable: true, description: 'Why the batch stopped early' })
  stoppedCode: string | null;
  @ApiProperty() createdBy: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt: string | null;
}

@ApiSchema({ name: 'SmsBatchPage' })
export class SmsBatchPageDto {
  @ApiProperty({ type: [SmsBatchDto] }) data: SmsBatchDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'SmsBatchesQuery' })
export class SmsBatchesQueryDto extends PageQueryDto {}

@ApiSchema({ name: 'SmsMessage' })
export class SmsMessageDto {
  @ApiProperty() id: number;
  @ApiProperty() customerId: number;
  @ApiProperty() customerCode: string;
  @ApiProperty() customerName: string;
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
  @ApiProperty({ description: 'The text as frozen for this customer' }) text: string;
  @ApiProperty({ example: '1250000.00' }) balance: string;
  @ApiProperty({ enum: SMS_MESSAGE_STATUSES, enumName: 'SmsMessageStatus' })
  status: SmsMessageStatus;
  @ApiProperty({ type: Number, nullable: true }) parts: number | null;
  @ApiProperty({ type: Number, nullable: true }) credits: number | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'SMS_ERROR_CODES or a new WeSend code',
  })
  errorCode: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) sentAt: string | null;
}

@ApiSchema({ name: 'SmsBatchDetail' })
export class SmsBatchDetailDto {
  @ApiProperty({ type: SmsBatchDto }) batch: SmsBatchDto;
  @ApiProperty({ type: [SmsMessageDto] }) messages: SmsMessageDto[];
}

/** Whether sending can start, without asking WeSend (finance.read). */
@ApiSchema({ name: 'SmsStatus' })
export class SmsStatusDto {
  @ApiProperty({ description: 'A key is saved and opens, and sending is on' }) ready: boolean;
  @ApiProperty({ type: String, nullable: true, example: 'not_configured' }) reason: string | null;
}

// ------------------------------------------------------------------------------------------------
// Settings

@ApiSchema({ name: 'SmsSettings' })
export class SmsSettingsDto {
  @ApiProperty() hasKey: boolean;
  @ApiProperty({ type: String, nullable: true, example: '9f2c' }) keyLast4: string | null;
  @ApiProperty() keyUnreadable: boolean;
  @ApiProperty() secretReady: boolean;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) updatedBy: string | null;
}

/** 1–255 printable ASCII: what WeSend accepts in a header. */
const API_KEY = /^[\x21-\x7e]{8,255}$/;

@ApiSchema({ name: 'SmsSettingsUpdateRequest' })
export class UpdateSmsSettingsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "WeSend's key; null removes it. Never returned.",
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(API_KEY)
  apiKey?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

@ApiSchema({ name: 'SmsSettingsTestRequest' })
export class TestSmsSettingsDto {
  @ApiPropertyOptional({ description: 'A typed key; without it the saved one' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(API_KEY)
  apiKey?: string;
}

@ApiSchema({ name: 'SmsCheck' })
export class SmsCheckDto {
  @ApiProperty() ok: boolean;
  @ApiProperty({ type: Number, nullable: true, description: 'Credits left (1 credit = 1₮)' })
  balance: number | null;
  @ApiProperty({ type: String, nullable: true, example: 'invalid_api_key' }) reason: string | null;
}
