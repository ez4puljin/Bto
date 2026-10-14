import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  EXPORTABLE_PRODUCT_COLUMNS,
  type ExportableProductColumn,
  MAX_EXPORT_ROWS,
} from '@tugeel/shared/catalog';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SegmentDefinitionDto } from '../../../common/segments/segment-definition.dto';
import { PRODUCT_STATUSES, type ProductStatus } from '../../catalog';

/**
 * A product export (ADR-0049 #6): the ticked products alone, or the product list's filters (the
 * same fields as `POST /products/query`); the visible columns either way.
 */
@ApiSchema({ name: 'ProductExportRequest' })
export class ProductExportRequestDto {
  @ApiPropertyOptional({
    type: [Number],
    description: `The ticked products (1–${MAX_EXPORT_ROWS}), without filters`,
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EXPORT_ROWS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds?: number[];

  @ApiPropertyOptional({ description: 'Words of the name in either script, a SKU or a barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Includes its subcategories' })
  @IsOptional()
  @IsInt()
  @Min(1)
  categoryId?: number;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;

  @ApiPropertyOptional({
    type: Boolean,
    description: 'true: complete products; false: those waiting for prices (ADR-0044)',
  })
  @IsOptional()
  @IsBoolean()
  saleReady?: boolean;

  @ApiPropertyOptional({
    type: SegmentDefinitionDto,
    description: 'Conditions not saved as a segment',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SegmentDefinitionDto)
  where?: SegmentDefinitionDto;

  @ApiPropertyOptional({ description: 'A saved product segment; with where, both apply' })
  @IsOptional()
  @IsInt()
  @Min(1)
  segmentId?: number;

  @ApiProperty({
    enum: EXPORTABLE_PRODUCT_COLUMNS,
    isArray: true,
    description: "The list's visible columns; the file keeps the list's order",
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(EXPORTABLE_PRODUCT_COLUMNS.length)
  @ArrayUnique()
  @IsIn(EXPORTABLE_PRODUCT_COLUMNS, { each: true })
  columns: ExportableProductColumn[];
}
