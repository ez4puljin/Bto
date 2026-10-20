import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Decimal } from '@tugeel/shared/money';
import {
  type AuthContext,
  CurrentUser,
  IdempotencyKey,
  Idempotent,
  RequirePermission,
} from '../../identity';
import {
  AccountLedgerPageDto,
  CashBookPageDto,
  DateRangeQueryDto,
  GlAccountDto,
  GlAccountPatchDto,
  GlAccountRequestDto,
  GlAccountRoleRequestDto,
  JournalEntryDetailDto,
  JournalEntryRequestDto,
  JournalListQueryDto,
  JournalPageDto,
  JournalReverseRequestDto,
  MoneyAccountDto,
  MoneyAccountPatchDto,
  MoneyAccountRequestDto,
} from '../dto/finance.dto';
import { type GlAccount, GlAccountsService } from '../services/gl-accounts.service';
import { JournalService } from '../services/journal.service';
import { MoneyAccountsService } from '../services/money-accounts.service';
import { PaymentsService } from '../services/payments.service';
import {
  accountLedgerLineDto,
  glAccountDto,
  journalEntryDetailDto,
  journalEntryDto,
  money,
  moneyAccountDto,
  paymentDto,
} from './mappers';

const READ = 'finance.read';
const JOURNAL = 'finance.journal.manage';
const SETTINGS = 'finance.settings.manage';

const zero = new Decimal(0);
const withoutBalances = (account: GlAccount) => ({
  ...account,
  debit: zero,
  credit: zero,
  balance: zero,
});

/** The chart of accounts (ADR-0060 #7) with the balances of the journal. */
@ApiTags('finance')
@Controller('gl-accounts')
export class GlAccountsController {
  constructor(
    private readonly accounts: GlAccountsService,
    private readonly journal: JournalService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [GlAccountDto] })
  async list(): Promise<GlAccountDto[]> {
    return (await this.accounts.listWithBalances()).map(glAccountDto);
  }

  @Post()
  @RequirePermission(JOURNAL)
  @ApiCreatedResponse({ type: GlAccountDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: GlAccountRequestDto,
  ): Promise<GlAccountDto> {
    return glAccountDto(withoutBalances(await this.accounts.create(ctx, body)));
  }

  @Put(':id')
  @RequirePermission(JOURNAL)
  @ApiOkResponse({ type: GlAccountDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: GlAccountPatchDto,
  ): Promise<GlAccountDto> {
    return glAccountDto(withoutBalances(await this.accounts.update(ctx, id, body)));
  }

  /** Which account the automatic entries hit (`finance.settings.manage`). */
  @Put(':id/role')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: GlAccountDto })
  async setRole(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: GlAccountRoleRequestDto,
  ): Promise<GlAccountDto> {
    return glAccountDto(withoutBalances(await this.accounts.setRole(ctx, id, body.role ?? null)));
  }

  @Get(':id/ledger')
  @RequirePermission(READ)
  @ApiOkResponse({ type: AccountLedgerPageDto })
  async ledger(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DateRangeQueryDto,
  ): Promise<AccountLedgerPageDto> {
    const page = await this.journal.accountLedger(id, query);
    return {
      data: page.data.map(accountLedgerLineDto),
      nextCursor: page.nextCursor,
      opening: money(page.opening),
    };
  }
}

/** The cash boxes and bank accounts (ADR-0060 #5) and their books. */
@ApiTags('finance')
@Controller('money-accounts')
export class MoneyAccountsController {
  constructor(
    private readonly accounts: MoneyAccountsService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: [MoneyAccountDto] })
  async list(): Promise<MoneyAccountDto[]> {
    return (await this.accounts.list()).map(moneyAccountDto);
  }

  @Post()
  @RequirePermission(SETTINGS)
  @ApiCreatedResponse({ type: MoneyAccountDto })
  async create(
    @CurrentUser() ctx: AuthContext,
    @Body() body: MoneyAccountRequestDto,
  ): Promise<MoneyAccountDto> {
    return moneyAccountDto(
      await this.accounts.create(ctx, {
        code: body.code,
        name: body.name,
        kind: body.kind,
        branchId: body.branchId ?? null,
        bankName: body.bankName ?? null,
        bankAccountNo: body.bankAccountNo ?? null,
        glAccountId: body.glAccountId,
        showToCustomers: body.showToCustomers ?? false,
      }),
    );
  }

  @Put(':id')
  @RequirePermission(SETTINGS)
  @ApiOkResponse({ type: MoneyAccountDto })
  async update(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MoneyAccountPatchDto,
  ): Promise<MoneyAccountDto> {
    return moneyAccountDto(await this.accounts.update(ctx, id, body));
  }

  /** The account's book: posted vouchers newest first with the balance after each. */
  @Get(':id/book')
  @RequirePermission(READ)
  @ApiOkResponse({ type: CashBookPageDto })
  async book(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DateRangeQueryDto,
  ): Promise<CashBookPageDto> {
    const page = await this.payments.book(id, query);
    return {
      data: page.data.map((row) => ({ ...paymentDto(row), balanceAfter: money(row.balanceAfter) })),
      nextCursor: page.nextCursor,
      opening: money(page.opening),
    };
  }
}

/** The general journal (ADR-0060 #7): the entries, a manual one, a reversal by hand. */
@ApiTags('finance')
@Controller('journal-entries')
export class JournalController {
  constructor(private readonly journal: JournalService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: JournalPageDto })
  async list(@Query() query: JournalListQueryDto): Promise<JournalPageDto> {
    const page = await this.journal.list(query);
    return { data: page.data.map(journalEntryDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequirePermission(READ)
  @ApiOkResponse({ type: JournalEntryDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<JournalEntryDetailDto> {
    return journalEntryDetailDto(await this.journal.get(id));
  }

  @Post()
  @RequirePermission(JOURNAL)
  @Idempotent()
  @ApiCreatedResponse({ type: JournalEntryDetailDto })
  async post(
    @CurrentUser() ctx: AuthContext,
    @Body() body: JournalEntryRequestDto,
    @IdempotencyKey() key?: string,
  ): Promise<JournalEntryDetailDto> {
    return journalEntryDetailDto(
      await this.journal.postManual(
        ctx,
        {
          entryDate: body.entryDate,
          description: body.description,
          lines: body.lines.map((line) => ({
            accountId: line.accountId,
            debit: new Decimal(line.debit ?? '0'),
            credit: new Decimal(line.credit ?? '0'),
            customerId: line.customerId ?? null,
            moneyAccountId: line.moneyAccountId ?? null,
            description: line.description ?? null,
          })),
        },
        key ?? null,
      ),
    );
  }

  @Post(':id/reverse')
  @HttpCode(200)
  @RequirePermission(JOURNAL)
  @Idempotent()
  @ApiOkResponse({ type: JournalEntryDetailDto })
  async reverse(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: JournalReverseRequestDto,
  ): Promise<JournalEntryDetailDto> {
    return journalEntryDetailDto(await this.journal.reverseManual(ctx, id, body));
  }
}
