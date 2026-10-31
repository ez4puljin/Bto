import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { SalesPickerDto, SalesPickWorkDto, SalesPickWorkQueryDto } from '../dto/sales-orders.dto';
import { SalesPicksService } from '../services/sales-picks.service';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** The picking by warehouse (ADR-0126 #2): the keeper's work list and the lead's pickers. */
@ApiTags('sales')
@Controller('sales-picks')
export class SalesPicksController {
  constructor(private readonly picks: SalesPicksService) {}

  /** The staff app's «Бэлтгэл» (ADR-0132): the caller's parts, not done or done today. */
  @Get()
  @RequirePermission('sales.orders.pick')
  @ApiOkResponse({ type: [SalesPickWorkDto] })
  async work(
    @CurrentUser() ctx: AuthContext,
    @Query() query: SalesPickWorkQueryDto,
  ): Promise<SalesPickWorkDto[]> {
    return (await this.picks.work(ctx, { warehouseId: query.warehouseId ?? null })).map((row) => ({
      ...row,
      startedAt: iso(row.startedAt),
      doneAt: iso(row.doneAt),
    }));
  }

  /** Who may pick in a warehouse: the lead's choice when handing a part over. */
  @Get('pickers')
  @RequirePermission('sales.orders.pickLead')
  @ApiOkResponse({ type: [SalesPickerDto] })
  pickers(@Query('warehouseId', ParseIntPipe) warehouseId: number): Promise<SalesPickerDto[]> {
    return this.picks.pickersOf(warehouseId);
  }
}
