import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  Authenticated,
  type AuthContext,
  CurrentUser,
  Idempotent,
  RequirePermission,
} from '../../identity';
import { loadingDto, SalesLoadingOrderDto, SalesLoadRequestDto } from '../dto/sales-loading.dto';
import { type LoadingOrder, SalesLoadingService } from '../services/sales-loading.service';

const LOAD = 'sales.orders.load';

const orderDto = (row: LoadingOrder): SalesLoadingOrderDto => ({
  ...row,
  total: row.total === null ? null : row.total.toFixed(0),
  pickedAt: row.pickedAt.toISOString(),
  loading: loadingDto(row.loading),
});

/** The driver's «Ачилт» in the staff app (ADR-0179). */
@ApiTags('sales')
@Controller('sales-loading')
export class SalesLoadingController {
  constructor(private readonly loading: SalesLoadingService) {}

  /** The picked orders waiting for a truck, then the caller's own loadings of today. */
  @Get()
  @RequirePermission(LOAD)
  @ApiOkResponse({ type: [SalesLoadingOrderDto] })
  async work(@CurrentUser() ctx: AuthContext): Promise<SalesLoadingOrderDto[]> {
    return (await this.loading.work(ctx)).map(orderDto);
  }

  /** «Ачсан»: the named orders onto the caller's truck now; answers the list afterwards. */
  @Post()
  @HttpCode(200)
  @RequirePermission(LOAD)
  @Idempotent()
  @ApiOkResponse({ type: [SalesLoadingOrderDto] })
  async load(
    @CurrentUser() ctx: AuthContext,
    @Body() body: SalesLoadRequestDto,
  ): Promise<SalesLoadingOrderDto[]> {
    return (await this.loading.load(ctx, body.orderIds)).map(orderDto);
  }

  /**
   * A loading taken back: the driver (`sales.orders.load`) the same day, the board's admin
   * (`sales.boards.manage`) at any time; either right is enough, so the service checks them.
   */
  @Post(':orderId/undo')
  @HttpCode(200)
  @Authenticated()
  @ApiOkResponse({ type: [SalesLoadingOrderDto] })
  async undo(
    @CurrentUser() ctx: AuthContext,
    @Param('orderId', ParseIntPipe) orderId: number,
  ): Promise<SalesLoadingOrderDto[]> {
    return (await this.loading.undo(ctx, orderId)).map(orderDto);
  }
}
