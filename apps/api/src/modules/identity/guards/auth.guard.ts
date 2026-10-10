import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Permission } from '@tugeel/shared/auth';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { AppError } from '../../../common/errors/app-error';
import {
  AUTHENTICATED_KEY,
  type AuthenticatedRequest,
  PERMISSIONS_KEY,
} from '../decorators/access.decorators';
import { AccessService } from '../services/access.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Claims {
  userId: number;
  sessionId: string;
}

export function requestIdOf(request: { id?: unknown }): string | undefined {
  return typeof request.id === 'string' ? request.id : undefined;
}

/**
 * The single global guard (ADR-0027 #1–#3): public routes pass; every other route needs a valid
 * access token for a live session, plus the permissions it declares. A route that declares no
 * access rule at all is refused (fail closed).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('AuthGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, targets)) return true;
    const request = context.switchToHttp().getRequest<Request & AuthenticatedRequest>();
    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    const authenticated = this.reflector.getAllAndOverride<boolean | undefined>(
      AUTHENTICATED_KEY,
      targets,
    );
    if (!required && !authenticated) {
      this.logger.warn({ route: request.originalUrl }, 'route declares no access rule');
      throw new AppError('FORBIDDEN', 'route declares no access rule', {
        reason: 'NO_ACCESS_RULE',
      });
    }
    const claims = await this.verify(request.headers.authorization);
    const ctx = await this.access.resolve(claims.userId, claims.sessionId, requestIdOf(request));
    if (!ctx) throw new AppError('UNAUTHORIZED', 'session is not active', { reason: 'SESSION' });
    const missing = (required ?? []).find((permission) => !ctx.permissions.has(permission));
    if (missing) {
      throw new AppError('FORBIDDEN', `missing permission ${missing}`, {
        reason: 'PERMISSION',
        permission: missing,
      });
    }
    request.auth = ctx;
    return true;
  }

  private async verify(header: string | undefined): Promise<Claims> {
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!token) throw new AppError('UNAUTHORIZED', 'missing bearer token', { reason: 'TOKEN' });
    let payload: { sub?: unknown; sid?: unknown; kind?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new AppError('UNAUTHORIZED', 'invalid or expired access token', { reason: 'TOKEN' });
    }
    const { sub, sid, kind } = payload;
    if (
      typeof sub !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(sub) ||
      typeof sid !== 'string' ||
      !UUID.test(sid) ||
      kind !== 'STAFF'
    ) {
      throw new AppError('UNAUTHORIZED', 'malformed access token', { reason: 'TOKEN' });
    }
    return { userId: Number.parseInt(sub, 10), sessionId: sid };
  }
}
