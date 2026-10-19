import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Permission } from '@tugeel/shared/auth';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { AppError } from '../../../common/errors/app-error';
import { JWT_AUDIENCE, JWT_CUSTOMER_AUDIENCE } from '../auth.constants';
import {
  AUTHENTICATED_KEY,
  type AuthenticatedRequest,
  CUSTOMER_ROUTE_KEY,
  PERMISSIONS_KEY,
} from '../decorators/access.decorators';
import { AccessService } from '../services/access.service';
import { CustomerAccessService } from '../services/customer-access.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Claims {
  kind: 'STAFF' | 'CUSTOMER';
  /** users.id of a STAFF token, customer_users.id of a CUSTOMER token. */
  id: number;
  sessionId: string;
}

export function requestIdOf(request: { id?: unknown }): string | undefined {
  return typeof request.id === 'string' ? request.id : undefined;
}

/** A token's audience the way jsonwebtoken leaves it: a string or a list of them. */
function hasAudience(aud: unknown, expected: string): boolean {
  return aud === expected || (Array.isArray(aud) && aud.length === 1 && aud[0] === expected);
}

/**
 * The single global guard (ADR-0027 #1–#3, ADR-0079 #3): public routes pass; a customer route
 * needs a customer token for a live session of an active account; every other route needs a staff
 * token for a live session plus the permissions it declares. A token of the other kind is refused
 * with 403 (never 401, so a client does not refresh in a loop). A route that declares no access
 * rule, or both kinds of rule, is refused (fail closed).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger('AuthGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly access: AccessService,
    private readonly customers: CustomerAccessService,
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
    const customerRoute = this.reflector.getAllAndOverride<boolean | undefined>(
      CUSTOMER_ROUTE_KEY,
      targets,
    );
    const staffRoute = Boolean(required) || Boolean(authenticated);
    if (staffRoute === Boolean(customerRoute)) {
      this.logger.warn({ route: request.originalUrl }, 'route declares no single access rule');
      throw new AppError('FORBIDDEN', 'route declares no single access rule', {
        reason: 'NO_ACCESS_RULE',
      });
    }
    const claims = await this.verify(request.headers.authorization);
    if (customerRoute) {
      if (claims.kind !== 'CUSTOMER') {
        throw new AppError('FORBIDDEN', 'a staff token on a customer route', {
          reason: 'STAFF_TOKEN',
        });
      }
      const customer = await this.customers.resolve(
        claims.id,
        claims.sessionId,
        requestIdOf(request),
      );
      if (!customer)
        throw new AppError('UNAUTHORIZED', 'session is not active', { reason: 'SESSION' });
      request.customer = customer;
      return true;
    }
    if (claims.kind !== 'STAFF') {
      throw new AppError('FORBIDDEN', 'a customer token on a staff route', {
        reason: 'CUSTOMER_TOKEN',
      });
    }
    const ctx = await this.access.resolve(claims.id, claims.sessionId, requestIdOf(request));
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
    let payload: { sub?: unknown; sid?: unknown; kind?: unknown; aud?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw new AppError('UNAUTHORIZED', 'invalid or expired access token', { reason: 'TOKEN' });
    }
    const { sub, sid, kind, aud } = payload;
    const kindOk =
      (kind === 'STAFF' && hasAudience(aud, JWT_AUDIENCE)) ||
      (kind === 'CUSTOMER' && hasAudience(aud, JWT_CUSTOMER_AUDIENCE));
    if (
      typeof sub !== 'string' ||
      !/^[1-9][0-9]{0,15}$/.test(sub) ||
      typeof sid !== 'string' ||
      !UUID.test(sid) ||
      !kindOk
    ) {
      throw new AppError('UNAUTHORIZED', 'malformed access token', { reason: 'TOKEN' });
    }
    return {
      kind: kind === 'CUSTOMER' ? 'CUSTOMER' : 'STAFF',
      id: Number.parseInt(sub, 10),
      sessionId: sid,
    };
  }
}
