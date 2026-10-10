import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Matches, Min } from 'class-validator';
import { PageQueryDto } from '../../../common/pagination/page';
import { READINESS_GAPS, type ReadinessGap } from '../services/ebarimt-readiness.service';
import { ProductSummaryDto } from './products.dto';

const CLASSIFICATION_CODE = /^[0-9]{7}$/;
const TAX_PRODUCT_CODE = /^[0-9]{3}$/;

@ApiSchema({ name: 'ReadinessMissing' })
export class ReadinessMissingDto {
  @ApiProperty({ description: 'No БҮНА code' }) classificationCode: number;
  @ApiProperty({ description: 'VAT_FREE / VAT_ZERO without a tax product code' })
  taxProductCode: number;
  @ApiProperty({ description: 'A current unit without an e-Barimt measure unit' })
  measureUnit: number;
  @ApiProperty({ description: 'City tax not decided' }) cityTax: number;
}

@ApiSchema({ name: 'ReadinessReport' })
export class ReadinessReportDto {
  @ApiProperty() activeProducts: number;
  @ApiProperty({ type: ReadinessMissingDto }) missing: ReadinessMissingDto;
}

@ApiSchema({ name: 'ReadinessRow' })
export class ReadinessRowDto {
  @ApiProperty({ type: ProductSummaryDto }) product: ProductSummaryDto;
  @ApiProperty({ enum: READINESS_GAPS, isArray: true }) missing: ReadinessGap[];
}

@ApiSchema({ name: 'ReadinessPage' })
export class ReadinessPageDto {
  @ApiProperty({ type: [ReadinessRowDto] }) data: ReadinessRowDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

export class ReadinessQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: READINESS_GAPS })
  @IsOptional()
  @IsIn(READINESS_GAPS)
  gap?: ReadinessGap;

  @ApiPropertyOptional({ description: 'Includes its subcategories' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  categoryId?: number;
}

@ApiSchema({ name: 'ReadinessAssignRequest' })
export class AssignRequestDto {
  @ApiProperty() @IsInt() @Min(1) categoryId: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  includeSubcategories?: boolean;

  @ApiPropertyOptional({ pattern: CLASSIFICATION_CODE.source })
  @IsOptional()
  @Matches(CLASSIFICATION_CODE)
  classificationCode?: string;

  @ApiPropertyOptional({
    pattern: TAX_PRODUCT_CODE.source,
    description: 'Given to VAT_FREE / VAT_ZERO products only',
  })
  @IsOptional()
  @Matches(TAX_PRODUCT_CODE)
  taxProductCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() cityTax?: boolean;

  @ApiPropertyOptional({ description: 'Count only, change nothing' })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

@ApiSchema({ name: 'ReadinessAssignResult' })
export class AssignResultDto {
  @ApiProperty() classificationCode: number;
  @ApiProperty() taxProductCode: number;
  @ApiProperty() cityTax: number;
}
