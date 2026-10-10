import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SETTING_KEYS } from '@tugeel/shared/settings';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { WAREHOUSE_KINDS } from '../schema';

const STATUSES = ['ACTIVE', 'INACTIVE'] as const;
const CODE = /^[A-Z0-9][A-Z0-9_-]{0,15}$/;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

@ApiSchema({ name: 'Branch' })
export class BranchDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'e-Barimt branch number (3 digits)' })
  branchNo: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'e-Barimt district code (4 digits)' })
  districtCode: string | null;
  @ApiProperty({ type: String, nullable: true }) address: string | null;
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'BranchList' })
export class BranchListDto {
  @ApiProperty({ type: [BranchDto] }) data: BranchDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the list is short' })
  nextCursor: null;
}

@ApiSchema({ name: 'BranchCreateRequest' })
export class CreateBranchDto {
  @ApiProperty({ example: 'HQ', pattern: CODE.source })
  @Transform(upper)
  @IsString()
  @Matches(CODE)
  code: string;

  @ApiProperty({ example: 'Бөөний төв', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '001' })
  @IsOptional()
  @Matches(/^\d{3}$/)
  branchNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2301' })
  @IsOptional()
  @Matches(/^\d{4}$/)
  districtCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;
}

@ApiSchema({ name: 'BranchUpdateRequest' })
export class UpdateBranchDto {
  @ApiPropertyOptional({ pattern: CODE.source })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(CODE)
  code?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Matches(/^\d{3}$/)
  branchNo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @Matches(/^\d{4}$/)
  districtCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string | null;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

@ApiSchema({ name: 'Warehouse' })
export class WarehouseDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: WAREHOUSE_KINDS, enumName: 'WarehouseKind' })
  kind: (typeof WAREHOUSE_KINDS)[number];
  @ApiProperty({ type: Number, nullable: true, description: 'Null only for TRANSIT' })
  branchId: number | null;
  @ApiProperty({ enum: STATUSES }) status: (typeof STATUSES)[number];
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'WarehouseList' })
export class WarehouseListDto {
  @ApiProperty({ type: [WarehouseDto] }) data: WarehouseDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the list is short' })
  nextCursor: null;
}

export class WarehouseListQueryDto {
  @ApiPropertyOptional({ enum: WAREHOUSE_KINDS, enumName: 'WarehouseKind' })
  @IsOptional()
  @IsIn(WAREHOUSE_KINDS)
  kind?: (typeof WAREHOUSE_KINDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  branchId?: number;
}

@ApiSchema({ name: 'WarehouseCreateRequest' })
export class CreateWarehouseDto {
  @ApiProperty({ example: 'WH-1', pattern: CODE.source })
  @Transform(upper)
  @IsString()
  @Matches(CODE)
  code: string;

  @ApiProperty({ example: 'Төв агуулах', maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    enum: WAREHOUSE_KINDS,
    enumName: 'WarehouseKind',
    description: 'Only WHOLESALE and STORE are accepted here',
  })
  @IsIn(WAREHOUSE_KINDS)
  kind: (typeof WAREHOUSE_KINDS)[number];

  @ApiProperty()
  @IsInt()
  @Min(1)
  branchId: number;
}

@ApiSchema({ name: 'WarehouseUpdateRequest' })
export class UpdateWarehouseDto {
  @ApiPropertyOptional({ pattern: CODE.source })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Matches(CODE)
  code?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  branchId?: number;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

const SETTING_VALUE = { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] };

@ApiSchema({ name: 'SettingEntry' })
export class SettingEntryDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: SETTING_KEYS, enumName: 'SettingKey' }) key: string;
  @ApiProperty(SETTING_VALUE) value: string | number | boolean;
  @ApiProperty({ format: 'date', description: 'Ulaanbaatar business date' }) effectiveFrom: string;
  @ApiProperty({ type: Number, nullable: true }) createdBy: number | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
}

@ApiSchema({ name: 'SettingView' })
export class SettingViewDto {
  @ApiProperty({ enum: SETTING_KEYS, enumName: 'SettingKey' }) key: string;
  @ApiProperty({ ...SETTING_VALUE, nullable: true, description: 'Value in force today, or null' })
  current: string | number | boolean | null;
  @ApiProperty({ type: [SettingEntryDto], description: 'Newest first' }) entries: SettingEntryDto[];
}

@ApiSchema({ name: 'SettingList' })
export class SettingListDto {
  @ApiProperty({ type: [SettingViewDto] }) data: SettingViewDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: one row per key' })
  nextCursor: null;
}

@ApiSchema({ name: 'SettingCreateRequest' })
export class CreateSettingDto {
  @ApiProperty({ enum: SETTING_KEYS, enumName: 'SettingKey' })
  @IsIn(SETTING_KEYS)
  key: string;

  @ApiProperty(SETTING_VALUE)
  @IsDefined()
  value: string | number | boolean;

  @ApiProperty({ format: 'date', example: '2026-11-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  effectiveFrom: string;
}

@ApiSchema({ name: 'AuditEntry' })
export class AuditEntryDto {
  @ApiProperty() id: number;
  @ApiProperty({ format: 'date-time' }) occurredAt: string;
  @ApiProperty({ enum: ['STAFF', 'CUSTOMER', 'SYSTEM'] }) actorKind: string;
  @ApiProperty({ type: Number, nullable: true }) actorId: number | null;
  @ApiProperty({ type: String, nullable: true }) actorUsername: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'Job or CLI for system actors' })
  actorLabel: string | null;
  @ApiProperty() action: string;
  @ApiProperty() entity: string;
  @ApiProperty() entityId: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) before: unknown;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true }) after: unknown;
  @ApiProperty({ type: String, nullable: true }) requestId: string | null;
}

@ApiSchema({ name: 'AuditPage' })
export class AuditPageDto {
  @ApiProperty({ type: [AuditEntryDto] }) data: AuditEntryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class AuditQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ example: 'users' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entity?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  actorId?: number;

  @ApiPropertyOptional({ format: 'date', description: 'From this Ulaanbaatar date (inclusive)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  @ApiPropertyOptional({ format: 'date', description: 'Up to this Ulaanbaatar date (inclusive)' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}
