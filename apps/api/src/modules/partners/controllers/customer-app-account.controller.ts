import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  type AuthContext,
  type CustomerAccountView,
  CurrentUser,
  RequirePermission,
} from '../../identity';
import {
  CustomerAppAccountDto,
  CustomerAppAccountStateDto,
  CustomerAppCodeDto,
  CustomerAppLinkDto,
} from '../dto/customer-app.dto';
import { CustomerAppAccountsService } from '../services/customer-app-accounts.service';

const READ = 'partners.customers.read';
const MANAGE = 'partners.customer_app.manage';

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

function toAccountDto(view: CustomerAccountView): CustomerAppAccountDto {
  return {
    id: view.id,
    phone: view.phone,
    status: view.status,
    passwordSet: view.passwordSet,
    lastSignInAt: iso(view.lastSignInAt),
    lockedUntil: iso(view.lockedUntil),
    codeExpiresAt: iso(view.codeExpiresAt),
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

/**
 * The «Апп» card of a customer (ADR-0079 #11): link the store's phone, read it a one-time code,
 * close or reopen the app. Only the office does this (`partners.customer_app.manage`); there is no
 * self sign-up.
 */
@ApiTags('partners')
@Controller('customers/:id/app-account')
export class CustomerAppAccountController {
  constructor(private readonly accounts: CustomerAppAccountsService) {}

  @Get()
  @RequirePermission(READ)
  @ApiOkResponse({ type: CustomerAppAccountStateDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<CustomerAppAccountStateDto> {
    const account = await this.accounts.get(id);
    return { account: account ? toAccountDto(account) : null };
  }

  /** Links the phone, or changes it: the password is cleared and every session ends. */
  @Put()
  @RequirePermission(MANAGE)
  @ApiOkResponse({ type: CustomerAppAccountDto })
  async link(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CustomerAppLinkDto,
  ): Promise<CustomerAppAccountDto> {
    return toAccountDto(await this.accounts.link(ctx, id, body.phone));
  }

  /** «Код үүсгэх»: never @Idempotent, so the code is never stored for a replay. */
  @Post('code')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CustomerAppCodeDto })
  async issueCode(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppCodeDto> {
    const issued = await this.accounts.issueCode(ctx, id);
    return { code: issued.code, expiresAt: issued.expiresAt.toISOString() };
  }

  @Post('disable')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerAppAccountDto })
  async disable(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppAccountDto> {
    return toAccountDto(await this.accounts.setStatus(ctx, id, 'DISABLED'));
  }

  @Post('enable')
  @RequirePermission(MANAGE)
  @HttpCode(200)
  @ApiOkResponse({ type: CustomerAppAccountDto })
  async enable(
    @CurrentUser() ctx: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CustomerAppAccountDto> {
    return toAccountDto(await this.accounts.setStatus(ctx, id, 'ACTIVE'));
  }
}
