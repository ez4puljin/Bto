import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  Authenticated,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  CreateSegmentDto,
  SegmentCountDto,
  SegmentCountsQueryDto,
  SegmentDto,
  SegmentPageDto,
  SegmentPreviewDto,
  SegmentPreviewRequestDto,
  SegmentQueryDto,
  UpdateSegmentDto,
} from '../dto/segments.dto';
import { type Segment, SegmentsService } from '../services/segments.service';

const MANAGE = 'segments.manage';

function toSegmentDto(segment: Segment): SegmentDto {
  return {
    id: segment.id,
    entity: segment.entity,
    name: segment.name,
    description: segment.description,
    definition: segment.definition,
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString(),
  };
}

/** Segments (ADR-0049 #5): everyone reads them and their counts; admins change them. */
@ApiTags('segments')
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: SegmentPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SegmentQueryDto,
  ): Promise<SegmentPageDto> {
    const page = await this.segments.list(ctx, query);
    return { data: page.data.map(toSegmentDto), nextCursor: page.nextCursor };
  }

  /** How many records each segment keeps. Declared before `:id`, so "counts" never reaches it. */
  @Get('counts')
  @Authenticated()
  @ApiOkResponse({ type: [SegmentCountDto] })
  counts(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SegmentCountsQueryDto,
  ): Promise<SegmentCountDto[]> {
    return this.segments.counts(ctx, query.segmentIds);
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: SegmentDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SegmentDto> {
    return toSegmentDto(await this.segments.get(ctx, id));
  }

  /** The editor's live count of conditions not saved yet. */
  @Post('preview')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: SegmentPreviewDto })
  async preview(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SegmentPreviewRequestDto,
  ): Promise<SegmentPreviewDto> {
    return { count: await this.segments.preview(ctx, body.entity, body.definition) };
  }

  @Post()
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: SegmentDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateSegmentDto,
  ): Promise<SegmentDto> {
    return toSegmentDto(await this.segments.create(ctx, body.entity, body));
  }

  @Put(':id')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: SegmentDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSegmentDto,
  ): Promise<SegmentDto> {
    return toSegmentDto(await this.segments.update(ctx, id, body));
  }

  /** Archives the segment: segments are never deleted (ADR-0049 #1). */
  @Delete(':id')
  @RequirePermission(MANAGE)
  @HttpCode(204)
  @ApiNoContentResponse()
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.segments.archive(ctx, id);
  }
}
