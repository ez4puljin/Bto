import type { Request } from 'express';
import type { AccessTokenDto, LoginResponseDto, MeDto } from '../dto/auth.dto';
import { requestIdOf } from '../guards/auth.guard';
import type { AccessService, ResolvedAccess } from '../services/access.service';
import type { ClientInfo, IssuedSession } from '../services/auth.service';

/** What the session rows keep of the caller: address, browser or app, the request id. */
export function clientOf(request: Request): ClientInfo {
  const requestId = requestIdOf(request);
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip ?? null,
    userAgent: typeof userAgent === 'string' && userAgent ? userAgent.slice(0, 300) : null,
    ...(requestId ? { requestId } : {}),
  };
}

export function toAccessToken(issued: IssuedSession): AccessTokenDto {
  return {
    accessToken: issued.accessToken,
    accessTokenExpiresAt: issued.accessTokenExpiresAt.toISOString(),
    sessionExpiresAt: issued.sessionExpiresAt.toISOString(),
  };
}

/** The caller's profile and when their session started and ends (the rep app shows both). */
export async function toMe(access: AccessService, ctx: ResolvedAccess): Promise<MeDto> {
  return {
    id: ctx.userId,
    username: ctx.username,
    fullName: ctx.fullName,
    permissions: [...ctx.permissions].sort(),
    roles: await access.roleRefs(ctx.roleIds),
    writableWarehouseIds:
      ctx.writableWarehouseIds === null
        ? null
        : [...ctx.writableWarehouseIds].sort((a, b) => a - b),
    sessionStartedAt: ctx.sessionStartedAt.toISOString(),
    sessionExpiresAt: ctx.sessionExpiresAt.toISOString(),
  };
}

/** The tokens of a new session with the caller's profile (login and code redemption). */
export async function loginResponseOf(
  access: AccessService,
  issued: IssuedSession,
  requestId?: string,
): Promise<LoginResponseDto> {
  const resolved = await access.resolve(issued.userId, issued.sessionId, requestId);
  if (!resolved) throw new Error('a session issued a moment ago is not active');
  return { ...toAccessToken(issued), me: await toMe(access, resolved) };
}
