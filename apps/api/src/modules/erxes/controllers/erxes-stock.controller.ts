import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  ErxesStockCompareQueryDto,
  ErxesStockComparisonDto,
  ErxesStockLocationDto,
  ErxesStockOverviewDto,
  UpdateErxesStockLocationDto,
} from '../dto/erxes-stock.dto';
import { ErxesStockService } from '../services/erxes-stock.service';

/**
 * Reading the comparison: Bto has no inventory read right (stock is open to every user), and the
 * stock-count right is the one of the people who compare counted with recorded stock (ADR-0221).
 */
const READ = 'inventory.stocktakes.manage';
/** Linking locations and starting a read: the warehouse set-up right (ADR-0221). */
const MANAGE = 'inventory.setup.manage';

/**
 * «Эрхэтийн үлдэгдэл» (ADR-0221): Erkhet's balances by location, read through erxes, beside Bto's
 * on-hand. Read-only for stock; nothing here writes to erxes or Erkhet.
 */
@ApiTags('erxes')
@Controller('erxes/stock')
export class ErxesStockController {
  constructor(private readonly stock: ErxesStockService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErxesStockOverviewDto })
  overview(): Promise<ErxesStockOverviewDto> {
    return this.stock.overview();
  }

  /** «Үлдэгдэл татах»: starts a read in the worker, or answers the one under way. */
  @Post('runs')
  @HttpCode(200)
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: ErxesStockOverviewDto })
  start(@CurrentUser() ctx: AuthContext): Promise<ErxesStockOverviewDto> {
    return this.stock.start(ctx);
  }

  @Get('locations')
  @RequirePermission(READ)
  @ApiOkResponse({ type: [ErxesStockLocationDto] })
  locations(): Promise<ErxesStockLocationDto[]> {
    return this.stock.locations();
  }

  @Patch('locations/:code')
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: [ErxesStockLocationDto] })
  link(
    @CurrentUser() ctx: AuthContext,
    @Param('code') code: string,
    @Body() body: UpdateErxesStockLocationDto,
  ): Promise<ErxesStockLocationDto[]> {
    return this.stock.link(ctx, code, body.warehouseId ?? null);
  }

  @Get('compare')
  @RequirePermission(READ)
  @ApiOkResponse({ type: ErxesStockComparisonDto })
  compare(@Query() query: ErxesStockCompareQueryDto): Promise<ErxesStockComparisonDto> {
    return this.stock.compare(query);
  }
}
