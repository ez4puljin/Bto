import { Body, Controller, Get, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { Decimal } from '@tugeel/shared/money';
import {
  CustomerBalanceDto,
  CustomerBalancesPageDto,
  CustomerBalancesQueryDto,
  CustomerCounterAccountDto,
  CustomerCounterAccountRequestDto,
  CustomerLedgerPageDto,
  CustomerStatementTotalsDto,
  CustomerStatementTotalsQueryDto,
  CustomerVatTotalsDto,
  CustomerVatTotalsQueryDto,
  DateRangeQueryDto,
  FinanceAttentionDto,
  FinanceNumberingDto,
  FinanceNumberingRequestDto,
  type VatTotalsSideDto,
  VatWaiverSettingsDto,
  VatWaiverSettingsRequestDto,
} from '../dto/finance.dto';
import { ArLedgerService } from '../services/ar-ledger.service';
import {
  type CustomerCounterAccount,
  CustomerCounterAccountsService,
} from '../services/customer-counter-accounts.service';
import {
  type FinanceNumbering,
  FinanceSettingsService,
  type VatWaiverSettings,
} from '../services/finance-settings.service';
import { type VatTotalsSide, VatWaiversService } from '../services/vat-waivers.service';
import { customerBalanceDto, ledgerEntryDto, money } from './mappers';

const READ = 'finance.read';
const SETTINGS = 'finance.settings.manage';

/** The receivables by customer (ADR-0060 #4): balances, aging and each customer's ledger. */
@ApiTags('finance')
@Controller('customer-balances')
export class CustomerBalancesController {
  constructor(
    private readonly ledger: ArLedgerService,
    private readonly waivers: VatWaiversService,
    private readonly counterAccounts: CustomerCounterAccountsService,
  ) {}

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

  /** «Эхний үлдэгдэл», «Дебит», «Кредит», «Эцсийн үлдэгдэл» of a range (ADR-0216). */
  @Get(':customerId/statement-totals')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerStatementTotalsDto })
  async statementTotals(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: CustomerStatementTotalsQueryDto,
  ): Promise<CustomerStatementTotalsDto> {
    const totals = await this.ledger.statementTotals(customerId, query.from, query.to);
    return {
      from: totals.from,
      to: totals.to,
      opening: money(totals.opening),
      totalDebit: money(totals.totalDebit),
      totalCredit: money(totals.totalCredit),
      closing: money(totals.closing),
    };
  }

  /**
   * «НӨАТ авах» / «НӨАТ авахгүй» (ADR-0240): the customer's issued invoices of a date range, split
   * by whether their VAT receipt is waived.
   */
  @Get(':customerId/vat-totals')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerVatTotalsDto })
  async vatTotals(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: CustomerVatTotalsQueryDto,
  ): Promise<CustomerVatTotalsDto> {
    const totals = await this.waivers.totalsOf(customerId, query);
    return {
      customerId: totals.customerId,
      from: totals.from,
      to: totals.to,
      takesVat: vatSideDto(totals.takesVat),
      waived: vatSideDto(totals.waived),
    };
  }

  /** «Харилцсан данс» (ADR-0240 #4): what a VAT waiver of this customer debits. */
  @Get(':customerId/counter-account')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerCounterAccountDto })
  async counterAccount(
    @Param('customerId', ParseIntPipe) customerId: number,
  ): Promise<CustomerCounterAccountDto> {
    return counterAccountDto(await this.counterAccounts.get(customerId));
  }

  @Put(':customerId/counter-account')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: CustomerCounterAccountDto })
  async setCounterAccount(
    @CurrentUser() ctx: AuthContext,
    @Param('customerId', ParseIntPipe) customerId: number,
    @Body() body: CustomerCounterAccountRequestDto,
  ): Promise<CustomerCounterAccountDto> {
    return counterAccountDto(await this.counterAccounts.set(ctx, customerId, body.accountId));
  }
}

const vatSideDto = (side: VatTotalsSide): VatTotalsSideDto => ({
  count: side.count,
  total: money(side.total),
  vatTotal: money(side.vatTotal),
  openAmount: money(side.openAmount),
  waiverAmount: money(side.waiverAmount),
});

const counterAccountDto = (row: CustomerCounterAccount): CustomerCounterAccountDto => ({
  customerId: row.customerId,
  own: row.own,
  account: row.account,
  updatedAt: row.updatedAt?.toISOString() ?? null,
});

const vatWaiverSettingsDto = (settings: VatWaiverSettings): VatWaiverSettingsDto => ({
  pct: settings.pct.toFixed(2),
  description: settings.description,
  updatedAt: settings.updatedAt?.toISOString() ?? null,
});

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

  /** «НӨАТ хасуулах» (ADR-0240 #1): the percent a waiver takes and the words of its entry. */
  @Get('vat-waiver')
  @RequirePermission(READ)
  @ApiOkResponse({ type: VatWaiverSettingsDto })
  async vatWaiver(): Promise<VatWaiverSettingsDto> {
    return vatWaiverSettingsDto(await this.settings.vatWaiver());
  }

  @Put('vat-waiver')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: VatWaiverSettingsDto })
  async setVatWaiver(
    @CurrentUser() ctx: AuthContext,
    @Body() body: VatWaiverSettingsRequestDto,
  ): Promise<VatWaiverSettingsDto> {
    return vatWaiverSettingsDto(
      await this.settings.setVatWaiver(ctx, {
        pct: new Decimal(body.pct),
        description: body.description,
      }),
    );
  }
}
