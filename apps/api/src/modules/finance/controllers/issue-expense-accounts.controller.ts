import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { type AuthContext, CurrentUser, RequirePermission } from '../../identity';
import { IssueExpenseAccountDto, IssueExpenseAccountRequestDto } from '../dto/finance.dto';
import { IssueExpenseAccountsService } from '../services/issue-expense-accounts.service';

/** Which account each goods-issue expense type books to (ADR-0106 #3). */
@ApiTags('finance')
@Controller('finance/issue-expense-accounts')
export class IssueExpenseAccountsController {
  constructor(private readonly accounts: IssueExpenseAccountsService) {}

  @Get()
  @RequirePermission('finance.read')
  @ApiOkResponse({ type: [IssueExpenseAccountDto] })
  list(): Promise<IssueExpenseAccountDto[]> {
    return this.accounts.list();
  }

  /** An admin-added type's own account from today; null sends it back to «бусад». */
  @Put(':typeId')
  @RequirePermission('finance.settings.manage')
  @ApiOkResponse({ type: [IssueExpenseAccountDto] })
  set(
    @CurrentUser() ctx: AuthContext,
    @Param('typeId', ParseIntPipe) typeId: number,
    @Body() body: IssueExpenseAccountRequestDto,
  ): Promise<IssueExpenseAccountDto[]> {
    return this.accounts.setAccount(ctx, typeId, body.accountId ?? null);
  }
}
