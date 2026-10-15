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
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  SalesBoardDto,
  SalesBoardRequestDto,
  SalesBoardRolesRequestDto,
  SalesChannelDefaultDto,
  SalesChannelDefaultRequestDto,
  SalesStageCardsDto,
  SalesStageOrderRequestDto,
  SalesStageRequestDto,
} from '../dto/sales-boards.dto';
import { type BoardView, SalesBoardsService } from '../services/sales-boards.service';

const READ = 'sales.orders.read';

/**
 * Order boards (ADR-0056): everyone with `sales.orders.read` lists the boards they may see and
 * their cards; configuring needs `sales.boards.manage` or a MANAGE role on the board (checked in
 * the service).
 */
@ApiTags('sales')
@Controller('sales-boards')
export class SalesBoardsController {
  constructor(private readonly boards: SalesBoardsService) {}

  toDto(ctx: AuthContext, board: BoardView): SalesBoardDto {
    return {
      id: board.id,
      name: board.name,
      branchId: board.branchId,
      position: board.position,
      archivedAt: board.archivedAt?.toISOString() ?? null,
      roles: board.roles,
      canManage: this.boards.isManager(ctx) || board.canManage,
      stages: board.stages.map((stage) => {
        const rights = this.boards.rightsOn(ctx, board, stage);
        return {
          id: stage.id,
          boardId: stage.boardId,
          name: stage.name,
          position: stage.position,
          action: stage.action,
          printPickList: stage.printPickList,
          printDeliveryNote: stage.printDeliveryNote,
          archivedAt: stage.archivedAt?.toISOString() ?? null,
          roles: stage.roles,
          canView: rights.view,
          canEdit: rights.edit,
          canMove: rights.move,
        };
      }),
    };
  }

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesBoardDto] })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query('archived') archived?: string,
  ): Promise<SalesBoardDto[]> {
    return (await this.boards.list(ctx, archived === 'true')).map((board) =>
      this.toDto(ctx, board),
    );
  }

  @Get('defaults')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesChannelDefaultDto] })
  defaults(): Promise<SalesChannelDefaultDto[]> {
    return this.boards.defaults();
  }

  @Put('defaults')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesChannelDefaultDto] })
  setDefault(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesChannelDefaultRequestDto,
  ): Promise<SalesChannelDefaultDto[]> {
    return this.boards.setDefault(
      ctx,
      body.channel,
      body.boardId && body.stageId ? { boardId: body.boardId, stageId: body.stageId } : null,
    );
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesBoardDto })
  async get(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesBoardDto> {
    return this.toDto(ctx, await this.boards.get(ctx, id));
  }

  @Get(':id/cards')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesStageCardsDto] })
  async cards(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesStageCardsDto[]> {
    return (await this.boards.cards(ctx, id)).map((stage) => ({
      stageId: stage.stageId,
      count: stage.count,
      total: stage.total.toFixed(0),
      cards: stage.cards.map((card) => ({
        ...card,
        total: card.total?.toFixed(0) ?? null,
        stageEnteredAt: card.stageEnteredAt.toISOString(),
      })),
    }));
  }

  @Post()
  @RequirePermission(READ)
  @ApiCreatedResponse({ type: SalesBoardDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesBoardRequestDto,
  ): Promise<SalesBoardDto> {
    return this.toDto(
      ctx,
      await this.boards.create(ctx, { name: body.name, branchId: body.branchId ?? null }),
    );
  }

  @Put(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesBoardDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesBoardRequestDto,
  ): Promise<SalesBoardDto> {
    return this.toDto(
      ctx,
      await this.boards.update(ctx, id, { name: body.name, branchId: body.branchId ?? null }),
    );
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(READ)
  archive(@CurrentUser() ctx: AuthContext, @Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.boards.archive(ctx, id);
  }

  @Put(':id/roles')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesBoardDto })
  async setRoles(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesBoardRolesRequestDto,
  ): Promise<SalesBoardDto> {
    return this.toDto(ctx, await this.boards.setBoardRoles(ctx, id, body));
  }

  @Post(':id/stages')
  @RequirePermission(READ)
  @ApiCreatedResponse({ type: SalesBoardDto })
  async addStage(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesStageRequestDto,
  ): Promise<SalesBoardDto> {
    return this.toDto(ctx, await this.boards.addStage(ctx, id, body));
  }

  @Put(':id/stage-order')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesBoardDto })
  async reorder(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesStageOrderRequestDto,
  ): Promise<SalesBoardDto> {
    return this.toDto(ctx, await this.boards.reorderStages(ctx, id, body.stageIds));
  }
}

/** A stage's own settings and its archive. */
@ApiTags('sales')
@Controller('sales-stages')
export class SalesStagesController {
  constructor(private readonly boards: SalesBoardsService) {}

  @Put(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesBoardDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesStageRequestDto,
  ): Promise<SalesBoardDto> {
    const board = await this.boards.updateStage(ctx, id, body);
    return new SalesBoardsController(this.boards).toDto(ctx, board);
  }

  @Delete(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SalesBoardDto })
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<SalesBoardDto> {
    const board = await this.boards.archiveStage(ctx, id);
    return new SalesBoardsController(this.boards).toDto(ctx, board);
  }
}
