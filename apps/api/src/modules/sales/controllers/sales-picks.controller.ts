import { Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../identity';
import { SalesPickerDto } from '../dto/sales-orders.dto';
import { SalesPicksService } from '../services/sales-picks.service';

/**
 * Picking by warehouse (ADR-0126 #2): who may pick where. The parts themselves ride on the
 * board's cards and on the order detail (no separate page, owner 2026-10-31).
 */
@ApiTags('sales')
@Controller('sales-picks')
export class SalesPicksController {
  constructor(private readonly picks: SalesPicksService) {}

  /** Who may pick in a warehouse: the lead's choice when handing a part over. */
  @Get('pickers')
  @RequirePermission('sales.orders.pickLead')
  @ApiOkResponse({ type: [SalesPickerDto] })
  pickers(@Query('warehouseId', ParseIntPipe) warehouseId: number): Promise<SalesPickerDto[]> {
    return this.picks.pickersOf(warehouseId);
  }
}
