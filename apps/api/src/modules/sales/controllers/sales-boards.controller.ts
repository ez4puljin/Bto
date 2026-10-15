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
  SalesBoardDto,
  SalesBoardRequestDto,
  SalesBoardTreeQueryDto,
  SalesCreatedDto,
} from '../dto/sales-boards.dto';
import { READ } from '../services/sales-access.service';
import { SalesBoardsService } from '../services/sales-boards.service';

/**
 * Boards (ADR-0057 #1): every reader of orders lists the boards with the pipelines they see;
 * `sales.boards.manage` creates, renames and archives them (checked in the service).
 */
@ApiTags('sales')
@Controller('sales-boards')
export class SalesBoardsController {
  constructor(private readonly boards: SalesBoardsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [SalesBoardDto] })
  async tree(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SalesBoardTreeQueryDto,
  ): Promise<SalesBoardDto[]> {
    return (await this.boards.tree(ctx, query.archived ?? false)).map((board) => ({
      id: board.id,
      name: board.name,
      branchId: board.branchId,
      position: board.position,
      archivedAt: board.archivedAt?.toISOString() ?? null,
      pipelines: board.pipelines.map((pipeline) => ({
        ...pipeline,
        archivedAt: pipeline.archivedAt?.toISOString() ?? null,
        createdAt: pipeline.createdAt.toISOString(),
      })),
    }));
  }

  @Post()
  @RequirePermission(READ)
  @ApiCreatedResponse({ type: SalesCreatedDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesBoardRequestDto,
  ): Promise<SalesCreatedDto> {
    return {
      id: await this.boards.create(ctx, { name: body.name, branchId: body.branchId ?? null }),
    };
  }

  @Put(':id')
  @HttpCode(204)
  @RequirePermission(READ)
  @ApiNoContentResponse()
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: SalesBoardRequestDto,
  ): Promise<void> {
    await this.boards.update(ctx, id, { name: body.name, branchId: body.branchId ?? null });
  }

  /** Archives a board without live pipelines. */
  @Delete(':id')
  @HttpCode(204)
  @RequirePermission(READ)
  @ApiNoContentResponse()
  async archive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.boards.archive(ctx, id);
  }

  @Post(':id/unarchive')
  @HttpCode(204)
  @RequirePermission(READ)
  @ApiNoContentResponse()
  async unarchive(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.boards.unarchive(ctx, id);
  }
}
