import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { SKU_PATTERN } from '@tugeel/shared/catalog';
import { BARCODE_TYPES } from '@tugeel/shared/gtin';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { PRODUCT_STATUSES, VAT_TYPES } from '../schema';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
/** "true"/"false" query strings as booleans (other values fail @IsBoolean). */
const queryBoolean = ({ value }: { value: unknown }) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
};
const SKU = SKU_PATTERN;
const FACTOR = /^\d{1,12}(\.\d{1,6})?$/;
const WEIGHT = /^\d{1,8}(\.\d{1,4})?$/;
const CLASSIFICATION_CODE = /^[0-9]{7}$/;
const TAX_PRODUCT_CODE = /^[0-9]{3}$/;

type VatType = (typeof VAT_TYPES)[number];
type ProductStatus = (typeof PRODUCT_STATUSES)[number];

@ApiSchema({ name: 'UnitRequest' })
export class NewUnitDto {
  @ApiProperty() @IsInt() @Min(1) uomId: number;

  @ApiProperty({
    example: '24',
    pattern: FACTOR.source,
    description: 'Base units in one of this unit',
  })
  @IsString()
  @Matches(FACTOR)
  factorToBase: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefaultSales?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefaultPurchase?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  measureUnit?: string | null;

  @ApiPropertyOptional({ type: [String], description: 'Barcodes as printed or scanned' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  barcodes?: string[];
}

@ApiSchema({ name: 'ProductCreateRequest' })
export class CreateProductDto {
  @ApiPropertyOptional({ pattern: SKU.source, description: 'Omitted: the next free number' })
  @IsOptional()
  @Matches(SKU)
  sku?: string;

  @ApiProperty({ maxLength: 200 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @ApiProperty() @IsInt() @Min(1) categoryId: number;

  @ApiPropertyOptional({ enum: VAT_TYPES, default: 'VAT_ABLE' })
  @IsOptional()
  @IsIn(VAT_TYPES)
  vatType?: VatType;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'null = not decided yet' })
  @IsOptional()
  @IsBoolean()
  cityTax?: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: CLASSIFICATION_CODE.source })
  @IsOptional()
  @Matches(CLASSIFICATION_CODE)
  classificationCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: TAX_PRODUCT_CODE.source })
  @IsOptional()
  @Matches(TAX_PRODUCT_CODE)
  taxProductCode?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: WEIGHT.source,
    description: 'kg per base unit',
  })
  @IsOptional()
  @Matches(WEIGHT)
  weightKg?: string | null;

  @ApiProperty() @IsInt() @Min(1) baseUomId: number;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  baseMeasureUnit?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  baseBarcodes?: string[];

  @ApiPropertyOptional({ type: [NewUnitDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => NewUnitDto)
  units?: NewUnitDto[];
}

@ApiSchema({ name: 'ProductUpdateRequest' })
export class UpdateProductDto {
  @ApiPropertyOptional({ pattern: SKU.source }) @IsOptional() @Matches(SKU) sku?: string;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) categoryId?: number;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: WEIGHT.source })
  @IsOptional()
  @Matches(WEIGHT)
  weightKg?: string | null;

  @ApiPropertyOptional({ enum: PRODUCT_STATUSES })
  @IsOptional()
  @IsIn(PRODUCT_STATUSES)
  status?: ProductStatus;
}

@ApiSchema({ name: 'UnitMeasureUnitRequest' })
export class UnitMeasureUnitDto {
  @ApiProperty() @IsInt() @Min(1) unitId: number;

  @ApiProperty({
    type: String,
    nullable: true,
    maxLength: 50,
    description: 'null: the unit of measure default',
  })
  @Transform(trimmed)
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  measureUnit: string | null;
}

/** The accountant's e-Barimt data of a product (ADR-0044 #6). */
@ApiSchema({ name: 'ProductEbarimtRequest' })
export class UpdateProductEbarimtDto {
  @ApiPropertyOptional({ enum: VAT_TYPES }) @IsOptional() @IsIn(VAT_TYPES) vatType?: VatType;

  @ApiPropertyOptional({ type: Boolean, nullable: true, description: 'null = not decided yet' })
  @IsOptional()
  @IsBoolean()
  cityTax?: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: CLASSIFICATION_CODE.source })
  @IsOptional()
  @Matches(CLASSIFICATION_CODE)
  classificationCode?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: TAX_PRODUCT_CODE.source })
  @IsOptional()
  @Matches(TAX_PRODUCT_CODE)
  taxProductCode?: string | null;

  @ApiPropertyOptional({ type: [UnitMeasureUnitDto], description: 'Current units of the product' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => UnitMeasureUnitDto)
  units?: UnitMeasureUnitDto[];
}

export class ProductListQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: 'Words of the name in either script, a SKU or a barcode' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Includes its subcategories' })
  @IsOptional()
  @Type(() => Number)
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
  @Transform(queryBoolean)
  @IsBoolean()
  saleReady?: boolean;
}

@ApiSchema({ name: 'UnitUpdateRequest' })
export class UpdateUnitDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefaultSales?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefaultPurchase?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  measureUnit?: string | null;
}

@ApiSchema({ name: 'UnitSupersedeRequest' })
export class SupersedeUnitDto {
  @ApiProperty({ example: '20', pattern: FACTOR.source })
  @IsString()
  @Matches(FACTOR)
  factorToBase: string;
}

@ApiSchema({ name: 'BarcodeRequest' })
export class AddBarcodeDto {
  @ApiProperty({ maxLength: 64 }) @IsString() @IsNotEmpty() @MaxLength(64) code: string;
}

@ApiSchema({ name: 'Barcode' })
export class BarcodeDto {
  @ApiProperty() id: number;
  @ApiProperty() code: string;
  @ApiProperty({ type: String, nullable: true }) gtin14: string | null;
  @ApiProperty({ enum: BARCODE_TYPES }) barcodeType: (typeof BARCODE_TYPES)[number];
  @ApiProperty({ description: 'The barcode e-Barimt lines carry for the unit' }) isPrimary: boolean;
  @ApiProperty({ description: 'Issued by the system (EAN-13 prefix 20)' }) isInternal: boolean;
}

@ApiSchema({ name: 'ProductUnit' })
export class ProductUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() uomId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ type: String, nullable: true }) uomCode: string | null;
  @ApiProperty({ description: 'Whether quantities of the product may have decimals' })
  fractional: boolean;
  @ApiProperty({ example: '24' }) factorToBase: string;
  @ApiProperty() isBase: boolean;
  @ApiProperty() isDefaultSales: boolean;
  @ApiProperty() isDefaultPurchase: boolean;
  @ApiProperty({ type: String, nullable: true }) measureUnit: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Own value or the unit-of-measure default',
  })
  effectiveMeasureUnit: string | null;
  @ApiProperty({ type: Number, nullable: true }) supersededBy: number | null;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Set = superseded or retired',
  })
  supersededAt: string | null;
  @ApiProperty({ type: [BarcodeDto] }) barcodes: BarcodeDto[];
}

@ApiSchema({ name: 'ProductImage' })
export class ProductImageDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: String, nullable: true }) url: string | null;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
  @ApiProperty() isPrimary: boolean;
  @ApiProperty() sortOrder: number;
}

@ApiSchema({ name: 'ProductBaseUnit' })
export class ProductBaseUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() uomId: number;
  @ApiProperty() uomName: string;
}

@ApiSchema({ name: 'ProductSummary' })
export class ProductSummaryDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() categoryId: number;
  @ApiProperty({ enum: PRODUCT_STATUSES }) status: ProductStatus;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the price clerk completed the product; null = waiting for prices (ADR-0044)',
  })
  saleReadyAt: string | null;
  @ApiProperty({ enum: VAT_TYPES }) vatType: VatType;
  @ApiProperty({ type: Boolean, nullable: true }) cityTax: boolean | null;
  @ApiProperty({ type: ProductBaseUnitDto }) baseUnit: ProductBaseUnitDto;
  @ApiProperty({ type: String, nullable: true }) thumbUrl: string | null;
}

@ApiSchema({ name: 'ProductListUnit' })
export class ProductListUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() uomId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '24' }) factorToBase: string;
  @ApiProperty() isBase: boolean;
  @ApiProperty({ type: [String], description: 'The primary barcode first' }) barcodes: string[];
}

/** A row of the product list screen: the summary plus what the list columns show (ADR-0037). */
@ApiSchema({ name: 'ProductListItem' })
export class ProductListItemDto extends ProductSummaryDto {
  @ApiProperty({ type: String, nullable: true, description: 'kg per base unit' })
  weightKg: string | null;
  @ApiProperty({ type: String, nullable: true }) classificationCode: string | null;
  @ApiProperty({ type: String, nullable: true }) taxProductCode: string | null;
  @ApiProperty({
    type: [ProductListUnitDto],
    description: 'Current units, base first, then by factor',
  })
  units: ProductListUnitDto[];
}

@ApiSchema({ name: 'ProductPage' })
export class ProductPageDto {
  @ApiProperty({ type: [ProductListItemDto] }) data: ProductListItemDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'ProductDetail' })
export class ProductDetailDto {
  @ApiProperty() id: number;
  @ApiProperty() sku: string;
  @ApiProperty() name: string;
  @ApiProperty() categoryId: number;
  @ApiProperty({ enum: VAT_TYPES }) vatType: VatType;
  @ApiProperty({ type: Boolean, nullable: true }) cityTax: boolean | null;
  @ApiProperty({ type: String, nullable: true }) classificationCode: string | null;
  @ApiProperty({ type: String, nullable: true }) taxProductCode: string | null;
  @ApiProperty({ enum: PRODUCT_STATUSES }) status: ProductStatus;
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the price clerk completed the product; null = waiting for prices (ADR-0044)',
  })
  saleReadyAt: string | null;
  @ApiProperty() tracksLots: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'kg per base unit' }) weightKg:
    string | null;
  @ApiProperty({ format: 'date-time' }) createdAt: string;
  @ApiProperty({ format: 'date-time' }) updatedAt: string;
  @ApiProperty({
    type: [ProductUnitDto],
    description: 'Current units first, then superseded or retired ones',
  })
  units: ProductUnitDto[];
  @ApiProperty({ type: [ProductImageDto] }) images: ProductImageDto[];
}

export class NextSkuQueryDto {
  @ApiPropertyOptional({ description: 'The category whose code range applies (ADR-0044)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;
}

@ApiSchema({ name: 'NextSku' })
export class NextSkuDto {
  @ApiProperty({ example: '10024' }) sku: string;
}

@ApiSchema({ name: 'ResolvedUnit' })
export class ResolvedUnitDto {
  @ApiProperty() id: number;
  @ApiProperty() uomId: number;
  @ApiProperty() uomName: string;
  @ApiProperty({ example: '24' }) factorToBase: string;
  @ApiProperty() isBase: boolean;
}

@ApiSchema({ name: 'BarcodeResolution' })
export class BarcodeResolutionDto {
  @ApiProperty({ type: ProductSummaryDto }) product: ProductSummaryDto;
  @ApiProperty({ type: ResolvedUnitDto }) unit: ResolvedUnitDto;
  @ApiProperty({ type: BarcodeDto }) barcode: BarcodeDto;
}

@ApiSchema({ name: 'ProductImageRequest' })
export class AttachImageDto {
  @ApiProperty({ description: 'Uploaded file of kind catalog.product_image' })
  @IsInt()
  @Min(1)
  imageFileId: number;

  @ApiProperty({ description: 'Uploaded file of kind catalog.product_thumb' })
  @IsInt()
  @Min(1)
  thumbFileId: number;
}
