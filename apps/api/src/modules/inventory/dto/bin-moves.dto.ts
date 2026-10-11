import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { BIN_MOVE_STATUSES } from '../schema';
import { QTY, trimmed } from './bins.dto';

type BinMoveStatus = (typeof BIN_MOVE_STATUSES)[number];

@ApiSchema({ name: 'BinMoveLine' })
export class BinMoveLineDto {
  @ApiProperty() id: number;
  @ApiProperty() productId: number;
  @ApiProperty() productSku: string;
  @ApiProperty() productName: string;
  @ApiProperty() productUnitId: number;
  @ApiProperty({ example: 'хайрцаг' }) unitName: string;
  @ApiProperty({ example: '2' }) enteredQty: string;
  @ApiProperty({ example: '48', description: 'Base units' }) qtyBase: string;
  @ApiProperty() fromBinId: number;
  @ApiProperty({ example: 'RECEIVING' }) fromBinCode: string;
  @ApiProperty() toBinId: number;
  @ApiProperty({ example: 'A-01-03' }) toBinCode: string;
}

@ApiSchema({ name: 'BinMoveDetail' })
export class BinMoveDetailDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true, example: 'BM-2026-000001' }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ enum: BIN_MOVE_STATUSES }) status: BinMoveStatus;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: [BinMoveLineDto] }) lines: BinMoveLineDto[];
}

@ApiSchema({ name: 'BinMoveSummary' })
export class BinMoveSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) number: string | null;
  @ApiProperty() warehouseId: number;
  @ApiProperty({ type: String, nullable: true }) note: string | null;
  @ApiProperty() lineCount: number;
  @ApiProperty({ type: String, format: 'date', nullable: true }) effectiveDate: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) postedAt: string | null;
}

@ApiSchema({ name: 'BinMovePage' })
export class BinMovePageDto {
  @ApiProperty({ type: [BinMoveSummaryDto] }) data: BinMoveSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class BinMoveListQueryDto extends PageQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) warehouseId?: number;
}

@ApiSchema({ name: 'BinMoveLineRequest' })
export class BinMoveLineRequestDto {
  @ApiProperty() @IsInt() @Min(1) productUnitId: number;
  @ApiProperty({ example: '2', description: 'In the product unit' })
  @Matches(QTY)
  enteredQty: string;
  @ApiProperty() @IsInt() @Min(1) fromBinId: number;
  @ApiProperty() @IsInt() @Min(1) toBinId: number;
}

@ApiSchema({ name: 'BinMoveCreateRequest' })
export class CreateBinMoveDto {
  @ApiProperty() @IsInt() @Min(1) warehouseId: number;
  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 500 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @MaxLength(500)
  note?: string | null;
  @ApiProperty({ type: [BinMoveLineRequestDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BinMoveLineRequestDto)
  lines: BinMoveLineRequestDto[];
}
