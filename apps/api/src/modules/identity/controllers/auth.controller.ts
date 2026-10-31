import { Body, Controller, Get, Header, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/auth/public.decorator';
import { AppConfig } from '../../../common/config/app-config';
import { AppError } from '../../../common/errors/app-error';
import { REFRESH_COOKIE, REFRESH_COOKIE_PATH } from '../auth.constants';
import type { AuthContext } from '../auth-context';
import { Authenticated, CurrentUser } from '../decorators/access.decorators';
import {
  AccessTokenDto,
  LoginDto,
  loginOf,
  LoginResponseDto,
  MeDto,
  PasswordChangeDto,
  PasswordSetupDto,
} from '../dto/auth.dto';
import { requestIdOf } from '../guards/auth.guard';
import { AccessService } from '../services/access.service';
import { AuthService, type IssuedSession } from '../services/auth.service';
import { clientOf, loginResponseOf, toAccessToken, toMe } from './auth-responses';

/** The value of one cookie from the raw header; the refresh cookie needs no full parser. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** Cookie-authenticated routes accept only requests whose Origin matches the Host (CSRF). */
function assertSameOrigin(request: Request): void {
  const origin = request.headers.origin;
  const host = request.headers.host;
  let originHost: string | undefined;
  try {
    originHost = origin ? new URL(origin).host : undefined;
  } catch {
    originHost = undefined;
  }
  if (!host || originHost !== host) {
    throw new AppError('FORBIDDEN', 'cross-origin request to a cookie route', { reason: 'ORIGIN' });
  }
}

/** Login, refresh, logout and passwords (ADR-0027). Every response is `Cache-Control: no-store`. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessService,
    private readonly config: AppConfig,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: LoginResponseDto })
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const issued = await this.auth.login(
      { login: loginOf(body), password: body.password },
      clientOf(request),
    );
    this.setRefreshCookie(response, issued);
    return loginResponseOf(this.access, issued, requestIdOf(request));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: AccessTokenDto })
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AccessTokenDto> {
    assertSameOrigin(request);
    try {
      const issued = await this.auth.refresh(
        readCookie(request.headers.cookie, REFRESH_COOKIE),
        clientOf(request),
      );
      this.setRefreshCookie(response, issued);
      return toAccessToken(issued);
    } catch (error) {
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    assertSameOrigin(request);
    await this.auth.logout(readCookie(request.headers.cookie, REFRESH_COOKIE), clientOf(request));
    this.clearRefreshCookie(response);
  }

  @Authenticated()
  @Post('logout-all')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse()
  async logoutAll(
    @CurrentUser() user: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user);
    this.clearRefreshCookie(response);
  }

  @Authenticated()
  @Get('me')
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: MeDto })
  async me(@CurrentUser() user: AuthContext, @Req() request: Request): Promise<MeDto> {
    const resolved = await this.access.resolve(user.userId, user.sessionId, requestIdOf(request));
    if (!resolved) throw new AppError('UNAUTHORIZED', 'session is not active');
    return toMe(this.access, resolved);
  }

  @Authenticated()
  @Post('password')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  @ApiNoContentResponse()
  async changePassword(
    @CurrentUser() user: AuthContext,
    @Body() body: PasswordChangeDto,
    @Req() request: Request,
  ): Promise<void> {
    await this.auth.changePassword(user, body, clientOf(request));
  }

  @Public()
  @Post('password/setup')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: LoginResponseDto })
  async setupPassword(
    @Body() body: PasswordSetupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponseDto> {
    const issued = await this.auth.setupPassword(
      { login: loginOf(body), code: body.code, newPassword: body.newPassword },
      clientOf(request),
    );
    this.setRefreshCookie(response, issued);
    return loginResponseOf(this.access, issued, requestIdOf(request));
  }

  private setRefreshCookie(response: Response, issued: IssuedSession): void {
    if (!issued.refreshCookie) return;
    response.cookie(REFRESH_COOKIE, issued.refreshCookie, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('COOKIE_SECURE'),
      path: REFRESH_COOKIE_PATH,
      maxAge: Math.max(0, issued.sessionExpiresAt.getTime() - Date.now()),
    });
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.get('COOKIE_SECURE'),
      path: REFRESH_COOKIE_PATH,
    });
  }
}
