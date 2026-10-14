import { ApiProperty, ApiPropertyOptional, ApiSchema } from '@nestjs/swagger';
import {
  MAX_SEGMENT_COUNTS,
  MAX_SEGMENT_DESCRIPTION,
  MAX_SEGMENT_NAME,
  SEGMENT_ENTITIES,
  type SegmentEntity,
} from '@tugeel/shared/segments';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto, queryIds } from '../../../common/pagination/page';
import { SegmentDefinitionDto } from '../../../common/segments/segment-definition.dto';

export class SegmentQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: SEGMENT_ENTITIES })
  @IsOptional()
  @IsIn(SEGMENT_ENTITIES)
  entity?: SegmentEntity;
}

export class SegmentCountsQueryDto {
  @ApiProperty({ type: [Number], description: `1–${MAX_SEGMENT_COUNTS} segment ids` })
  @Transform(queryIds)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SEGMENT_COUNTS)
  @IsInt({ each: true })
  segmentIds: number[];
}

@ApiSchema({ name: 'SegmentUpdateRequest' })
export class UpdateSegmentDto {
  @ApiProperty({ maxLength: MAX_SEGMENT_NAME, example: 'Бөөний бараа — Жиж ороогүй' })
  @IsString()
  @MaxLength(MAX_SEGMENT_NAME)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_SEGMENT_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEGMENT_DESCRIPTION)
  description?: string | null;

  @ApiProperty({ type: SegmentDefinitionDto })
  @ValidateNested()
  @Type(() => SegmentDefinitionDto)
  definition: SegmentDefinitionDto;
}

@ApiSchema({ name: 'SegmentCreateRequest' })
export class CreateSegmentDto extends UpdateSegmentDto {
  @ApiProperty({ enum: SEGMENT_ENTITIES })
  @IsIn(SEGMENT_ENTITIES)
  entity: SegmentEntity;
}

@ApiSchema({ name: 'SegmentPreviewRequest' })
export class SegmentPreviewRequestDto {
  @ApiProperty({ enum: SEGMENT_ENTITIES })
  @IsIn(SEGMENT_ENTITIES)
  entity: SegmentEntity;

  @ApiProperty({ type: SegmentDefinitionDto })
  @ValidateNested()
  @Type(() => SegmentDefinitionDto)
  definition: SegmentDefinitionDto;
}

@ApiSchema({ name: 'Segment' })
export class SegmentDto {
  @ApiProperty() id: number;
  @ApiProperty({ enum: SEGMENT_ENTITIES }) entity: SegmentEntity;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({ type: SegmentDefinitionDto }) definition: SegmentDefinitionDto;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'SegmentPage' })
export class SegmentPageDto {
  @ApiProperty({ type: [SegmentDto] }) data: SegmentDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor: string | null;
}

@ApiSchema({ name: 'SegmentCount' })
export class SegmentCountDto {
  @ApiProperty() segmentId: number;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Null for a segment the caller may not count, archived or no longer valid',
  })
  count: number | null;
}

@ApiSchema({ name: 'SegmentPreview' })
export class SegmentPreviewDto {
  @ApiProperty({ example: 1751 }) count: number;
}
