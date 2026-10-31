import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthContext } from '../auth-context';
import { Authenticated, CurrentUser, RequirePermission } from '../decorators/access.decorators';
import { UserNamesService } from '../services/user-names.service';
import {
  CreateUserDto,
  PasswordCodeDto,
  type SessionDto,
  SessionListDto,
  UpdateUserDto,
  UserDetailDto,
  UserListQueryDto,
  UserLookupDto,
  UserLookupQueryDto,
  UserPageDto,
  type UserSummaryDto,
} from '../dto/users.dto';
import {
  type SessionView,
  type UserDetail,
  type UserSummary,
  UsersService,
} from '../services/users.service';

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

function toSummaryDto(user: UserSummary): UserSummaryDto {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    phone: user.phone,
    status: user.status,
    roleIds: user.roleIds,
    lastLoginAt: iso(user.lastLoginAt),
    lockedUntil: iso(user.lockedUntil),
  };
}

function toDetailDto(user: UserDetail): UserDetailDto {
  return {
    ...toSummaryDto(user),
    passwordSet: user.passwordSet,
    failedLoginCount: user.failedLoginCount,
    scopes: user.scopes,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

function toSessionDto(session: SessionView): SessionDto {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    userAgent: session.userAgent,
    ip: session.ip,
  };
}

/** Staff accounts (SPEC §5.1). Reading needs identity.users.read; changes are ADMIN-only. */
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly names: UserNamesService,
  ) {}

  /** Active staff by name for pickers (a goods issue's recipient, ADR-0081): id and name only. */
  @Get('lookup')
  @Authenticated()
  @ApiOkResponse({ type: [UserLookupDto] })
  lookup(@Query() query: UserLookupQueryDto): Promise<UserLookupDto[]> {
    return this.names.search(query.q ?? '');
  }

  @Get()
  @RequirePermission('identity.users.read')
  @ApiOkResponse({ type: UserPageDto })
  async list(@Query() query: UserListQueryDto): Promise<UserPageDto> {
    const page = await this.users.list(query);
    return { data: page.data.map(toSummaryDto), nextCursor: page.nextCursor };
  }

  @Get(':id')
  @RequirePermission('identity.users.read')
  @ApiOkResponse({ type: UserDetailDto })
  async get(@Param('id', ParseIntPipe) id: number): Promise<UserDetailDto> {
    return toDetailDto(await this.users.get(id));
  }

  @Post()
  @RequirePermission('identity.users.manage')
  @ApiCreatedResponse({ type: UserDetailDto })
  async create(
    @CurrentUser() actor: AuthContext,
    @Body() body: CreateUserDto,
  ): Promise<UserDetailDto> {
    return toDetailDto(await this.users.create(actor, body));
  }

  @Patch(':id')
  @RequirePermission('identity.users.manage')
  @ApiOkResponse({ type: UserDetailDto })
  async update(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUserDto,
  ): Promise<UserDetailDto> {
    return toDetailDto(await this.users.update(actor, id, body));
  }

  @Post(':id/password-code')
  @RequirePermission('identity.users.manage')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ type: PasswordCodeDto })
  async issuePasswordCode(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<PasswordCodeDto> {
    const issued = await this.users.issuePasswordCode(actor, id);
    return { code: issued.code, expiresAt: issued.expiresAt.toISOString() };
  }

  @Post(':id/unlock')
  @RequirePermission('identity.users.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  async unlock(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.users.unlock(actor, id);
  }

  @Get(':id/sessions')
  @RequirePermission('identity.users.manage')
  @ApiOkResponse({ type: SessionListDto })
  async sessions(@Param('id', ParseIntPipe) id: number): Promise<SessionListDto> {
    return { data: (await this.users.sessions(id)).map(toSessionDto), nextCursor: null };
  }

  @Delete(':id/sessions/:sessionId')
  @RequirePermission('identity.users.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  async revokeSession(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ): Promise<void> {
    await this.users.revokeSessions(actor, id, sessionId);
  }

  @Delete(':id/sessions')
  @RequirePermission('identity.users.manage')
  @HttpCode(204)
  @ApiNoContentResponse()
  async revokeSessions(
    @CurrentUser() actor: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.users.revokeSessions(actor, id);
  }
}
