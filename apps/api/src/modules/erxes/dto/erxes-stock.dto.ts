import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import {
  ERXES_STOCK_FAILURES,
  ERXES_STOCK_MATCH_REASONS,
  ERXES_STOCK_RUN_STATUSES,
  type ErxesStockFailure,
  type ErxesStockMatchReason,
  type ErxesStockRunStatus,
} from '../schema';
import { STOCK_GROUPS, type StockGroup } from '../services/erxes-stock.service';

const DATE = { type: String, format: 'date-time' } as const;
const NULL_DATE = { ...DATE, nullable: true } as const;
const NULL_TEXT = { type: String, nullable: true } as const;
const NULL_ID = { type: Number, nullable: true } as const;
const QTY = { type: String, nullable: true, example: '12.5' } as const;

const bool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true ? true : value === 'false' || value === false ? false : value;

@ApiSchema({ name: 'ErxesStockRun' })
export class ErxesStockRunDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: ERXES_STOCK_RUN_STATUSES }) status: ErxesStockRunStatus;
  @ApiProperty(DATE) createdAt: Date;
  @ApiProperty(NULL_DATE) startedAt: Date | null;
  @ApiProperty(NULL_DATE) finishedAt: Date | null;
  @ApiProperty(NULL_TEXT) startedBy: string | null;
  @ApiProperty({ description: "erxes's active products read" }) products: number;
  @ApiProperty({ description: 'Calls of erkhetRemainders planned' }) batchesTotal: number;
  @ApiProperty({ description: 'Calls answered or refused' }) batchesDone: number;
  @ApiProperty({ description: 'Calls refused' }) batchesFailed: number;
  @ApiProperty({ description: 'Products whose Erkhet quantity is unknown' })
  productsUnread: number;

  @ApiProperty({ ...NULL_DATE, description: 'While it runs: when it should end' })
  estimatedFinishAt: Date | null;

  @ApiProperty({ enum: ERXES_STOCK_FAILURES, nullable: true }) failure: ErxesStockFailure | null;
  @ApiProperty(NULL_TEXT) failureDetail: string | null;
}

@ApiSchema({ name: 'ErxesStockOverview' })
export class ErxesStockOverviewDto {
  @ApiProperty({ description: "erxes's sign-in is saved" }) configured: boolean;
  @ApiProperty({ type: ErxesStockRunDto, nullable: true }) active: ErxesStockRunDto | null;
  @ApiProperty({ type: ErxesStockRunDto, nullable: true, description: 'The run compared' })
  latest: ErxesStockRunDto | null;

  @ApiProperty({ type: ErxesStockRunDto, nullable: true }) failed: ErxesStockRunDto | null;
}

@ApiSchema({ name: 'ErxesStockLocation' })
export class ErxesStockLocationDto {
  @ApiProperty({ example: '01' }) code: string;
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty(NULL_ID) warehouseId: number | null;
  @ApiProperty(NULL_TEXT) warehouseName: string | null;
  @ApiProperty({ description: 'The newest finished run read this location' }) read: boolean;
}

@ApiSchema({ name: 'ErxesStockLocationUpdateRequest' })
export class UpdateErxesStockLocationDto {
  @ApiProperty({ ...NULL_ID, description: 'The Bto warehouse; null unlinks' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId: number | null;
}

export class ErxesStockCompareQueryDto extends PageQueryDto {
  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  warehouseId: number;

  @ApiPropertyOptional({ enum: STOCK_GROUPS, default: 'MATCHED' })
  @IsOptional()
  @IsIn(STOCK_GROUPS)
  group?: StockGroup;

  @ApiPropertyOptional({ description: 'Only rows whose quantities differ (or are unknown)' })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  onlyDifferent?: boolean;

  @ApiPropertyOptional({ description: 'A part of a code or a name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

@ApiSchema({ name: 'ErxesStockRow' })
export class ErxesStockRowDto {
  @ApiProperty() key: string;
  @ApiProperty(NULL_ID) productId: number | null;
  @ApiProperty(NULL_TEXT) erxesId: string | null;
  @ApiProperty({ ...NULL_TEXT, description: "Bto's code, else erxes's" }) code: string | null;
  @ApiProperty(NULL_TEXT) name: string | null;
  @ApiProperty({ type: [String] }) erxesCodes: string[];
  @ApiProperty({ ...NULL_TEXT, description: "erxes's unit: Erkhet's quantity is in it" })
  erxesUom: string | null;

  @ApiProperty({ ...NULL_TEXT, description: "Bto's base unit" }) btoUnit: string | null;
  @ApiProperty({ ...QTY, description: "Erkhet's quantity; null when unknown" })
  erkhet: string | null;

  @ApiProperty({ ...QTY, description: "Bto's on-hand in its base unit" }) bto: string | null;
  @ApiProperty({ ...QTY, description: 'Erkhet − Bto' }) difference: string | null;
  @ApiProperty({ description: "erxes's unit is not Bto's base unit" }) unitDiffers: boolean;
  @ApiProperty({ enum: ERXES_STOCK_MATCH_REASONS, nullable: true })
  reason: ErxesStockMatchReason | null;
}

@ApiSchema({ name: 'ErxesStockCounts' })
export class ErxesStockCountsDto {
  @ApiProperty() matched: number;
  @ApiProperty() different: number;
  @ApiProperty() notInBto: number;
  @ApiProperty() notInErkhet: number;
}

@ApiSchema({ name: 'ErxesStockLinkedLocation' })
export class ErxesStockLinkedLocationDto {
  @ApiProperty() code: string;
  @ApiProperty(NULL_TEXT) name: string | null;
}

@ApiSchema({ name: 'ErxesStockComparison' })
export class ErxesStockComparisonDto {
  @ApiProperty(NULL_ID) runId: number | null;
  @ApiProperty({ ...NULL_DATE, description: "When Erkhet's side was read" }) readAt: Date | null;
  @ApiProperty({ type: [ErxesStockLinkedLocationDto] }) locations: ErxesStockLinkedLocationDto[];
  @ApiProperty({ type: ErxesStockCountsDto }) counts: ErxesStockCountsDto;
  @ApiProperty({ type: [ErxesStockRowDto] }) data: ErxesStockRowDto[];
  @ApiProperty(NULL_TEXT) nextCursor: string | null;
}
