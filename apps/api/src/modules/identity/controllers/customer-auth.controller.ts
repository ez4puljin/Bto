import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import type { CustomerContext } from '../auth-context';
import { CurrentCustomer, CustomerRoute } from '../decorators/access.decorators';
import { PasswordChangeDto } from '../dto/auth.dto';
import {
  CustomerLoginDto,
  CustomerLoginResponseDto,
  CustomerPasswordSetupDto,
} from '../dto/customer-auth.dto';
import { MobileTokenRequestDto, MobileTokensDto } from '../dto/mobile-auth.dto';
import { CustomerAuthService, type IssuedCustomerSession } from '../services/customer-auth.service';
import { clientOf } from './auth-responses';
import { assertNativeClient } from './native-client';

function tokensOf(issued: IssuedCustomerSession) {
  return {
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    sessionExpiresAt: issued.sessionExpiresAt.toISOString(),
  };
}

function loginResponseOf(issued: IssuedCustomerSession): CustomerLoginResponseDto {
  if (!issued.refreshToken) throw new Error('a sign-in issued no refresh token');
  return {
    ...tokensOf(issued),
    refreshToken: issued.refreshToken,
    account: {
      id: issued.customerUserId,
      customerId: issued.customerId,
      phone: issued.phone,
      sessionStartedAt: issued.sessionStartedAt.toISOString(),
      sessionExpiresAt: issued.sessionExpiresAt.toISOString(),
    },
  };
}

/**
 * Sign-in for the customer app «Bto300» (ADR-0079 #3): native clients only (no `Origin`), the
 * refresh token in the JSON body like `/auth/mobile/*` (ADR-0061 #4), never a cookie. No SMS: a
 * new password always starts from the office's one-time code.
 */
@ApiTags('customer-auth')
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly auth: CustomerAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CustomerLoginResponseDto })
  async login(
    @Body() body: CustomerLoginDto,
    @Req() request: Request,
  ): Promise<CustomerLoginResponseDto> {
    assertNativeClient(request);
    return loginResponseOf(await this.auth.login(body, clientOf(request)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: MobileTokensDto })
  async refresh(
    @Body() body: MobileTokenRequestDto,
    @Req() request: Request,
  ): Promise<MobileTokensDto> {
    assertNativeClient(request);
    const issued = await this.auth.refresh(body.refreshToken, clientOf(request));
    return { ...tokensOf(issued), refreshToken: issued.refreshToken ?? null };
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse()
  async logout(@Body() body: MobileTokenRequestDto, @Req() request: Request): Promise<void> {
    assertNativeClient(request);
    await this.auth.logout(body.refreshToken, clientOf(request));
  }

  /** The phone, the office's code and a new password: sets it and signs in. */
  @Public()
  @Post('password/setup')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: CustomerLoginResponseDto })
  async setupPassword(
    @Body() body: CustomerPasswordSetupDto,
    @Req() request: Request,
  ): Promise<CustomerLoginResponseDto> {
    assertNativeClient(request);
    return loginResponseOf(await this.auth.setupPassword(body, clientOf(request)));
  }

  /** «Нууц үг солих»: ends the account's sessions on other phones. */
  @CustomerRoute()
  @Post('password')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse()
  async changePassword(
    @CurrentCustomer() ctx: CustomerContext,
    @Body() body: PasswordChangeDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.changePassword(ctx, body, clientOf(request));
  }
}
