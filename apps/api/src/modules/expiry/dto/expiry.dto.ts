import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EXPIRY_CARRY_OUTCOMES,
  EXPIRY_CHANGE_KINDS,
  EXPIRY_LIABILITY_NOTE_MAX,
  EXPIRY_LIABILITY_TYPES,
  EXPIRY_NAME_MAX,
  EXPIRY_NOTE_MAX,
  EXPIRY_QTY_PATTERN,
  EXPIRY_STATUSES,
  EXPIRY_URGENCIES,
  EXPIRY_VIEWS,
  type ExpiryCarryOutcome,
  type ExpiryChangeKind,
  type ExpiryLiabilityType,
  type ExpiryStatus,
  type ExpiryUrgency,
  type ExpiryView,
} from '@tugeel/shared/expiry';
import { isIsoDate } from '@tugeel/shared/time';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  registerDecorator,
  ValidateNested,
  type ValidationOptions,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';

/** People and old changes one record may name. */
const MAX_LIABLE = 500;
const MAX_CARRIED_CHANGES = 5_000;

/** An instant with its zone: the old system's naive UTC text would be read as the server's clock. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

/** A real calendar date written as `YYYY-MM-DD`. */
function IsCalendarDate(options?: ValidationOptions) {
  return (target: object, propertyName: string) => {
    registerDecorator({
      name: 'isCalendarDate',
      target: target.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isIsoDate(value),
        defaultMessage: () => `${propertyName} must be a date like 2026-11-07`,
      },
    });
  };
}

// ── answers ──────────────────────────────────────────────────────────────────

export class ExpiryProductDto {
  @ApiProperty() id: number;
  @ApiProperty({ description: 'The product code' }) sku: string;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'The unit both counted quantities are in' }) baseUomName: string;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
}

export class ExpiryNamedDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
}

/** A system role carries its code (labelled in mn.json `roles.system`), a custom one its name. */
export class ExpiryRoleDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) code: string | null;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
}

export class ExpiryPersonDto {
  @ApiProperty() id: number;
  @ApiProperty() fullName: string;
}

export class ExpiryLiabilityDto {
  @ApiProperty({ enum: EXPIRY_LIABILITY_TYPES, enumName: 'ExpiryLiabilityType' })
  type: ExpiryLiabilityType;
  @ApiProperty({ type: [ExpiryRoleDto] }) roles: ExpiryRoleDto[];
  @ApiProperty({ type: [ExpiryPersonDto] }) users: ExpiryPersonDto[];
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

export class ExpiryItemDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: ExpiryProductDto }) product: ExpiryProductDto;
  @ApiProperty({
    type: ExpiryNamedDto,
    nullable: true,
    description: 'The main supplier, read live (the old «Брэнд»)',
  })
  supplier: ExpiryNamedDto | null;
  @ApiProperty({
    type: ExpiryNamedDto,
    nullable: true,
    description: 'The home warehouse, read live (the old «Байршил»)',
  })
  homeWarehouse: ExpiryNamedDto | null;
  @ApiProperty({ example: '2026-11-07' }) expiryDate: string;
  @ApiProperty({ description: 'Days from the server’s business date; negative when past' })
  daysLeft: number;
  @ApiProperty({ enum: EXPIRY_URGENCIES, enumName: 'ExpiryUrgency' }) urgency: ExpiryUrgency;
  @ApiProperty({ example: '12' }) qtyFloor: string;
  @ApiProperty({ example: '0' }) qtyWarehouse: string;
  @ApiProperty({ example: '12' }) qtyTotal: string;
  @ApiProperty({ enum: EXPIRY_STATUSES, enumName: 'ExpiryStatus' }) status: ExpiryStatus;
  @ApiProperty({ type: ExpiryLiabilityDto }) liability: ExpiryLiabilityDto;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ description: 'What a correction sends back as expectedVersion' })
  editVersion: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty() createdByName: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
  @ApiProperty({ type: String, nullable: true }) archivedByName: string | null;
}

export class ExpiryItemPageDto {
  @ApiProperty({ type: [ExpiryItemDto] }) data: ExpiryItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class ExpiryStatusCountsDto {
  @ApiProperty() REVIEW: number;
  @ApiProperty() CITY_RETURN: number;
  @ApiProperty() INTERNAL_SALE: number;
}

export class ExpirySummaryDto {
  @ApiProperty({ example: '2026-11-07', description: 'The server’s business date' }) today: string;
  @ApiProperty({ example: 30 }) soonDays: number;
  @ApiProperty({ example: 7 }) urgentDays: number;
  @ApiProperty({ description: 'Records not archived' }) active: number;
  @ApiProperty({ description: 'Open records past their date' }) expired: number;
  @ApiProperty({ description: 'Open records dated today … today + urgentDays' }) urgent: number;
  @ApiProperty({ description: 'Open records dated today … today + soonDays' }) soon: number;
  @ApiProperty() archived: number;
  @ApiProperty({ type: ExpiryStatusCountsDto }) byStatus: ExpiryStatusCountsDto;
}

export class ExpiryFiltersDto {
  @ApiProperty({ type: [ExpiryNamedDto] }) suppliers: ExpiryNamedDto[];
  @ApiProperty({ type: [ExpiryNamedDto] }) warehouses: ExpiryNamedDto[];
  @ApiProperty({ type: [String] }) creators: string[];
}

/** The two home tiles (ADR-0172 #10): zeros without `expiry.items.manage`; counts stop at `cap`. */
export class ExpiryAttentionDto {
  @ApiProperty({ description: 'Open records past their date' }) expired: number;
  @ApiProperty({ description: 'Open records dated today … today + 7' }) dueSoon: number;
  @ApiProperty({ example: 100, description: 'Counts stop here; show «99+» at the cap' })
  cap: number;
}

export class ExpiryChangeDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: EXPIRY_CHANGE_KINDS, enumName: 'ExpiryChangeKind' }) kind: ExpiryChangeKind;
  @ApiProperty() qtyFloorOld: string;
  @ApiProperty() qtyFloorNew: string;
  @ApiProperty() qtyWarehouseOld: string;
  @ApiProperty() qtyWarehouseNew: string;
  @ApiProperty({ type: String, format: 'date-time' }) changedAt: string;
  @ApiProperty() changedByName: string;
}

export class ExpiryHistoryDto {
  @ApiProperty({ type: [ExpiryChangeDto] }) data: ExpiryChangeDto[];
}

export class ExpiryLiabilityOptionsDto {
  @ApiProperty({ type: [ExpiryRoleDto] }) roles: ExpiryRoleDto[];
  @ApiProperty({ type: [ExpiryPersonDto], description: 'Active staff' })
  users: ExpiryPersonDto[];
}

export class ExpiryCarryResultDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: EXPIRY_CARRY_OUTCOMES, enumName: 'ExpiryCarryOutcome' })
  outcome: ExpiryCarryOutcome;
}

// ── queries ──────────────────────────────────────────────────────────────────

export class ExpiryFiltersQueryDto {
  @ApiPropertyOptional({ enum: EXPIRY_VIEWS, enumName: 'ExpiryView', default: 'ACTIVE' })
  @IsOptional()
  @IsIn(EXPIRY_VIEWS)
  view?: ExpiryView;
}

export class ExpiryListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: EXPIRY_VIEWS, enumName: 'ExpiryView', default: 'ACTIVE' })
  @IsOptional()
  @IsIn(EXPIRY_VIEWS)
  view?: ExpiryView;

  @ApiPropertyOptional({ description: 'Product name, code or barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ description: 'The product’s main supplier' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  supplierId?: number;

  @ApiPropertyOptional({ description: 'The product’s home warehouse' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  warehouseId?: number;

  @ApiPropertyOptional({ description: 'Exactly as `creators` of the filters route names them' })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_NAME_MAX)
  createdByName?: string;

  @ApiPropertyOptional({ enum: EXPIRY_LIABILITY_TYPES, enumName: 'ExpiryLiabilityType' })
  @IsOptional()
  @IsIn(EXPIRY_LIABILITY_TYPES)
  liability?: ExpiryLiabilityType;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  productId?: number;
}

// ── bodies ───────────────────────────────────────────────────────────────────

export class ExpiryCreateRequestDto {
  @ApiProperty() @IsInt() @IsPositive() productId: number;

  @ApiProperty({ example: '2026-11-07', description: 'At most 5 years back, 15 years ahead' })
  @IsCalendarDate()
  expiryDate: string;

  @ApiProperty({ example: '12', description: 'Base units on the sales floor' })
  @IsString()
  @Matches(EXPIRY_QTY_PATTERN)
  qtyFloor: string;

  @ApiProperty({ example: '0', description: 'Base units in the warehouse' })
  @IsString()
  @Matches(EXPIRY_QTY_PATTERN)
  qtyWarehouse: string;

  @ApiPropertyOptional({ maxLength: EXPIRY_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_NOTE_MAX)
  note?: string;

  @ApiPropertyOptional({
    description: 'Add it although an open record has this product and date (ADR-0172 #5)',
  })
  @IsOptional()
  @IsBoolean()
  allowDuplicate?: boolean;
}

export class ExpiryPatchRequestDto {
  @ApiProperty({ description: 'The editVersion the screen read' })
  @IsInt()
  @Min(1)
  expectedVersion: number;

  @ApiPropertyOptional({ example: '2026-11-07' })
  @IsOptional()
  @IsCalendarDate()
  expiryDate?: string;

  @ApiPropertyOptional({ example: '12' })
  @IsOptional()
  @IsString()
  @Matches(EXPIRY_QTY_PATTERN)
  qtyFloor?: string;

  @ApiPropertyOptional({ example: '0' })
  @IsOptional()
  @IsString()
  @Matches(EXPIRY_QTY_PATTERN)
  qtyWarehouse?: string;

  @ApiPropertyOptional({ maxLength: EXPIRY_NOTE_MAX, description: 'Empty clears it' })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_NOTE_MAX)
  note?: string;
}

export class ExpiryStatusRequestDto {
  @ApiProperty({ enum: EXPIRY_STATUSES, enumName: 'ExpiryStatus' })
  @IsIn(EXPIRY_STATUSES)
  status: ExpiryStatus;
}

export class ExpiryLiabilityRequestDto {
  @ApiProperty({ enum: EXPIRY_LIABILITY_TYPES, enumName: 'ExpiryLiabilityType' })
  @IsIn(EXPIRY_LIABILITY_TYPES)
  type: ExpiryLiabilityType;

  @ApiProperty({ type: [Number], description: 'Kept only with SPECIFIC' })
  @IsArray()
  @ArrayMaxSize(MAX_LIABLE)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  roleIds: number[];

  @ApiProperty({ type: [Number], description: 'Kept only with SPECIFIC' })
  @IsArray()
  @ArrayMaxSize(MAX_LIABLE)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  userIds: number[];

  @ApiPropertyOptional({ maxLength: EXPIRY_LIABILITY_NOTE_MAX, description: 'NONE clears it' })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_LIABILITY_NOTE_MAX)
  note?: string;
}

export class ExpiryCarryChangeDto {
  @ApiProperty() @IsInt() @IsPositive() legacyId: number;

  @ApiProperty({ enum: EXPIRY_CHANGE_KINDS, enumName: 'ExpiryChangeKind' })
  @IsIn(EXPIRY_CHANGE_KINDS)
  kind: ExpiryChangeKind;

  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyFloorOld: string;
  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyFloorNew: string;
  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyWarehouseOld: string;
  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyWarehouseNew: string;

  @ApiProperty({ example: '2026-03-05T04:10:00Z', description: 'With its zone' })
  @IsString()
  @Matches(INSTANT)
  changedAt: string;

  @ApiProperty({ maxLength: EXPIRY_NAME_MAX })
  @IsString()
  @MinLength(1)
  @MaxLength(EXPIRY_NAME_MAX)
  changedByName: string;
}

/** One old record (ADR-0172 #12): no date range, duplicate or positive-quantity check. */
export class ExpiryCarryRequestDto {
  @ApiProperty({ description: 'The old record’s id' }) @IsInt() @IsPositive() legacyId: number;
  @ApiProperty() @IsInt() @IsPositive() productId: number;

  @ApiProperty({ example: '2026-11-07' })
  @IsCalendarDate()
  expiryDate: string;

  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyFloor: string;
  @ApiProperty() @IsString() @Matches(EXPIRY_QTY_PATTERN) qtyWarehouse: string;

  @ApiProperty({ enum: EXPIRY_STATUSES, enumName: 'ExpiryStatus' })
  @IsIn(EXPIRY_STATUSES)
  status: ExpiryStatus;

  @ApiProperty({ enum: EXPIRY_LIABILITY_TYPES, enumName: 'ExpiryLiabilityType' })
  @IsIn(EXPIRY_LIABILITY_TYPES)
  liabilityType: ExpiryLiabilityType;

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(MAX_LIABLE)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  liabilityRoleIds: number[];

  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMaxSize(MAX_LIABLE)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  liabilityUserIds: number[];

  @ApiPropertyOptional({ maxLength: EXPIRY_LIABILITY_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_LIABILITY_NOTE_MAX)
  liabilityNote?: string;

  @ApiPropertyOptional({ maxLength: EXPIRY_NOTE_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_NOTE_MAX)
  note?: string;

  @ApiProperty({ example: '2026-03-05T04:10:00Z', description: 'With its zone' })
  @IsString()
  @Matches(INSTANT)
  createdAt: string;

  @ApiProperty({ maxLength: EXPIRY_NAME_MAX, description: 'The old author, kept as text' })
  @IsString()
  @MinLength(1)
  @MaxLength(EXPIRY_NAME_MAX)
  createdByName: string;

  @ApiPropertyOptional({ example: '2026-03-05T04:10:00Z', description: 'With its zone' })
  @IsOptional()
  @IsString()
  @Matches(INSTANT)
  archivedAt?: string;

  @ApiPropertyOptional({ maxLength: EXPIRY_NAME_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(EXPIRY_NAME_MAX)
  archivedByName?: string;

  @ApiProperty({ type: [ExpiryCarryChangeDto] })
  @IsArray()
  @ArrayMaxSize(MAX_CARRIED_CHANGES)
  @ValidateNested({ each: true })
  @Type(() => ExpiryCarryChangeDto)
  history: ExpiryCarryChangeDto[];
}
