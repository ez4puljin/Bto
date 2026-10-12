import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  BIN_TYPES,
  type BinType,
  USER_BIN_TYPES,
  type UserBinType,
} from '@tugeel/shared/inventory';
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
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_PAGE_LIMIT, PageQueryDto, queryIds } from '../../../common/pagination/page';
import { BIN_STATUSES } from '../schema';

export const QTY = /^\d{1,11}(\.\d{1,3})?$/;

export const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
export const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

@ApiSchema({ name: 'Bin' })
export class BinDto {
  @ApiProperty() id: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ example: 'A-01-03', description: 'The text of the shelf label' }) code: string;
  @ApiProperty({ type: String, nullable: true }) name: string | null;
  @ApiProperty({ enum: BIN_TYPES }) type: BinType;
  @ApiProperty({ description: 'Stock here can be sold (storage, picking, sales floor)' })
  sellable: boolean;
  @ApiProperty({ enum: BIN_STATUSES }) status: (typeof BIN_STATUSES)[number];
  @ApiProperty() isSystem: boolean;
  @ApiProperty({ type: Number, nullable: true }) pickSequence: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt: string | null;
}

@ApiSchema({ name: 'BinPage' })
export class BinPageDto {
  @ApiProperty({ type: [BinDto] }) data: BinDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class BinListQueryDto extends PageQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) warehouseId: number;

  @ApiPropertyOptional({ description: 'Start of a bin code' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  q?: string;

  @ApiPropertyOptional({ enum: BIN_TYPES }) @IsOptional() @IsIn(BIN_TYPES) type?: BinType;

  @ApiPropertyOptional({ description: 'Include archived bins' })
  @IsOptional()
  @Transform(queryBoolean)
  @IsBoolean()
  archived?: boolean;
}

export class BinLookupQueryDto {
  @ApiProperty() @Type(() => Number) @IsInt() @Min(1) warehouseId: number;
  @ApiProperty({ description: 'Scanned or typed label text' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code: string;
}

@ApiSchema({ name: 'BinCreateRequest' })
export class CreateBinDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;

  @ApiProperty({ example: 'A-01-03' })
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  code: string;

  @ApiProperty({ enum: USER_BIN_TYPES }) @IsIn(USER_BIN_TYPES) type: UserBinType;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  name?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  pickSequence?: number | null;
}

@ApiSchema({ name: 'BinUpdateRequest' })
export class UpdateBinDto {
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(100)
  name?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  pickSequence?: number | null;
}

/** A block of shelves: rows × racks × levels, coded like the labels ("A-01-03"). */
@ApiSchema({ name: 'BinRangeRequest' })
export class BinRangeRequestDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiProperty({ enum: USER_BIN_TYPES }) @IsIn(USER_BIN_TYPES) type: UserBinType;

  @ApiProperty({ example: 'A' })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]$/)
  rowFrom: string;

  @ApiProperty({ example: 'C' })
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z]$/)
  rowTo: string;

  @ApiProperty() @IsInt() @Min(0) @Max(999) rackFrom: number;
  @ApiProperty() @IsInt() @Min(0) @Max(999) rackTo: number;
  @ApiProperty() @IsInt() @Min(0) @Max(999) levelFrom: number;
  @ApiProperty() @IsInt() @Min(0) @Max(999) levelTo: number;

  @ApiPropertyOptional({ description: 'Only list the codes; create nothing' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

@ApiSchema({ name: 'BinRangeResult' })
export class BinRangeResultDto {
  @ApiProperty({ type: [String] }) codes: string[];
  @ApiProperty({ type: [String], description: 'Codes the warehouse already had' })
  existing: string[];
  @ApiProperty() created: number;
}

@ApiSchema({ name: 'ProductLocation' })
export class ProductLocationDto {
  @ApiProperty() id: number;
  @ApiProperty() warehouseId: number;
  @ApiProperty() productId: number;
  @ApiProperty({ description: 'The product’s home warehouse' }) isHome: boolean;
  @ApiProperty({ type: Number, nullable: true }) defaultBinId: number | null;
  @ApiProperty({ type: String, nullable: true }) defaultBinCode: string | null;
  @ApiProperty({ type: String, nullable: true, example: '24' }) minQty: string | null;
  @ApiProperty({ type: String, nullable: true, example: '240' }) maxQty: string | null;
}

@ApiSchema({ name: 'ProductLocationList' })
export class ProductLocationListDto {
  @ApiProperty({ type: [ProductLocationDto] }) data: ProductLocationDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

/** By product, by warehouse (paged) or by several products (the product list, ADR-0037). */
export class ProductLocationsQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) productId?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;

  @ApiPropertyOptional({
    type: [Number],
    maxItems: MAX_PAGE_LIMIT,
    description: 'Repeated: productIds=1&productIds=2; not with productId or warehouseId',
  })
  @IsOptional()
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PAGE_LIMIT)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];
}

@ApiSchema({ name: 'ProductLocationRequest' })
export class SetProductLocationDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiProperty() @IsInt() @Min(1) productId: number;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Fixed shelf; null clears it' })
  @IsOptional()
  @IsInt()
  @Min(1)
  defaultBinId?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Base units' })
  @IsOptional()
  @Matches(QTY)
  minQty?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Base units' })
  @IsOptional()
  @Matches(QTY)
  maxQty?: string | null;
}

@ApiSchema({ name: 'ProductHomeRequest' })
export class SetProductHomeDto {
  @ApiProperty() @IsInt() @Min(1) productId: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'A wholesale warehouse; null: no home',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId: number | null;
}
