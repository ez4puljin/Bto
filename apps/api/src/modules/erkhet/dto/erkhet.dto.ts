import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  ERKHET_COMPANY_ID_PATTERN,
  ERKHET_FAILURES,
  ERKHET_LIMITS,
  ERKHET_RESOLUTIONS,
  ERKHET_RUN_STATUSES,
  ERKHET_SYNC_ISSUES,
  ERKHET_SYNC_KINDS,
  type ErkhetFailure,
  type ErkhetResolution,
  type ErkhetRunStatus,
  type ErkhetSyncIssue,
  type ErkhetSyncKind,
} from '@tugeel/shared/erkhet';
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
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { ERKHET_RUN_TRIGGERS, type ErkhetRunTrigger } from '../schema';
import {
  ERKHET_CHECK_REASONS,
  type ErkhetCheck,
  erkhetOrigin,
} from '../services/erkhet-settings-flow.service';
import type { ErkhetItem, ErkhetOverview, ErkhetRun } from '../services/erkhet-sync.service';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** A typed address as `https://host`; anything else stays as typed and fails the pattern. */
const origin = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (erkhetOrigin(value) ?? value.trim()) : value;
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
};

const ORIGIN = /^https:\/\/[^/\s]+$/;

// ------------------------------------------------------------------------------------------------
// Settings

@ApiSchema({ name: 'ErkhetSettingsUpdateRequest' })
export class UpdateErkhetSettingsDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "Erkhet's address, https only",
  })
  @IsOptional()
  @Transform(origin)
  @IsString()
  @MaxLength(200)
  @Matches(ORIGIN)
  baseUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The company inside Erkhet' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Matches(ERKHET_COMPANY_ID_PATTERN)
  companyId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 120)
  username?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    writeOnly: true,
    description: 'null removes the saved password. Never returned',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string | null;

  @ApiPropertyOptional({ description: 'A check every night' })
  @IsOptional()
  @IsBoolean()
  nightly?: boolean;
}

@ApiSchema({ name: 'ErkhetSettingsTestRequest' })
export class TestErkhetSettingsDto {
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
  @IsString()
  @Matches(ERKHET_COMPANY_ID_PATTERN)
  companyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @Length(1, 120)
  username?: string;

  @ApiPropertyOptional({ writeOnly: true })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string;
}

@ApiSchema({ name: 'ErkhetSettings' })
export class ErkhetSettingsDto {
  @ApiProperty({ type: String, nullable: true }) baseUrl: string | null;
  @ApiProperty({ type: String, nullable: true }) companyId: string | null;
  @ApiProperty({ type: String, nullable: true }) username: string | null;
  @ApiProperty({ description: 'A password is saved' }) hasPassword: boolean;
  @ApiProperty({ description: 'A saved password ERKHET_KEY_SECRET no longer opens' })
  passwordUnreadable: boolean;

  @ApiProperty({ description: 'ERKHET_KEY_SECRET is set, so a password can be saved' })
  secretReady: boolean;

  @ApiProperty() nightly: boolean;
  @ApiProperty({ description: 'Everything a check needs is saved' }) complete: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) updatedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) updatedBy: string | null;
}

@ApiSchema({ name: 'ErkhetSettingsTestResult' })
export class ErkhetCheckDto implements ErkhetCheck {
  @ApiProperty() ok: boolean;
  @ApiProperty({ enum: ERKHET_CHECK_REASONS, nullable: true })
  reason: ErkhetCheck['reason'];

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Erkhet's HTTP status, when it gave one",
  })
  status: number | null;
}

// ------------------------------------------------------------------------------------------------
// Checks

@ApiSchema({ name: 'ErkhetListSummary' })
export class ErkhetListSummaryDto {
  @ApiProperty({ description: "Rows in Erkhet's list" }) erkhet: number;
  @ApiProperty({ description: "Active rows on Bto's side" }) bto: number;
  @ApiProperty({ description: 'Erkhet rows that agree with Bto' }) agreed: number;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    description: 'Rows per issue',
  })
  issues: Partial<Record<ErkhetSyncIssue, number>>;
}

@ApiSchema({ name: 'ErkhetRunSummary' })
export class ErkhetRunSummaryDto {
  @ApiProperty({ type: ErkhetListSummaryDto }) customers: ErkhetListSummaryDto;
  @ApiProperty({ type: ErkhetListSummaryDto }) products: ErkhetListSummaryDto;
}

@ApiSchema({ name: 'ErkhetRun' })
export class ErkhetRunDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ERKHET_RUN_STATUSES }) status: ErkhetRunStatus;
  @ApiProperty({ enum: ERKHET_RUN_TRIGGERS }) trigger: ErkhetRunTrigger;
  @ApiProperty({ type: String, nullable: true }) startedBy: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) finishedAt: string | null;
  @ApiProperty({ enum: ERKHET_FAILURES, nullable: true }) failure: ErkhetFailure | null;
  @ApiProperty({ type: ErkhetRunSummaryDto, nullable: true })
  summary: ErkhetRunSummaryDto | null;

  @ApiProperty({ description: 'Rows of this check still kept' }) itemCount: number;
}

@ApiSchema({ name: 'ErkhetOverview' })
export class ErkhetOverviewDto {
  @ApiProperty({ description: 'A complete sign-in is saved' }) configured: boolean;
  @ApiProperty() nightly: boolean;
  @ApiProperty({ type: ErkhetRunDto, nullable: true, description: 'Waiting or running now' })
  active: ErkhetRunDto | null;

  @ApiProperty({ type: ErkhetRunDto, nullable: true, description: 'The latest finished check' })
  latest: ErkhetRunDto | null;

  @ApiProperty({ type: ErkhetRunDto, nullable: true, description: 'A later check that failed' })
  failed: ErkhetRunDto | null;
}

export class ErkhetItemsQueryDto extends PageQueryDto {
  @ApiProperty({ enum: ERKHET_SYNC_KINDS })
  @IsIn(ERKHET_SYNC_KINDS)
  kind: ErkhetSyncKind;

  @ApiPropertyOptional({ enum: ERKHET_SYNC_ISSUES })
  @IsOptional()
  @IsIn(ERKHET_SYNC_ISSUES)
  issue?: ErkhetSyncIssue;

  @ApiPropertyOptional({ description: 'A code, a name or a barcode of either side' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'true: only rows not settled yet' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  open?: boolean;
}

@ApiSchema({ name: 'ErkhetCustomerPlan' })
export class ErkhetCustomerPlanDto {
  @ApiProperty() categoryId: number;
  @ApiProperty({ enum: ['DAY_20', 'MONTH_END'] }) settlementGroup: 'DAY_20' | 'MONTH_END';
  @ApiProperty({ enum: ['COMPANY', 'INDIVIDUAL'] }) kind: 'COMPANY' | 'INDIVIDUAL';
  @ApiProperty({ type: String, nullable: true }) phone: string | null;
}

@ApiSchema({ name: 'ErkhetItem' })
export class ErkhetItemDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ERKHET_SYNC_KINDS }) kind: ErkhetSyncKind;
  @ApiProperty({ enum: ERKHET_SYNC_ISSUES }) issue: ErkhetSyncIssue;
  @ApiProperty({ type: String, nullable: true }) erkhetCode: string | null;
  @ApiProperty({ type: String, nullable: true }) erkhetName: string | null;
  @ApiProperty({ type: String, nullable: true }) erkhetGroup: string | null;
  @ApiProperty({ type: String, nullable: true }) erkhetBarcodes: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'MNT' }) erkhetPrice: string | null;
  @ApiProperty({ type: Number, nullable: true, description: 'The customer or product in Bto' })
  btoId: number | null;

  @ApiProperty({ type: String, nullable: true }) btoCode: string | null;
  @ApiProperty({ type: String, nullable: true }) btoName: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'MNT' }) btoPrice: string | null;
  @ApiProperty({ type: ErkhetCustomerPlanDto, nullable: true })
  plan: ErkhetCustomerPlanDto | null;

  @ApiProperty({ enum: ERKHET_RESOLUTIONS, nullable: true }) resolution: ErkhetResolution | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) resolvedAt: string | null;
}

@ApiSchema({ name: 'ErkhetItemPage' })
export class ErkhetItemPageDto {
  @ApiProperty({ type: [ErkhetItemDto] }) data: ErkhetItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'ErkhetApplyRequest' })
export class ErkhetApplyDto {
  @ApiPropertyOptional({
    type: [Number],
    description: `Chosen rows (1–${ERKHET_LIMITS.maxApply}); without them, a kind and an issue`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(ERKHET_LIMITS.maxApply)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  itemIds?: number[];

  @ApiPropertyOptional({ enum: ERKHET_SYNC_KINDS })
  @ValidateIf((body: ErkhetApplyDto) => body.itemIds === undefined)
  @IsIn(ERKHET_SYNC_KINDS)
  kind?: ErkhetSyncKind;

  @ApiPropertyOptional({
    enum: ERKHET_SYNC_ISSUES,
    description: `Every open row of this issue, ${ERKHET_LIMITS.maxApply} at a time`,
  })
  @ValidateIf((body: ErkhetApplyDto) => body.itemIds === undefined)
  @IsIn(ERKHET_SYNC_ISSUES)
  issue?: ErkhetSyncIssue;
}

@ApiSchema({ name: 'ErkhetApplyResult' })
export class ErkhetApplyResultDto {
  @ApiProperty({ description: 'Bto now says what Erkhet says' }) applied: number;
  @ApiProperty({ description: 'Bto changed since the check: left alone' }) stale: number;
  @ApiProperty({ description: 'A rule of Bto refused the change' }) refused: number;
  @ApiProperty({ description: 'Already settled, or nothing to do' }) skipped: number;
}

// ------------------------------------------------------------------------------------------------

export function toRunDto(run: ErkhetRun): ErkhetRunDto {
  return {
    ...run,
    createdAt: run.createdAt.toISOString(),
    finishedAt: run.finishedAt?.toISOString() ?? null,
  };
}

export function toOverviewDto(overview: ErkhetOverview): ErkhetOverviewDto {
  return {
    configured: overview.configured,
    nightly: overview.nightly,
    active: overview.active ? toRunDto(overview.active) : null,
    latest: overview.latest ? toRunDto(overview.latest) : null,
    failed: overview.failed ? toRunDto(overview.failed) : null,
  };
}

export function toItemDto(item: ErkhetItem): ErkhetItemDto {
  return {
    ...item,
    erkhetPrice: item.erkhetPrice?.toFixed(2) ?? null,
    btoPrice: item.btoPrice?.toFixed(2) ?? null,
    resolvedAt: item.resolvedAt?.toISOString() ?? null,
  };
}
