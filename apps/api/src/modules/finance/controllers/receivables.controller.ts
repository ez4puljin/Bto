import { Body, Controller, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import {
  CustomerBalanceDto,
  CustomerBalancesPageDto,
  CustomerBalancesQueryDto,
  CustomerLedgerPageDto,
  DateRangeQueryDto,
  FinanceAttentionDto,
  FinanceNumberingDto,
  FinanceNumberingRequestDto,
} from '../dto/finance.dto';
import { ArLedgerService } from '../services/ar-ledger.service';
import {
  type FinanceNumbering,
  FinanceSettingsService,
} from '../services/finance-settings.service';
import { customerBalanceDto, ledgerEntryDto, money } from './mappers';

const READ = 'finance.read';
const SETTINGS = 'finance.settings.manage';

/** The receivables by customer (ADR-0060 #4): balances, aging and each customer's ledger. */
@ApiTags('finance')
@Controller('customer-balances')
export class CustomerBalancesController {
  constructor(private readonly ledger: ArLedgerService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerBalancesPageDto })
  async list(
    @CurrentUser() ctx: AuthContext,
    @Query() query: CustomerBalancesQueryDto,
  ): Promise<CustomerBalancesPageDto> {
    const page = await this.ledger.balances(ctx, query);
    return { data: page.data.map(customerBalanceDto), nextCursor: page.nextCursor };
  }

  @Get(':customerId')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerBalanceDto })
  async get(@Param('customerId', ParseIntPipe) customerId: number): Promise<CustomerBalanceDto> {
    return customerBalanceDto(await this.ledger.rowOf(customerId));
  }

  @Get(':customerId/ledger')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerLedgerPageDto })
  async entries(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: DateRangeQueryDto,
  ): Promise<CustomerLedgerPageDto> {
    const page = await this.ledger.ledger(customerId, query);
    return {
      data: page.data.map(ledgerEntryDto),
      nextCursor: page.nextCursor,
      opening: money(page.opening),
    };
  }
}

/** The home page's finance tile (ADR-0060 #11). */
@ApiTags('finance')
@Controller('finance')
export class FinanceAttentionController {
  constructor(private readonly ledger: ArLedgerService) {}

  @Get('attention')
  @RequirePermission(READ)
  @ApiOkResponse({ type: FinanceAttentionDto })
  async attention(): Promise<FinanceAttentionDto> {
    const attention = await this.ledger.attention();
    return {
      overdueAmount: money(attention.overdueAmount),
      overdueCustomers: attention.overdueCustomers,
      openAmount: money(attention.openAmount),
      openInvoices: attention.openInvoices,
    };
  }
}

const numberingDto = (numbering: FinanceNumbering): FinanceNumberingDto => ({
  INVOICE: numbering.INVOICE,
  PAYMENT: numbering.PAYMENT,
  CREDIT_NOTE: numbering.CREDIT_NOTE,
  JOURNAL: numbering.JOURNAL,
  updatedAt: numbering.updatedAt?.toISOString() ?? null,
});

/** The finance settings (ADR-0060 #8): the number formats. */
@ApiTags('finance')
@Controller('finance-settings')
export class FinanceSettingsController {
  constructor(private readonly settings: FinanceSettingsService) {}

  @Get('numbering')
  @RequirePermission(READ)
  @ApiOkResponse({ type: FinanceNumberingDto })
  async numbering(): Promise<FinanceNumberingDto> {
    return numberingDto(await this.settings.numbering());
  }

  @Put('numbering')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: FinanceNumberingDto })
  async setNumbering(
    @CurrentUser() ctx: AuthContext,
    @Body() body: FinanceNumberingRequestDto,
  ): Promise<FinanceNumberingDto> {
    return numberingDto(await this.settings.setNumbering(ctx, body));
  }
}
