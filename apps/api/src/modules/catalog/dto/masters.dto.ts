import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const CLASSIFICATION_CODE = /^[0-9]{7}$/;

@ApiSchema({ name: 'Uom' })
export class UomDto {
  @ApiProperty() id: number;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'System units only (PCS, BLOCK, BOX, KG)',
  })
  code: string | null;
  @ApiProperty() name: string;
  @ApiProperty({ description: 'Quantities of products based on this unit may have decimals' })
  fractional: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Default e-Barimt measure unit' })
  measureUnit: string | null;
}

@ApiSchema({ name: 'UomList' })
export class UomListDto {
  @ApiProperty({ type: [UomDto] }) data: UomDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the list is short' })
  nextCursor: null;
}

@ApiSchema({ name: 'UomCreateRequest' })
export class CreateUomDto {
  @ApiProperty({ maxLength: 40 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  @ApiProperty() @IsBoolean() fractional: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  measureUnit?: string | null;
}

@ApiSchema({ name: 'UomUpdateRequest' })
export class UpdateUomDto {
  @ApiPropertyOptional({ maxLength: 40 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 50 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  measureUnit?: string | null;
}

@ApiSchema({ name: 'Category' })
export class CategoryDto {
  @ApiProperty() id: number;
  @ApiProperty({ type: Number, nullable: true }) parentId: number | null;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true, description: 'Default БҮНА code (7 digits)' })
  defaultClassificationCode: string | null;
  @ApiProperty({ description: 'Products directly in this category' }) productCount: number;
  @ApiProperty() childCount: number;
}

@ApiSchema({ name: 'CategoryList' })
export class CategoryListDto {
  @ApiProperty({ type: [CategoryDto] }) data: CategoryDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the whole tree' })
  nextCursor: null;
}

@ApiSchema({ name: 'CategoryCreateRequest' })
export class CreateCategoryDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @ApiProperty({ maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: CLASSIFICATION_CODE.source })
  @IsOptional()
  @Matches(CLASSIFICATION_CODE)
  defaultClassificationCode?: string | null;
}

@ApiSchema({ name: 'CategoryUpdateRequest' })
export class UpdateCategoryDto {
  @ApiPropertyOptional({ type: Number, nullable: true, description: 'null moves it to the root' })
  @IsOptional()
  @IsInt()
  @Min(1)
  parentId?: number | null;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, pattern: CLASSIFICATION_CODE.source })
  @IsOptional()
  @Matches(CLASSIFICATION_CODE)
  defaultClassificationCode?: string | null;
}

@ApiSchema({ name: 'Brand' })
export class BrandDto {
  @ApiProperty() id: number;
  @ApiProperty() name: string;
  @ApiProperty() productCount: number;
}

@ApiSchema({ name: 'BrandList' })
export class BrandListDto {
  @ApiProperty({ type: [BrandDto] }) data: BrandDto[];
  @ApiProperty({ type: String, nullable: true, description: 'Always null: the list is short' })
  nextCursor: null;
}

@ApiSchema({ name: 'BrandRequest' })
export class BrandInputDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;
}
