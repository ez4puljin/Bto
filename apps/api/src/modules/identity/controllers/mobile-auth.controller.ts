import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { LoginDto } from '../dto/auth.dto';
import {
  MobileLoginResponseDto,
  MobileTokenRequestDto,
  MobileTokensDto,
} from '../dto/mobile-auth.dto';
import { requestIdOf } from '../guards/auth.guard';
import { AccessService } from '../services/access.service';
import { AuthService } from '../services/auth.service';
import { clientOf, loginResponseOf, toAccessToken } from './auth-responses';
import { assertNativeClient } from './native-client';

/**
 * Login, refresh and logout for the staff app (ADR-0061 #4): the refresh token travels in the JSON
 * body and the app keeps it in secure storage. Rotation, the 20-second grace window and reuse
 * revocation are those of the cookie routes (ADR-0027 #8).
 */
@ApiTags('auth')
@Controller('auth/mobile')
export class MobileAuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: MobileLoginResponseDto })
  async login(@Body() body: LoginDto, @Req() request: Request): Promise<MobileLoginResponseDto> {
    assertNativeClient(request);
    const issued = await this.auth.login(body, clientOf(request));
    if (!issued.refreshCookie) throw new Error('a login issued no refresh token');
    return {
      ...(await loginResponseOf(this.access, issued, requestIdOf(request))),
      refreshToken: issued.refreshCookie,
    };
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
    return { ...toAccessToken(issued), refreshToken: issued.refreshCookie ?? null };
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
}
