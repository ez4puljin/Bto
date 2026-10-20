import {
  ApiProperty,
  ApiPropertyOptional,
  type ApiPropertyOptions,
  ApiSchema,
} from '@nestjs/swagger';
import { MAX_SELECTED_PRODUCTS } from '@tugeel/shared/catalog';
import {
  MAX_SEGMENT_COUNTS,
  MAX_SEGMENT_DESCRIPTION,
  MAX_SEGMENT_NAME,
  SEGMENT_ENTITIES,
  SEGMENT_KINDS,
  type SegmentEntity,
  type SegmentKind,
} from '@tugeel/shared/segments';
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
  MaxLength,
  Min,
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

/** What every segment has: a name and a description. */
class SegmentDetailsDto {
  @ApiProperty({ maxLength: MAX_SEGMENT_NAME, example: 'Бөөний бараа — Жиж ороогүй' })
  @IsString()
  @MaxLength(MAX_SEGMENT_NAME)
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: MAX_SEGMENT_DESCRIPTION })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_SEGMENT_DESCRIPTION)
  description?: string | null;
}

@ApiSchema({ name: 'SegmentUpdateRequest' })
export class UpdateSegmentDto extends SegmentDetailsDto {
  @ApiPropertyOptional({
    type: SegmentDefinitionDto,
    description: 'Required for a RULES segment; a LIST segment takes none (ADR-0052)',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => SegmentDefinitionDto)
  definition?: SegmentDefinitionDto;
}

@ApiSchema({ name: 'SegmentCreateRequest' })
export class CreateSegmentDto extends SegmentDetailsDto {
  @ApiProperty({ enum: SEGMENT_ENTITIES })
  @IsIn(SEGMENT_ENTITIES)
  entity: SegmentEntity;

  @ApiProperty({ type: SegmentDefinitionDto })
  @ValidateNested()
  @Type(() => SegmentDefinitionDto)
  definition: SegmentDefinitionDto;
}

/** Products of a hand-picked segment: 1–20,000 ids; repeats are dropped (ADR-0052). */
const PRODUCT_IDS: ApiPropertyOptions = {
  type: [Number],
  description: `1–${MAX_SELECTED_PRODUCTS} products; repeats are dropped`,
};

@ApiSchema({ name: 'SegmentListRequest' })
export class CreateSegmentListDto extends SegmentDetailsDto {
  // No @ArrayUnique: it is quadratic, and 20,000 ids would stall the event loop.
  @ApiProperty(PRODUCT_IDS)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SELECTED_PRODUCTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];
}

@ApiSchema({ name: 'SegmentProductsRequest' })
export class SegmentProductsDto {
  @ApiProperty(PRODUCT_IDS)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SELECTED_PRODUCTS)
  @IsInt({ each: true })
  @Min(1, { each: true })
  productIds: number[];
}

@ApiSchema({ name: 'SegmentProductsResult' })
export class SegmentProductsResultDto {
  @ApiProperty({ description: 'Products added or removed' }) changed: number;
  @ApiProperty({ description: 'Products already in (adding) or not in (removing)' })
  unchanged: number;
  @ApiProperty({ description: "The segment's size afterwards" }) count: number;
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
  @ApiProperty({
    enum: SEGMENT_KINDS,
    description: 'RULES: saved conditions; LIST: hand-picked products (ADR-0052)',
  })
  kind: SegmentKind;
  @ApiProperty() name: string;
  @ApiProperty({ type: String, nullable: true }) description: string | null;
  @ApiProperty({
    type: SegmentDefinitionDto,
    nullable: true,
    description: 'Null for a LIST segment',
  })
  definition: SegmentDefinitionDto | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Its place among the sections «Bto300» shows (1 first); null when not shown',
  })
  appRank: number | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'How many segments «Bto300» shows; null when this one is not shown',
  })
  appShownCount: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: string;
}

@ApiSchema({ name: 'SegmentAppRequest' })
export class SegmentAppDto {
  @ApiProperty({ description: "«Апп-д харуулах»: shown on «Bto300»'s home (ADR-0092 #2)" })
  @IsBoolean()
  shown: boolean;
}

export const APP_MOVES = ['UP', 'DOWN'] as const;

@ApiSchema({ name: 'SegmentAppMoveRequest' })
export class SegmentAppMoveDto {
  @ApiProperty({ enum: APP_MOVES, description: 'One place up or down among the shown segments' })
  @IsIn(APP_MOVES)
  direction: (typeof APP_MOVES)[number];
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
