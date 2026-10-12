import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { BIN_CODE_MAX_LENGTH, BIN_TYPES, type BinType } from '@tugeel/shared/inventory';
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
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { STOCKTAKE_STATUSES } from '../schema';
import { MAX_STOCKTAKE_BINS, MAX_STOCKTAKE_LINES } from '../services/stocktakes.service';
import { UNIT_COST } from './adjustments.dto';
import { QTY, queryBoolean, trimmed } from './bins.dto';

type StocktakeStatus = (typeof STOCKTAKE_STATUSES)[number];

/** A scan in its unit: never 0 (the service refuses it), negative to take a scan back. */
const SIGNED_QTY = /^-?\d{1,11}(\.\d{1,3})?$/;
const APPROVERS = 'approvers (inventory.stocktakes.approve) only';
const COST_APPROVERS = 'approvers holding inventory.costs.manage only';

// Responses. Counters never receive frozen quantities, differences or line totals (ADR-0038):
// those fields are left out of the response, not sent as null.

@ApiSchema({ name: 'StocktakeBin' })
export class StocktakeBinDto {
  @ApiProperty() id: number;
  @ApiProperty({ example: 'A-01-03' }) code: string;
  @ApiProperty({ enum: BIN_TYPES }) type: BinType;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When a counter finished the bin',
  })
  finishedAt: string | null;
  @ApiProperty({ description: 'Lines a person counted' }) countedCount: number;
  @ApiPropertyOptional({ description: `Frozen and found lines; ${APPROVERS}` }) lineCount?: number;
  @ApiPropertyOptional({ description: `Lines counted differently; ${APPROVERS}` })
  differenceCount?: number;
}

@ApiSchema({ name: 'StocktakeSummary' })
export class StocktakeSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'ST-2026-000001' }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: STOCKTAKE_STATUSES }) status: StocktakeStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty() binCount: number;
  @ApiProperty() finishedBinCount: number;
}

@ApiSchema({ name: 'StocktakePage' })
export class StocktakePageDto {
  @ApiProperty({ type: [StocktakeSummaryDto] }) data: StocktakeSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'StocktakeDetail' })
export class StocktakeDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'ST-2026-000001' }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: STOCKTAKE_STATUSES }) status: StocktakeStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) startedAt: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
  @ApiProperty({ type: [StocktakeBinDto], description: 'In code order' }) bins: StocktakeBinDto[];
  @ApiProperty({ description: 'Lines a person counted' }) countedCount: number;
  @ApiPropertyOptional({ description: `Frozen and found lines; ${APPROVERS}` }) lineCount?: number;
  @ApiPropertyOptional({ description: `Lines counted differently; ${APPROVERS}` })
  differenceCount?: number;
  @ApiPropertyOptional({
    example: '139393.94',
    description: `MNT of the shortages at the warehouse average, while counting or in review; ${COST_APPROVERS}`,
  })
  shortageValue?: string;
  @ApiPropertyOptional({
    example: '1393.94',
    description: `MNT of the surpluses (given cost, else the average), while counting or in review; ${COST_APPROVERS}`,
  })
  surplusValue?: string;
}

@ApiSchema({ name: 'StocktakeLine' })
export class StocktakeLineDto {
  @ApiProperty() id: number;
  @ApiProperty() binId: number;
  @ApiProperty({ example: 'A-01-03' }) binCode: string;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() baseUnitId: number;
  @ApiProperty({ example: 'ширхэг' }) baseUnitName: string;
  @ApiProperty({ type: String, nullable: true, example: '48', description: 'Base units' })
  countedQty: string | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'When a person last counted it; NULL with a count of 0: not found (the bin was finished)',
  })
  countedAt: string | null;
  @ApiPropertyOptional({ example: '50', description: `Frozen base units; ${APPROVERS}` })
  expectedQty?: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '-2',
    description: `counted − expected once counted; ${APPROVERS}`,
  })
  difference?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: `Cost per base unit given to a surplus at approval; ${COST_APPROVERS}`,
  })
  unitCost?: string | null;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: `The warehouse average now, what an uncosted surplus takes; ${COST_APPROVERS}`,
  })
  avgCost?: string | null;
}

@ApiSchema({ name: 'StocktakeLinePage' })
export class StocktakeLinePageDto {
  @ApiProperty({ type: [StocktakeLineDto] }) data: StocktakeLineDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'StocktakeScanAdded' })
export class StocktakeScanAddedDto {
  @ApiProperty({ example: '1', description: 'In the scanned unit; negative for a take-back' })
  qty: string;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({ example: '24', description: 'Base units' }) qtyBase: string;
}

@ApiSchema({ name: 'StocktakeScanResult' })
export class StocktakeScanResultDto {
  @ApiProperty({ type: StocktakeLineDto }) line: StocktakeLineDto;
  @ApiProperty({ type: StocktakeScanAddedDto }) added: StocktakeScanAddedDto;
  @ApiProperty({ type: StocktakeBinDto }) bin: StocktakeBinDto;
}

@ApiSchema({ name: 'StocktakeCountResult' })
export class StocktakeCountResultDto {
  @ApiProperty({ type: [StocktakeLineDto] }) lines: StocktakeLineDto[];
}

@ApiSchema({ name: 'StocktakeBinPreview' })
export class StocktakeBinPreviewDto {
  @ApiProperty({ description: `At most ${MAX_STOCKTAKE_BINS + 1}: more is too many` })
  binCount: number;
  @ApiProperty({ description: 'Bins another stocktake is counting: starting would be refused' })
  countingCount: number;
  @ApiProperty({ type: String, nullable: true, example: 'A-01-01' }) firstCode: string | null;
  @ApiProperty({ type: String, nullable: true, example: 'A-01-12' }) lastCode: string | null;
}

// Requests

export class StocktakeListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
  @ApiPropertyOptional({ enum: STOCKTAKE_STATUSES })
  @IsOptional()
  @IsIn(STOCKTAKE_STATUSES)
  status?: StocktakeStatus;
}

export class StocktakeLinesQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) binId?: number;
  @ApiPropertyOptional({ description: `Only lines counted differently; ${APPROVERS}` })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  differences?: boolean;
}

export class StocktakeBinPreviewQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) warehouseId: number;
  @ApiPropertyOptional({ example: 'A-01', description: 'The beginning of a shelf code' })
  @IsOptional()
  @IsString()
  @MaxLength(BIN_CODE_MAX_LENGTH)
  prefix?: string;
  @ApiPropertyOptional({ description: 'Every shelf and the sales floor' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  all?: boolean;
}

@ApiSchema({ name: 'StocktakeCreateRequest' })
export class CreateStocktakeDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiPropertyOptional({
    type: [Number],
    maxItems: MAX_STOCKTAKE_BINS,
    description: 'Exactly one of binIds, prefix and all: these bins, any type',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STOCKTAKE_BINS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  binIds?: number[];
  @ApiPropertyOptional({
    example: 'A-01',
    description: 'The storage and picking shelves whose code starts with this',
  })
  @IsOptional()
  @IsString()
  @MaxLength(BIN_CODE_MAX_LENGTH)
  prefix?: string;
  @ApiPropertyOptional({ description: 'Every storage and picking shelf and the sales floor' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiSchema({ name: 'StocktakeScanRequest' })
export class StocktakeScanDto {
  @ApiProperty() @IsInt() @Min(1) binId: number;
  @ApiProperty({ description: 'The scanned unit (a box barcode adds its factor)' })
  @IsInt()
  @Min(1)
  productUnitId: number;
  @ApiProperty({ example: '1', description: 'In the unit, never 0; negative takes a scan back' })
  @Matches(SIGNED_QTY)
  qty: string;
}

@ApiSchema({ name: 'StocktakeCountEntry' })
export class StocktakeCountEntryDto {
  @ApiProperty() @IsInt() @Min(1) binId: number;
  @ApiProperty() @IsInt() @Min(1) productId: number;
  @ApiProperty({ example: '48', description: 'Base units; 0 = none here' })
  @Matches(QTY)
  countedQty: string;
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '24',
    description:
      'The count the screen showed (null: none yet); a different stored count answers 409 CONFLICT',
  })
  @IsOptional()
  @Matches(QTY)
  previousQty?: string | null;
}

@ApiSchema({ name: 'StocktakeCountsRequest' })
export class StocktakeCountsDto {
  @ApiProperty({ type: [StocktakeCountEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StocktakeCountEntryDto)
  entries: StocktakeCountEntryDto[];
}

@ApiSchema({ name: 'StocktakeRecountRequest' })
export class StocktakeRecountDto {
  @ApiProperty({ type: [Number], description: 'Bins whose counts are cleared and counted again' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_STOCKTAKE_BINS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  binIds: number[];
}

@ApiSchema({ name: 'StocktakeCostRequest' })
export class StocktakeCostDto {
  @ApiProperty() @IsInt() @Min(1) lineId: number;
  @ApiProperty({ example: '1250.5', description: 'Cost per base unit' })
  @Matches(UNIT_COST)
  unitCost: string;
}

@ApiSchema({ name: 'StocktakeApproveRequest' })
export class ApproveStocktakeDto {
  @ApiPropertyOptional({
    type: [StocktakeCostDto],
    description: 'Surplus lines, cost holders only; lines without a cost take the average',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_STOCKTAKE_LINES)
  @ValidateNested({ each: true })
  @Type(() => StocktakeCostDto)
  costs?: StocktakeCostDto[];
}
