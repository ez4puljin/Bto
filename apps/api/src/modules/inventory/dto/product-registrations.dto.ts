import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SKU_PATTERN, WEIGHT_PATTERN } from '@tugeel/shared/catalog';
import { FACTOR_PATTERN } from '@tugeel/shared/units';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_PRODUCT_IMAGES } from '../../catalog';
import { trimmed } from './bins.dto';

@ApiSchema({ name: 'RegistrationUnitRequest' })
export class RegistrationUnitDto {
  @ApiProperty() @IsInt() @Min(1) uomId: number;

  @ApiProperty({
    example: '10',
    pattern: FACTOR_PATTERN.source,
    description: 'Base units in one of this unit',
  })
  @IsString()
  @Matches(FACTOR_PATTERN)
  factorToBase: string;

  @ApiPropertyOptional({ type: [String], description: 'Barcodes as printed or scanned' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  barcodes?: string[];
}

@ApiSchema({ name: 'RegistrationImageRequest' })
export class RegistrationImageDto {
  @ApiProperty({ description: 'Uploaded file of kind catalog.product_image' })
  @IsInt()
  @Min(1)
  imageFileId: number;

  @ApiProperty({ description: 'Uploaded file of kind catalog.product_thumb' })
  @IsInt()
  @Min(1)
  thumbFileId: number;
}

/** A new product with its supplier, home warehouse and photos (ADR-0044 #5). */
@ApiSchema({ name: 'ProductRegistrationRequest' })
export class ProductRegistrationDto {
  @ApiProperty({
    pattern: SKU_PATTERN.source,
    description: 'The suggested code (GET /products/next-sku) or a typed one in the range',
  })
  @Matches(SKU_PATTERN)
  sku: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty() @IsInt() @Min(1) categoryId: number;

  @ApiProperty() @IsInt() @Min(1) baseUomId: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: WEIGHT_PATTERN.source,
    description: 'kg per base unit',
  })
  @IsOptional()
  @Matches(WEIGHT_PATTERN)
  weightKg?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Barcodes as printed or scanned' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  baseBarcodes?: string[];

  @ApiProperty({
    example: '12',
    pattern: FACTOR_PATTERN.source,
    description: 'Base units in one box',
  })
  @IsString()
  @Matches(FACTOR_PATTERN)
  boxFactor: string;

  @ApiPropertyOptional({ type: [String], description: 'Barcodes as printed or scanned' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  boxBarcodes?: string[];

  @ApiPropertyOptional({ type: [RegistrationUnitDto], description: 'Other units, never the box' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RegistrationUnitDto)
  units?: RegistrationUnitDto[];

  @ApiProperty() @IsInt() @Min(1) supplierId: number;

  @ApiProperty({ description: 'An active wholesale warehouse' })
  @IsInt()
  @Min(1)
  homeWarehouseId: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Label code of a storage or picking shelf of the home warehouse',
  })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  fixedBinCode?: string | null;

  @ApiProperty({
    type: [RegistrationImageDto],
    minItems: 1,
    maxItems: MAX_PRODUCT_IMAGES,
    description: 'The first becomes the primary photo',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PRODUCT_IMAGES)
  @ValidateNested({ each: true })
  @Type(() => RegistrationImageDto)
  images: RegistrationImageDto[];
}

@ApiSchema({ name: 'RegisteredProduct' })
export class RegisteredProductDto {
  @ApiProperty() productId: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
}
