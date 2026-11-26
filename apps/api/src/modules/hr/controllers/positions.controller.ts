import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Authenticated, type AuthContext, CurrentUser } from '../../identity';
import { HrPositionDto, HrPositionRequestDto } from '../dto/positions.dto';
import { HrArchiveRequestDto, IncludeArchivedQueryDto } from '../dto/workforce.dto';
import { type Position, PositionsService } from '../services/positions.service';

const toPosition = (position: Position): HrPositionDto => ({
  ...position,
  archivedAt: position.archivedAt?.toISOString() ?? null,
});

@ApiTags('hr')
@Controller('hr/positions')
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: [HrPositionDto] })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: IncludeArchivedQueryDto,
  ): Promise<HrPositionDto[]> {
    return (await this.positions.list(ctx, query.includeArchived ?? false)).map(toPosition);
  }

  @Get(':id')
  @Authenticated()
  @ApiOkResponse({ type: HrPositionDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HrPositionDto> {
    return toPosition(await this.positions.get(ctx, id));
  }

  @Post()
  @Authenticated()
  @ApiCreatedResponse({ type: HrPositionDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: HrPositionRequestDto,
  ): Promise<HrPositionDto> {
    return toPosition(await this.positions.save(ctx, null, body));
  }

  @Put(':id')
  @Authenticated()
  @ApiOkResponse({ type: HrPositionDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrPositionRequestDto,
  ): Promise<HrPositionDto> {
    return toPosition(await this.positions.save(ctx, id, body));
  }

  @Put(':id/archived')
  @Authenticated()
  @ApiOkResponse({ type: HrPositionDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: HrArchiveRequestDto,
  ): Promise<HrPositionDto> {
    return toPosition(await this.positions.archive(ctx, id, body.archived));
  }
}
