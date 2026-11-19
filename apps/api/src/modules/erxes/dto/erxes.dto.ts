import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import {
  ERXES_DEAL_STATUSES,
  ERXES_PULL_FAILURES,
  ERXES_WAIT_REASONS,
  type ErxesDealStatus,
  type ErxesPullFailure,
  type ErxesWaitReason,
} from '../schema';
import {
  RANGE_COPY_MAX,
  RANGE_OUTCOMES,
  RANGE_SKIPS,
  type ErxesRangeOutcome,
  type ErxesRangeSkip,
} from '../services/erxes-range-flow.service';
import {
  ERXES_CHECK_REASONS,
  type ErxesCheck,
  erxesOrigin,
} from '../services/erxes-settings-flow.service';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** A typed address as `https://host`; anything else stays as typed and fails the pattern. */
const origin = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (erxesOrigin(value) ?? value.trim()) : value;

const ORIGIN = /^https:\/\/[^/\s]+$/;
const DATE = { type: String, format: 'date-time' } as const;
const NULL_DATE = { ...DATE, nullable: true } as const;
const NULL_TEXT = { type: String, nullable: true } as const;
const NULL_ID = { type: Number, nullable: true } as const;

// ------------------------------------------------------------------------------------------------
// The sign-in

@ApiSchema({ name: 'ErxesSettingsUpdateRequest' })
export class UpdateErxesSettingsDto {
  @ApiPropertyOptional({
    ...NULL_TEXT,
    description: "erxes's address, https only; null: the company's own",
  })
  @IsOptional()
  @Transform(origin)
  @IsString()
  @MaxLength(200)
  @Matches(ORIGIN)
  baseUrl?: string | null;

  @ApiPropertyOptional({ ...NULL_TEXT, description: 'The email of the erxes user Bto signs in as' })
  @IsOptional()
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @ApiPropertyOptional({
    ...NULL_TEXT,
    writeOnly: true,
    description: 'null removes the saved password. Never returned',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string | null;

  @ApiPropertyOptional({ description: 'New deals of the ticked pipelines are copied every minute' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

@ApiSchema({ name: 'ErxesSettingsTestRequest' })
export class TestErxesSettingsDto {
  @ApiPropertyOptional({ description: 'Typed values; the saved ones fill what is not typed' })
  @IsOptional()
  @Transform(origin)
  @IsString()
  @MaxLength(200)
  @Matches(ORIGIN)
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string;
}

@ApiSchema({ name: 'ErxesSettings' })
export class ErxesSettingsDto {
  @ApiProperty() baseUrl: string;
  @ApiProperty(NULL_TEXT) email: string | null;
  @ApiProperty({ description: 'A password is saved' }) hasPassword: boolean;
  @ApiProperty({ description: 'A saved password ERKHET_KEY_SECRET no longer opens' })
  passwordUnreadable: boolean;

  @ApiProperty({ description: 'ERKHET_KEY_SECRET is set, so a password can be saved' })
  secretReady: boolean;

  @ApiProperty({ description: 'The every-minute copy is on' }) enabled: boolean;
  @ApiProperty({ description: 'The sign-in is whole' }) complete: boolean;
  @ApiProperty(NULL_DATE) lastPullAt: Date | null;
  @ApiProperty({ ...NULL_DATE, description: 'The last pull that read every ticked pipeline' })
  lastOkAt: Date | null;

  @ApiProperty({ enum: ERXES_PULL_FAILURES, nullable: true }) lastFailure: ErxesPullFailure | null;
  @ApiProperty(NULL_TEXT) lastFailureDetail: string | null;
  @ApiProperty({ description: 'Deals that wait for a person' }) waiting: number;
  @ApiProperty(NULL_DATE) updatedAt: Date | null;
  @ApiProperty(NULL_TEXT) updatedBy: string | null;
}

@ApiSchema({ name: 'ErxesCheck' })
export class ErxesCheckDto implements ErxesCheck {
  @ApiProperty() ok: boolean;
  @ApiProperty({ enum: ERXES_CHECK_REASONS, nullable: true })
  reason: ErxesCheck['reason'];

  @ApiProperty({ ...NULL_ID, description: "erxes's HTTP status, when it gave one" })
  status: number | null;

  @ApiProperty({ ...NULL_TEXT, description: 'What erxes said when it failed, in English' })
  detail: string | null;
}

// ------------------------------------------------------------------------------------------------
// Pipelines and users

@ApiSchema({ name: 'ErxesPipeline' })
export class ErxesPipelineDto {
  @ApiProperty() id: number;
  @ApiProperty() erxesId: string;
  @ApiProperty() name: string;
  @ApiProperty(NULL_TEXT) boardName: string | null;
  @ApiProperty({ description: 'A board that is never copied' }) blocked: boolean;
  @ApiProperty({ description: 'erxes no longer lists it' }) gone: boolean;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ ...NULL_DATE, description: 'Deals created after this are copied' })
  enabledAt: Date | null;

  @ApiProperty(NULL_ID) btoPipelineId: number | null;
  @ApiProperty(NULL_ID) btoStageId: number | null;
  @ApiProperty(NULL_TEXT) btoPipelineName: string | null;
  @ApiProperty(NULL_TEXT) btoStageName: string | null;
  @ApiProperty({ description: 'The chosen stage is live and takes new orders' }) placeOk: boolean;
  @ApiProperty(NULL_DATE) lastPullAt: Date | null;
  @ApiProperty(NULL_DATE) lastSeenCreatedAt: Date | null;
}

@ApiSchema({ name: 'ErxesPipelineUpdateRequest' })
export class UpdateErxesPipelineDto {
  @ApiPropertyOptional({ description: 'Ticked: deals created from now on are copied' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ ...NULL_ID, description: 'The Bto pipeline the copies go in' })
  @IsOptional()
  @IsInt()
  @Min(1)
  btoPipelineId?: number | null;

  @ApiPropertyOptional({
    ...NULL_ID,
    description: 'A stage of it without an action; left out: its first such stage',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  btoStageId?: number | null;
}

@ApiSchema({ name: 'ErxesUser' })
export class ErxesUserDto {
  @ApiProperty() id: number;
  @ApiProperty() erxesId: string;
  @ApiProperty(NULL_TEXT) email: string | null;
  @ApiProperty(NULL_TEXT) fullName: string | null;
  @ApiProperty({ ...NULL_ID, description: 'The Bto user a person chose' }) btoUserId: number | null;
  @ApiProperty(NULL_TEXT) btoUserName: string | null;
  @ApiProperty({ ...NULL_ID, description: 'The Bto user the phone or the name finds' })
  matchedUserId: number | null;

  @ApiProperty(NULL_TEXT) matchedUserName: string | null;
}

@ApiSchema({ name: 'ErxesUserUpdateRequest' })
export class UpdateErxesUserDto {
  @ApiProperty({ ...NULL_ID, description: 'null: match by phone and name again' })
  @ValidateIf((body: UpdateErxesUserDto) => body.btoUserId !== null)
  @IsInt()
  @Min(1)
  btoUserId: number | null;
}

@ApiSchema({ name: 'ErxesPullResult' })
export class ErxesPullResultDto {
  @ApiProperty({ description: 'erxes was reached and every ticked pipeline read' }) ok: boolean;
  @ApiProperty({ enum: ERXES_PULL_FAILURES, nullable: true }) failure: ErxesPullFailure | null;
  @ApiProperty() pipelines: number;
  @ApiProperty({ description: 'Deals seen for the first time' }) seen: number;
  @ApiProperty({ description: 'Deals that became orders' }) copied: number;
  @ApiProperty({ description: 'Deals still waiting' }) waiting: number;
  @ApiProperty({ ...NULL_TEXT, description: 'What erxes said when it failed, in English' })
  detail: string | null;
}

// ------------------------------------------------------------------------------------------------
// Deals

export class ErxesDealsQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: ERXES_DEAL_STATUSES, default: 'WAITING' })
  @IsOptional()
  @IsIn(ERXES_DEAL_STATUSES)
  status?: ErxesDealStatus;
}

@ApiSchema({ name: 'ErxesWaitIssue' })
export class ErxesWaitIssueDto {
  @ApiProperty({ enum: ERXES_WAIT_REASONS }) reason: ErxesWaitReason;
  @ApiPropertyOptional() erxesProductId?: string;
  @ApiPropertyOptional({ description: "An erxes code, a product's or a customer's" }) code?: string;
  @ApiPropertyOptional() name?: string;
  @ApiPropertyOptional({ description: "ORDER_REFUSED: Bto's error code" }) errorCode?: string;
}

@ApiSchema({ name: 'ErxesDealRow' })
export class ErxesDealRowDto {
  @ApiProperty() id: number;
  @ApiProperty() erxesId: string;
  @ApiProperty({ enum: ERXES_DEAL_STATUSES }) status: ErxesDealStatus;
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty(NULL_TEXT) number: string | null;
  @ApiProperty(NULL_TEXT) pipelineName: string | null;
  @ApiProperty(NULL_TEXT) creatorName: string | null;
  @ApiProperty(NULL_DATE) erxesCreatedAt: Date | null;
  @ApiProperty({ type: [ErxesWaitIssueDto] }) issues: ErxesWaitIssueDto[];
  @ApiProperty(NULL_ID) orderId: number | null;
  @ApiProperty(NULL_DATE) lastTriedAt: Date | null;
  @ApiProperty(NULL_DATE) copiedAt: Date | null;
}

@ApiSchema({ name: 'ErxesDealPage' })
export class ErxesDealPageDto {
  @ApiProperty({ type: [ErxesDealRowDto] }) data: ErxesDealRowDto[];
  @ApiProperty(NULL_TEXT) nextCursor: string | null;
}

@ApiSchema({ name: 'ErxesUnitChoice' })
export class ErxesUnitChoiceDto {
  @ApiProperty() productUnitId: number;
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() productName: string;
  @ApiProperty() unitName: string;
}

@ApiSchema({ name: 'ErxesDealLine' })
export class ErxesDealLineDto {
  @ApiProperty(NULL_TEXT) erxesProductId: string | null;
  @ApiProperty(NULL_TEXT) code: string | null;
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty(NULL_TEXT) uom: string | null;
  @ApiProperty(NULL_TEXT) quantity: string | null;
  @ApiProperty({ ...NULL_TEXT, description: "erxes's price of one unit" }) unitPrice: string | null;
  @ApiProperty(NULL_TEXT) discount: string | null;
  @ApiProperty(NULL_TEXT) discountPercent: string | null;
  @ApiProperty(NULL_TEXT) amount: string | null;
  @ApiProperty({
    type: ErxesUnitChoiceDto,
    nullable: true,
    description: 'The Bto unit of the line',
  })
  unit: ErxesUnitChoiceDto | null;
}

@ApiSchema({ name: 'ErxesDealLabel' })
export class ErxesDealLabelDto {
  @ApiProperty() name: string;
  @ApiProperty(NULL_TEXT) color: string | null;
}

@ApiSchema({ name: 'ErxesDealField' })
export class ErxesDealFieldDto {
  @ApiProperty() label: string;
  @ApiProperty() value: string;
}

@ApiSchema({ name: 'ErxesDealParty' })
export class ErxesDealPartyDto {
  @ApiProperty({ enum: ['COMPANY', 'CUSTOMER'] }) kind: 'COMPANY' | 'CUSTOMER';
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty(NULL_TEXT) code: string | null;
  @ApiProperty(NULL_TEXT) regNo: string | null;
  @ApiProperty({ type: [String] }) phones: string[];
}

@ApiSchema({ name: 'ErxesDealAttachment' })
export class ErxesDealAttachmentDto {
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty() url: string;
}

@ApiSchema({ name: 'ErxesDealCustomer' })
export class ErxesDealCustomerDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

@ApiSchema({ name: 'ErxesDeal' })
export class ErxesDealDto extends ErxesDealRowDto {
  @ApiProperty({ description: 'Where the deal opens in erxes' }) url: string;
  @ApiProperty(NULL_TEXT) stageName: string | null;
  @ApiProperty(NULL_TEXT) description: string | null;
  @ApiProperty(NULL_DATE) startDate: Date | null;
  @ApiProperty(NULL_DATE) closeDate: Date | null;
  @ApiProperty({ ...NULL_ID, description: 'The Bto user the creator was matched to' })
  creatorUserId: number | null;

  @ApiProperty(NULL_TEXT) creatorUserName: string | null;
  @ApiProperty({ type: [String] }) assigned: string[];
  @ApiProperty({ type: [ErxesDealLabelDto] }) labels: ErxesDealLabelDto[];
  @ApiProperty({ type: [ErxesDealFieldDto] }) customFields: ErxesDealFieldDto[];
  @ApiProperty({ type: [ErxesDealPartyDto] }) parties: ErxesDealPartyDto[];
  @ApiProperty({ type: [ErxesDealLineDto] }) lines: ErxesDealLineDto[];
  @ApiProperty({ type: [ErxesDealAttachmentDto] }) attachments: ErxesDealAttachmentDto[];
  @ApiProperty({ type: ErxesDealCustomerDto, nullable: true })
  customer: ErxesDealCustomerDto | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The deal exactly as erxes answered',
  })
  raw: unknown;
}

@ApiSchema({ name: 'ErxesOrderDeal' })
export class ErxesOrderDealDto {
  @ApiProperty({
    type: ErxesDealDto,
    nullable: true,
    description: 'null: the order was made in Bto',
  })
  deal: ErxesDealDto | null;
}

@ApiSchema({ name: 'ErxesUnitChoiceInput' })
export class ErxesUnitChoiceInputDto {
  @ApiProperty() @IsString() @Length(1, 100) erxesProductId: string;

  @ApiProperty({ ...NULL_ID, description: 'null takes the choice back' })
  @ValidateIf((entry: ErxesUnitChoiceInputDto) => entry.productUnitId !== null)
  @IsInt()
  @Min(1)
  productUnitId: number | null;
}

@ApiSchema({ name: 'ErxesDealChoiceRequest' })
export class ErxesDealChoiceDto {
  @ApiPropertyOptional({ ...NULL_ID, description: 'The Bto customer; null takes the choice back' })
  @IsOptional()
  @IsInt()
  @Min(1)
  customerId?: number | null;

  @ApiPropertyOptional({ type: [ErxesUnitChoiceInputDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ErxesUnitChoiceInputDto)
  units?: ErxesUnitChoiceInputDto[];
}

// ------------------------------------------------------------------------------------------------
// The range copy (ADR-0220)

const DAY = /^\d{4}-\d{2}-\d{2}$/;

@ApiSchema({ name: 'ErxesRangePipeline' })
export class ErxesRangePipelineDto {
  @ApiProperty() id: number;
  @ApiProperty() erxesId: string;
  @ApiProperty() name: string;
  @ApiProperty(NULL_TEXT) boardName: string | null;
  @ApiProperty({ description: 'Ticked for the minute pull: chosen by default' }) enabled: boolean;
}

@ApiSchema({ name: 'ErxesRangeRequest' })
export class ErxesRangeRequestDto {
  @ApiProperty({ format: 'date', description: 'The first day, in Ulaanbaatar' })
  @IsString()
  @Matches(DAY)
  from: string;

  @ApiProperty({
    format: 'date',
    description: 'The last day, whole, in Ulaanbaatar; 31 days at most',
  })
  @IsString()
  @Matches(DAY)
  to: string;

  @ApiProperty({ type: [Number], description: 'The erxes pipelines to read (their Bto ids)' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Min(1, { each: true })
  pipelineIds: number[];
}

@ApiSchema({ name: 'ErxesRangeDealRef' })
export class ErxesRangeDealRefDto {
  @ApiProperty() @IsString() @Length(1, 100) erxesId: string;
  @ApiProperty({ description: 'The erxes pipeline it was listed in (its Bto id)' })
  @IsInt()
  @Min(1)
  pipelineId: number;
}

@ApiSchema({ name: 'ErxesRangeCopyRequest' })
export class ErxesRangeCopyRequestDto extends ErxesRangeRequestDto {
  @ApiProperty({
    type: [ErxesRangeDealRefDto],
    description: `The ticked deals, ${RANGE_COPY_MAX} at most a request`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RANGE_COPY_MAX)
  @ValidateNested({ each: true })
  @Type(() => ErxesRangeDealRefDto)
  deals: ErxesRangeDealRefDto[];
}

@ApiSchema({ name: 'ErxesRangeKnown' })
export class ErxesRangeKnownDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ERXES_DEAL_STATUSES }) status: ErxesDealStatus;
  @ApiProperty(NULL_ID) orderId: number | null;
}

@ApiSchema({ name: 'ErxesRangeDeal' })
export class ErxesRangeDealDto {
  @ApiProperty() erxesId: string;
  @ApiProperty() pipelineId: number;
  @ApiProperty() pipelineName: string;
  @ApiProperty(NULL_TEXT) number: string | null;
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty(NULL_DATE) createdAt: Date | null;
  @ApiProperty(NULL_TEXT) creatorName: string | null;
  @ApiProperty(NULL_TEXT) stageName: string | null;
  @ApiProperty(NULL_TEXT) customerName: string | null;
  @ApiProperty({ ...NULL_ID, description: 'Lines; null when erxes did not list them' })
  lines: number | null;

  @ApiProperty({ ...NULL_TEXT, description: "erxes's total" }) total: string | null;
  @ApiProperty({
    type: ErxesRangeKnownDto,
    nullable: true,
    description: 'The row Bto holds of it; null: new to Bto',
  })
  known: ErxesRangeKnownDto | null;
}

@ApiSchema({ name: 'ErxesRangePreview' })
export class ErxesRangePreviewDto {
  @ApiProperty() ok: boolean;
  @ApiProperty({ enum: ERXES_PULL_FAILURES, nullable: true }) failure: ErxesPullFailure | null;
  @ApiProperty(NULL_TEXT) detail: string | null;
  @ApiProperty({ description: 'More deals than a range may read: narrow it' }) tooMany: boolean;
  @ApiProperty({ type: [ErxesRangeDealDto] }) deals: ErxesRangeDealDto[];
}

@ApiSchema({ name: 'ErxesRangeResult' })
export class ErxesRangeResultDto {
  @ApiProperty() erxesId: string;
  @ApiProperty({ enum: RANGE_OUTCOMES }) outcome: ErxesRangeOutcome;
  @ApiProperty(NULL_ID) dealId: number | null;
  @ApiProperty(NULL_ID) orderId: number | null;
  @ApiProperty({ type: [ErxesWaitIssueDto] }) issues: ErxesWaitIssueDto[];
  @ApiProperty({ enum: RANGE_SKIPS, nullable: true }) skip: ErxesRangeSkip | null;
  @ApiProperty({ enum: ERXES_PULL_FAILURES, nullable: true }) failure: ErxesPullFailure | null;
  @ApiProperty(NULL_TEXT) detail: string | null;
}

@ApiSchema({ name: 'ErxesRangeCopy' })
export class ErxesRangeCopyDto {
  @ApiProperty({ description: 'erxes answered every deal it was asked for' }) ok: boolean;
  @ApiProperty({ enum: ERXES_PULL_FAILURES, nullable: true }) failure: ErxesPullFailure | null;
  @ApiProperty(NULL_TEXT) detail: string | null;
  @ApiProperty() copied: number;
  @ApiProperty() waiting: number;
  @ApiProperty() skipped: number;
  @ApiProperty() failed: number;
  @ApiProperty({ type: [ErxesRangeResultDto] }) results: ErxesRangeResultDto[];
}
