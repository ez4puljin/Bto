import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  GENDERS,
  type Gender,
  LOYALTY_ENTRY_KINDS,
  LOYALTY_ISSUES,
  LOYALTY_LIMITS,
  LOYALTY_MEMBER_STATUSES,
  type LoyaltyEntryKind,
  type LoyaltyIssue,
  type LoyaltyMemberStatus,
  MEMBER_PIN_PATTERN,
  SALE_KINDS,
  type SaleKind,
} from '@tugeel/shared/pos';
import { REG_NO_MAX_LENGTH } from '@tugeel/shared/taxpayer';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const WHOLE = /^[0-9]{1,12}$/;
const SIGNED_WHOLE = /^-?[0-9]{1,8}$/;
const PERCENT = /^[0-9]{1,3}(\.[0-9]{1,2})?$/;

// ---------------------------------------------------------------- members (ADR-0112)

/** A member's details as the office types them; the PIN goes on registration and on «ПИН солих». */
export class LoyaltyMemberFieldsDto {
  @ApiProperty({ example: 'Батбаяр Дорж', maxLength: LOYALTY_LIMITS.maxName })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(LOYALTY_LIMITS.maxName)
  name: string;
  @ApiProperty({ example: '99112233' })
  @Transform(trimmed)
  @IsString()
  @MaxLength(20)
  phone: string;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: REG_NO_MAX_LENGTH })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(REG_NO_MAX_LENGTH)
  regNo?: string | null;
  @ApiPropertyOptional({ type: String, nullable: true, example: '1990-05-01' })
  @IsOptional()
  @IsString()
  @Matches(DAY)
  birthDate?: string | null;
  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender | null;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: LOYALTY_LIMITS.maxNote })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(LOYALTY_LIMITS.maxNote)
  note?: string | null;
}

@ApiSchema({ name: 'PosLoyaltyMemberRequest' })
export class LoyaltyMemberRequestDto extends LoyaltyMemberFieldsDto {
  @ApiProperty({ example: '1234', description: 'Four digits' })
  @IsString()
  @Matches(MEMBER_PIN_PATTERN)
  pin: string;
}

@ApiSchema({ name: 'PosLoyaltyMemberUpdate' })
export class LoyaltyMemberUpdateDto extends LoyaltyMemberFieldsDto {}

@ApiSchema({ name: 'PosLoyaltyMemberPin' })
export class LoyaltyMemberPinDto {
  @ApiProperty({ example: '1234' }) @IsString() @Matches(MEMBER_PIN_PATTERN) pin: string;
}

@ApiSchema({ name: 'PosLoyaltyAdjustment' })
export class LoyaltyAdjustDto {
  @ApiProperty({ example: '5000', description: 'Whole points; negative removes' })
  @IsString()
  @Matches(SIGNED_WHOLE)
  points: string;
  @ApiProperty({ example: 'Төрсөн өдрийн бэлэг', maxLength: LOYALTY_LIMITS.maxReason })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(LOYALTY_LIMITS.maxReason)
  reason: string;
}

export class LoyaltyMemberListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: LOYALTY_MEMBER_STATUSES })
  @IsOptional()
  @IsIn(LOYALTY_MEMBER_STATUSES)
  status?: LoyaltyMemberStatus;
  @ApiPropertyOptional({ description: 'A name, or digits of the phone' })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(80)
  q?: string;
}

@ApiSchema({ name: 'PosLoyaltyTierOfMember' })
export class LoyaltyMemberTierDto {
  @ApiProperty() name: string;
  @ApiProperty({ example: '1.00' }) percent: string;
}

@ApiSchema({ name: 'PosLoyaltyNextTier' })
export class LoyaltyNextTierDto {
  @ApiProperty() name: string;
  @ApiProperty({ example: '2.00' }) percent: string;
  @ApiProperty({ example: '20000000.00' }) fromAmount: string;
  @ApiProperty({ example: '1250000.00', description: 'Spend left to reach it' }) left: string;
}

@ApiSchema({ name: 'PosLoyaltyMember' })
export class LoyaltyMemberDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty({ example: '+97699112233' }) phone: string;
  @ApiProperty({ type: String, nullable: true }) regNo: string | null;
  @ApiProperty({ type: String, nullable: true }) birthDate: string | null;
  @ApiProperty({ enum: GENDERS, nullable: true }) gender: Gender | null;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ enum: LOYALTY_MEMBER_STATUSES }) status: LoyaltyMemberStatus;
  @ApiProperty({ example: '12345.00' }) balance: string;
  @ApiProperty({ example: '8750000.00' }) lifetimeSpend: string;
  @ApiProperty({ type: LoyaltyMemberTierDto, nullable: true }) tier: LoyaltyMemberTierDto | null;
  @ApiProperty({ type: LoyaltyNextTierDto, nullable: true }) nextTier: LoyaltyNextTierDto | null;
  @ApiProperty({ type: String, format: 'date-time' }) pinSetAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

export class LoyaltyMemberPageDto {
  @ApiProperty({ type: [LoyaltyMemberDto] }) data: LoyaltyMemberDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'PosLoyaltyEntry' })
export class LoyaltyEntryDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: LOYALTY_ENTRY_KINDS }) kind: LoyaltyEntryKind;
  @ApiProperty({ example: '400.00' }) points: string;
  @ApiProperty({ example: '40000.00' }) spendDelta: string;
  @ApiProperty({ type: Number, nullable: true }) saleId: number | null;
  @ApiProperty({ type: String, nullable: true }) saleNumber: string | null;
  @ApiProperty({ type: String, nullable: true }) percent: string | null;
  @ApiProperty({ type: String, nullable: true }) reason: string | null;
  @ApiProperty({ type: String, nullable: true }) journalNumber: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, nullable: true }) createdByName: string | null;
}

export class LoyaltyEntryPageDto {
  @ApiProperty({ type: [LoyaltyEntryDto] }) data: LoyaltyEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

// ---------------------------------------------------------------- tiers

@ApiSchema({ name: 'PosLoyaltyTier' })
export class LoyaltyTierDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'Мөнгөн' }) name: string;
  @ApiProperty({ example: '10000000.00' }) fromAmount: string;
  @ApiProperty({ example: '1.50' }) percent: string;
}

export class LoyaltyTierInputDto {
  @ApiProperty({ type: Number, nullable: true, description: 'Null adds a tier' })
  @IsOptional()
  @IsInt()
  @Min(1)
  id: number | null;
  @ApiProperty({ example: 'Мөнгөн', maxLength: LOYALTY_LIMITS.maxTierName })
  @Transform(trimmed)
  @IsString()
  @MinLength(1)
  @MaxLength(LOYALTY_LIMITS.maxTierName)
  name: string;
  @ApiProperty({ example: '10000000', description: 'Lifetime spend from, whole MNT' })
  @IsString()
  @Matches(WHOLE)
  fromAmount: string;
  @ApiProperty({ example: '1.5' }) @IsString() @Matches(PERCENT) percent: string;
}

@ApiSchema({ name: 'PosLoyaltyTiersRequest' })
export class LoyaltyTiersRequestDto {
  @ApiProperty({ type: [LoyaltyTierInputDto] })
  @IsArray()
  @ArrayMaxSize(LOYALTY_LIMITS.maxTiers)
  @ValidateNested({ each: true })
  @Type(() => LoyaltyTierInputDto)
  tiers: LoyaltyTierInputDto[];
}

// ---------------------------------------------------------------- member sales

@ApiSchema({ name: 'PosSaleLoyalty' })
export class SaleLoyaltyDto {
  @ApiProperty() id: number;
  @ApiProperty() saleId: number;
  @ApiProperty() saleNumber: string;
  @ApiProperty({ type: String, format: 'date-time' }) soldAt: string;
  @ApiProperty({ enum: SALE_KINDS }) kind: SaleKind;
  @ApiProperty() memberId: number;
  @ApiProperty() memberName: string;
  @ApiProperty() earned: string;
  @ApiProperty() spent: string;
  @ApiProperty() givenBack: string;
  @ApiProperty() clawback: string;
  @ApiProperty() balanceAfter: string;
  @ApiProperty({ enum: LOYALTY_ISSUES, nullable: true }) issue: LoyaltyIssue | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reviewedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) reviewNote: string | null;
}

@ApiSchema({ name: 'PosSaleLoyaltyReview' })
export class SaleLoyaltyReviewDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(300)
  note?: string | null;
}
