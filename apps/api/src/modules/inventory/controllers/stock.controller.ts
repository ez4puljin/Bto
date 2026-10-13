import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, Authenticated, CurrentUser, RequirePermission } from '../../identity';
import {
  BinContentDto,
  LowStockPageDto,
  LowStockQueryDto,
  ProductStockDetailDto,
  ProductStockPageDto,
  ReconciliationStatusDto,
  StockMovementPageDto,
  StockMovementQueryDto,
  StockQueryDto,
} from '../dto/stock.dto';
import { StockQueryService } from '../services/stock-query.service';
import {
  toBinContentDto,
  toLowStockRowDto,
  toProductStockDetailDto,
  toProductStockDto,
  toReconciliationRunDto,
  toStockMovementDto,
} from './mappers';

const COSTS = 'inventory.costs.manage';

/** Stock balances for every signed-in user; costs only reach holders of inventory.costs.manage. */
@ApiTags('inventory')
@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockQueryService) {}

  @Get()
  @Authenticated()
  @ApiOkResponse({ type: ProductStockPageDto })
  async overview(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockQueryDto,
  ): Promise<ProductStockPageDto> {
    const page = await this.stock.overview(query);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map((row) => toProductStockDto(row, withCosts)),
      nextCursor: page.nextCursor,
    };
  }

  /** Movement history (SPEC §8.2 #1): ledger rows newest first, with document numbers. */
  @Get('movements')
  @Authenticated()
  @ApiOkResponse({ type: StockMovementPageDto })
  async movements(
    @CurrentUser() ctx: AuthContext,
    @Query() query: StockMovementQueryDto,
  ): Promise<StockMovementPageDto> {
    const page = await this.stock.movements(query);
    const withCosts = ctx.permissions.has(COSTS);
    return {
      data: page.data.map((row) => toStockMovementDto(row, withCosts)),
      nextCursor: page.nextCursor,
    };
  }

  /** The low-stock list of a warehouse (SPEC §8.2 #4, ADR-0039): out of stock first. */
  @Get('low')
  @Authenticated()
  @ApiOkResponse({ type: LowStockPageDto })
  async low(@Query() query: LowStockQueryDto): Promise<LowStockPageDto> {
    const page = await this.stock.lowStock(query);
    return { data: page.data.map(toLowStockRowDto), nextCursor: page.nextCursor };
  }

  @Get('products/:id')
  @Authenticated()
  @ApiOkResponse({ type: ProductStockDetailDto })
  async product(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ProductStockDetailDto> {
    return toProductStockDetailDto(await this.stock.ofProduct(id), ctx.permissions.has(COSTS));
  }

  @Get('bins/:id')
  @Authenticated()
  @ApiOkResponse({ type: BinContentDto })
  async bin(@Param('id', ParseIntPipe) id: number): Promise<BinContentDto> {
    return toBinContentDto(await this.stock.ofBin(id));
  }

  /** The last check of the caches against the ledger, for the admin banner. */
  @Get('reconciliation/latest')
  @RequirePermission('inventory.setup.manage')
  @ApiOkResponse({ type: ReconciliationStatusDto })
  async reconciliation(): Promise<ReconciliationStatusDto> {
    const run = await this.stock.latestReconciliation();
    return { lastRun: run ? toReconciliationRunDto(run) : null };
  }
}
