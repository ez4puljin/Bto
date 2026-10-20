import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../identity';
import {
  DateRangeQueryDto,
  PayableOpenItemListDto,
  SupplierBalanceDto,
  SupplierBalancesPageDto,
  SupplierBalancesQueryDto,
  SupplierLedgerPageDto,
} from '../dto/finance.dto';
import { ApLedgerService, type SupplierBalanceRow } from '../services/ap-ledger.service';
import { iso, isoOrNull, money } from './mappers';

const READ = 'finance.read';

const supplierBalanceDto = (row: SupplierBalanceRow): SupplierBalanceDto => ({
  ...row,
  balance: money(row.balance),
  updatedAt: isoOrNull(row.updatedAt),
});

/**
 * The suppliers' payables (F3, ADR-0091): balances, each supplier's ledger and its open items for
 * the accountant's allocation («Санхүү → Нийлүүлэгчийн тооцоо»).
 */
@ApiTags('finance')
@Controller('supplier-balances')
export class SupplierBalancesController {
  constructor(private readonly ledger: ApLedgerService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: SupplierBalancesPageDto })
  async list(@Query() query: SupplierBalancesQueryDto): Promise<SupplierBalancesPageDto> {
    const page = await this.ledger.balances(query);
    return { data: page.data.map(supplierBalanceDto), nextCursor: page.nextCursor };
  }

  @Get(':supplierId')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SupplierBalanceDto })
  async get(@Param('supplierId', ParseIntPipe) supplierId: number): Promise<SupplierBalanceDto> {
    return supplierBalanceDto(await this.ledger.rowOf(supplierId));
  }

  @Get(':supplierId/ledger')
  @RequirePermission(READ)
  @ApiOkResponse({ type: SupplierLedgerPageDto })
  async entries(
    @Param('supplierId', ParseIntPipe) supplierId: number,
    @Query() query: DateRangeQueryDto,
  ): Promise<SupplierLedgerPageDto> {
    const page = await this.ledger.ledger(supplierId, query);
    return {
      data: page.data.map((entry) => ({
        ...entry,
        debit: money(entry.debit),
        credit: money(entry.credit),
        balanceAfter: money(entry.balanceAfter),
        createdAt: iso(entry.createdAt),
      })),
      nextCursor: page.nextCursor,
      opening: money(page.opening),
    };
  }

  @Get(':supplierId/open-items')
  @RequirePermission(READ)
  @ApiOkResponse({ type: PayableOpenItemListDto })
  async openItems(
    @Param('supplierId', ParseIntPipe) supplierId: number,
  ): Promise<PayableOpenItemListDto> {
    const items = await this.ledger.openItems(supplierId);
    return {
      data: items.map((item) => ({
        ...item,
        amount: money(item.amount),
        openAmount: money(item.openAmount),
      })),
    };
  }
}
