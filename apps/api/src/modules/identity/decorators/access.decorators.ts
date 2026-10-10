import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Permission } from '@tugeel/shared/auth';
import type { AuthContext } from '../auth-context';

export const AUTHENTICATED_KEY = 'tugeel:authenticated';
export const PERMISSIONS_KEY = 'tugeel:permissions';

/** Any logged-in staff member may call the route (ADR-0027 #3). */
export const Authenticated = () =>
  applyDecorators(SetMetadata(AUTHENTICATED_KEY, true), ApiBearerAuth());

/** Logged in and holding every listed permission; otherwise 403 FORBIDDEN (ADR-0027 #3). */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  applyDecorators(SetMetadata(PERMISSIONS_KEY, permissions), ApiBearerAuth());

export interface AuthenticatedRequest {
  auth?: AuthContext;
}

/** The AuthContext the guard resolved for this request; pass it on to services explicitly. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new Error('@CurrentUser() needs @Authenticated() or @RequirePermission() on the route');
    }
    return request.auth;
  },
);
