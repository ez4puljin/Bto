import { Controller, Delete, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { StockCountAccountDto } from '../dto/finance.dto';
import { StockCountAccountsService } from '../services/stock-count-accounts.service';

/** The accounts a count's difference may be booked to (ADR-0176 #7). */
@ApiTags('finance')
@Controller('finance/stock-count-accounts')
export class StockCountAccountsController {
  constructor(private readonly accounts: StockCountAccountsService) {}

  @Get()
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: [StockCountAccountDto] })
  list(): Promise<StockCountAccountDto[]> {
    return this.accounts.list();
  }

  @Put(':accountId')
  @RequirePermission('finance.settings.manage')
  @ApiOkResponse({ type: [StockCountAccountDto] })
  add(
    @CurrentUser() ctx: AuthContext,
    @Param('accountId', ParseIntPipe) accountId: number,
  ): Promise<StockCountAccountDto[]> {
    return this.accounts.add(ctx, accountId);
  }

  @Delete(':accountId')
  @RequirePermission('finance.settings.manage')
  @ApiOkResponse({ type: [StockCountAccountDto] })
  remove(
    @CurrentUser() ctx: AuthContext,
    @Param('accountId', ParseIntPipe) accountId: number,
  ): Promise<StockCountAccountDto[]> {
    return this.accounts.remove(ctx, accountId);
  }
}
