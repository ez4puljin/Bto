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
  CreateSegmentListDto,
  SegmentAppDto,
  SegmentAppMoveDto,
  SegmentCountDto,
  SegmentCountsQueryDto,
  SegmentDto,
  SegmentPageDto,
  SegmentPreviewDto,
  SegmentPreviewRequestDto,
  SegmentProductsDto,
  SegmentProductsResultDto,
  SegmentQueryDto,
  UpdateSegmentDto,
} from '../dto/segments.dto';
import { SegmentListsService } from '../services/segment-lists.service';
import { type Segment, SegmentsService } from '../services/segments.service';

const MANAGE = 'segments.manage';
/** «Bto300»'s home (ADR-0092 #9): which product segments it shows, and in what order. */
const HOME = 'customer_app.home.manage';

function toSegmentDto(segment: Segment): SegmentDto {
  return {
    id: segment.id,
    entity: segment.entity,
    kind: segment.kind,
    name: segment.name,
    description: segment.description,
    definition: segment.definition,
    appRank: segment.appRank,
    appShownCount: segment.appShownCount,
    createdAt: segment.createdAt.toISOString(),
    updatedAt: segment.updatedAt.toISOString(),
  };
}

/**
 * Segments (ADR-0049 #5): everyone reads them and their counts; admins change them, and the
 * members of hand-picked product segments (ADR-0052).
 */
@ApiTags('segments')
@Controller('segments')
export class SegmentsController {
  constructor(
    private readonly segments: SegmentsService,
    private readonly lists: SegmentListsService,
  ) {}

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

  /**
   * A hand-picked product segment of the ticked products (ADR-0052): 1–20,000 ids, an unknown one
   * refused at `productIds`; a live name taken by any product segment is DUPLICATE_VALUE.
   */
  @Post('lists')
  @RequirePermission(MANAGE)
  @Idempotent()
  @ApiCreatedResponse({ type: SegmentDto })
  async createList(
    @CurrentUser() ctx: AuthContext,
    @Body() body: CreateSegmentListDto,
  ): Promise<SegmentDto> {
    return toSegmentDto(await this.lists.create(ctx, body));
  }

  /**
   * Adds products to a hand-picked segment (ADR-0052); those already in are counted, never added
   * twice. 422 for a RULES segment, 409 SEGMENT_TOO_LARGE past 20,000 members.
   */
  @Post(':id/products')
  @RequirePermission(MANAGE)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: SegmentProductsResultDto })
  addProducts(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SegmentProductsDto,
  ): Promise<SegmentProductsResultDto> {
    return this.lists.add(ctx, id, body.productIds);
  }

  /** Takes products out of a hand-picked segment (ADR-0052); those not in it are counted. */
  @Post(':id/products/remove')
  @RequirePermission(MANAGE)
  @Idempotent()
  @HttpCode(200)
  @ApiOkResponse({ type: SegmentProductsResultDto })
  removeProducts(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SegmentProductsDto,
  ): Promise<SegmentProductsResultDto> {
    return this.lists.remove(ctx, id, body.productIds);
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

  /** «Апп-д харуулах» (ADR-0092 #2): a product segment shown on «Bto300»'s home, or not. */
  @Put(':id/app')
  @RequirePermission(HOME)
  @ApiOkResponse({ type: SegmentDto })
  async setShownInApp(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SegmentAppDto,
  ): Promise<SegmentDto> {
    return toSegmentDto(await this.segments.setShownInApp(ctx, id, body.shown));
  }

  @Post(':id/app/move')
  @RequirePermission(HOME)
  @HttpCode(200)
  @ApiOkResponse({ type: SegmentDto })
  async moveInApp(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SegmentAppMoveDto,
  ): Promise<SegmentDto> {
    return toSegmentDto(await this.segments.moveInApp(ctx, id, body.direction));
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
