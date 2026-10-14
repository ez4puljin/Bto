import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  MAX_CONDITION_IDS,
  MAX_GROUP_CONDITIONS,
  MAX_SEGMENT_GROUPS,
  MAX_SEGMENT_TEXT,
  SEGMENT_MATCHES,
  SEGMENT_OPERATORS,
  type SegmentMatch,
  type SegmentOperator,
} from '@tugeel/shared/segments';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A segment's conditions as a request carries them (ADR-0049 #2). These checks keep the shape;
 * `segmentIssue` (`@tugeel/shared/segments`) checks the fields, operators and values against the
 * entity's registry where the definition is used. Catalog (`POST /products/query`) and segments
 * both take it, and neither may import the other, so it lives in `common` like `PageQueryDto`.
 */
@ApiSchema({ name: 'SegmentCondition' })
export class SegmentConditionDto {
  @ApiProperty({ example: 'category', description: 'A field of the entity (SEGMENT_FIELDS)' })
  @IsString()
  @MaxLength(40)
  field: string;

  @ApiProperty({ enum: SEGMENT_OPERATORS })
  @IsIn(SEGMENT_OPERATORS)
  op: SegmentOperator;

  @ApiPropertyOptional({ type: [Number], example: [12] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CONDITION_IDS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  ids?: number[];

  @ApiPropertyOptional({ type: [String], example: ['ACTIVE'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  values?: string[];

  @ApiPropertyOptional({ example: '2026-10-01', description: 'Ulaanbaatar day, included' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  from?: string;

  @ApiPropertyOptional({ example: '2026-10-14', description: 'Ulaanbaatar day, included' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  to?: string;

  @ApiPropertyOptional({ example: 30, description: 'LAST_DAYS: today and the days before it' })
  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({ example: '1000', description: 'Whole MNT' })
  @IsOptional()
  @IsString()
  @MaxLength(13)
  min?: string;

  @ApiPropertyOptional({ example: '5000', description: 'Whole MNT' })
  @IsOptional()
  @IsString()
  @MaxLength(13)
  max?: string;

  @ApiPropertyOptional({ example: 4, description: 'Stock conditions: one warehouse, or any' })
  @IsOptional()
  @IsInt()
  @Min(1)
  warehouseId?: number;

  @ApiPropertyOptional({ example: 'кока', maxLength: MAX_SEGMENT_TEXT })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEGMENT_TEXT)
  text?: string;
}

@ApiSchema({ name: 'SegmentGroup' })
export class SegmentGroupDto {
  @ApiProperty({ enum: SEGMENT_MATCHES })
  @IsIn(SEGMENT_MATCHES)
  match: SegmentMatch;

  @ApiProperty({ type: [SegmentConditionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_GROUP_CONDITIONS)
  @ValidateNested({ each: true })
  @Type(() => SegmentConditionDto)
  conditions: SegmentConditionDto[];
}

@ApiSchema({ name: 'SegmentDefinition' })
export class SegmentDefinitionDto {
  @ApiProperty({ enum: SEGMENT_MATCHES, description: 'ALL: every group holds; ANY: one does' })
  @IsIn(SEGMENT_MATCHES)
  match: SegmentMatch;

  @ApiProperty({ type: [SegmentGroupDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEGMENT_GROUPS)
  @ValidateNested({ each: true })
  @Type(() => SegmentGroupDto)
  groups: SegmentGroupDto[];
}
