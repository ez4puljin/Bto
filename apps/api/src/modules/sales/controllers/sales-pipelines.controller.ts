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
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  SalesArchivedDto,
  SalesOrderFiltersQueryDto,
  SalesPipelineCopyRequestDto,
  SalesPipelineDto,
  SalesPipelineRequestDto,
  SalesStageCardsDto,
  SalesStageSortRequestDto,
} from '../dto/sales-boards.dto';
import { overdueDto } from '../overdue';
import { READ } from '../services/sales-access.service';
import { SalesOrderQueryService } from '../services/sales-order-query.service';
import { SalesOrdersService } from '../services/sales-orders.service';
import {
  type PipelineDetail,
  type PipelineInput,
  SalesPipelinesService,
} from '../services/sales-pipelines.service';

export function toPipelineDto(detail: PipelineDetail): SalesPipelineDto {
  const { pipeline, rights } = detail;
  return {
    id: pipeline.id,
    boardId: pipeline.boardId,
    name: pipeline.name,
    position: pipeline.position,
    visibility: pipeline.visibility,
    ownOrdersOnly: pipeline.ownOrdersOnly,
    archivedAt: pipeline.archivedAt?.toISOString() ?? null,
    createdAt: pipeline.createdAt.toISOString(),
    roles: pipeline.roles,
    canManage: rights.manage,
    seesAll: rights.seesAll,
    stages: detail.stages.map(({ stage, rights: stageRights }) => ({
      id: stage.id,
      pipelineId: stage.pipelineId,
      name: stage.name,
      position: stage.position,
      action: stage.action,
      printPickList: stage.printPickList,
      printDeliveryNote: stage.printDeliveryNote,
      cardSort: stage.cardSort,
      archivedAt: stage.archivedAt?.toISOString() ?? null,
      roles: stage.roles,
      canView: stageRights.view,
      canEdit: stageRights.edit,
      canMove: stageRights.move,
    })),
  };
}

const inputOf = (body: SalesPipelineRequestDto): PipelineInput => ({
  boardId: body.boardId,
  name: body.name,
  visibility: body.visibility,
  ownOrdersOnly: body.ownOrdersOnly,
  roles: body.roles,
  stages: body.stages.map((stage) => ({
    id: stage.id ?? null,
    name: stage.name,
    action: stage.action,
    printPickList: stage.printPickList,
    printDeliveryNote: stage.printDeliveryNote,
    roles: stage.roles,
  })),
});

/**
 * Pipelines (ADR-0057): the caller's pipelines with their stages and rights, their cards, and
 * configuring them — creating and copying under `sales.boards.manage`, saving and archiving also
 * for a MANAGE role (checked in the service).
 */
@ApiTags('sales')
@Controller('sales-pipelines')
export class SalesPipelinesController {
  constructor(
    private readonly pipelines: SalesPipelinesService,
    private readonly queries: SalesOrderQueryService,
  ) {}

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesPipelineDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesPipelineDto> {
    return toPipelineDto(await this.pipelines.get(ctx, id));
  }

  /** The cards of the pipeline's visible stages, each in its sort, with counts and totals. */
  @Get(':id/cards')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesStageCardsDto] })
  async cards(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: SalesOrderFiltersQueryDto,
  ): Promise<SalesStageCardsDto[]> {
    return (await this.queries.cards(ctx, id, query)).map((stage) => ({
      stageId: stage.stageId,
      count: stage.count,
      total: stage.total.toFixed(0),
      cards: stage.cards.map((card) => ({
        ...card,
        total: card.total?.toFixed(0) ?? null,
        customerOverdue: overdueDto(card.customerOverdue),
        stageEnteredAt: card.stageEnteredAt.toISOString(),
      })),
    }));
  }

  @Post()
  @RequirePermission(READ)
  @ApiCreatedResponse({ type: SalesPipelineDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesPipelineRequestDto,
  ): Promise<SalesPipelineDto> {
    const id = await this.pipelines.create(ctx, inputOf(body));
    return toPipelineDto(await this.pipelines.get(ctx, id));
  }

  /** Saves the pipeline whole: settings, roles and its stages in their order. */
  @Put(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesPipelineDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesPipelineRequestDto,
  ): Promise<SalesPipelineDto> {
    await this.pipelines.update(ctx, id, inputOf(body));
    return toPipelineDto(await this.pipelines.get(ctx, id));
  }

  @Post(':id/copy')
  @RequirePermission(READ)
  @ApiCreatedResponse({ type: SalesPipelineDto })
  async copy(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesPipelineCopyRequestDto,
  ): Promise<SalesPipelineDto> {
    const copied = await this.pipelines.copy(ctx, id, body);
    return toPipelineDto(await this.pipelines.get(ctx, copied));
  }

  @Post(':id/archive')
  @HttpCode(204)
  @RequirePermission(READ)
  @ApiNoContentResponse()
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.pipelines.archive(ctx, id);
  }

  @Post(':id/unarchive')
  @HttpCode(204)
  @RequirePermission(READ)
  @ApiNoContentResponse()
  async unarchive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.pipelines.unarchive(ctx, id);
  }
}

/** A stage's own actions from the board's «⋯» menu (ADR-0057). */
@ApiTags('sales')
@Controller('sales-stages')
export class SalesStagesController {
  constructor(
    private readonly pipelines: SalesPipelinesService,
    private readonly orders: SalesOrdersService,
  ) {}

  /** Archives a stage holding no unfinished order; answers the pipeline. */
  @Delete(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesPipelineDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesPipelineDto> {
    const pipelineId = await this.pipelines.archiveStage(ctx, id);
    return toPipelineDto(await this.pipelines.get(ctx, pipelineId));
  }

  /** How the stage orders its cards, for everyone. */
  @Put(':id/sort')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesPipelineDto })
  async sort(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesStageSortRequestDto,
  ): Promise<SalesPipelineDto> {
    const pipelineId = await this.pipelines.setSort(ctx, id, body.sort);
    return toPipelineDto(await this.pipelines.get(ctx, pipelineId));
  }

  /** Archives every finished order of the stage the caller sees. */
  @Post(':id/archive-cards')
  @HttpCode(200)
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesArchivedDto })
  async archiveCards(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesArchivedDto> {
    return { archived: await this.orders.archiveFinished(ctx, id) };
  }
}
