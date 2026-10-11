import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, Authenticated, CurrentUser, RequirePermission } from '../../identity';
import {
  BinContentDto,
  ProductStockDetailDto,
  ProductStockPageDto,
  ReconciliationStatusDto,
  StockQueryDto,
} from '../dto/stock.dto';
import { StockQueryService } from '../services/stock-query.service';
import {
  toBinContentDto,
  toProductStockDetailDto,
  toProductStockDto,
  toReconciliationRunDto,
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
