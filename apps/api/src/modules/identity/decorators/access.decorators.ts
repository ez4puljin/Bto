import {
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import type { Permission } from '@tugeel/shared/auth';
import type { AuthContext, CustomerContext } from '../auth-context';

export const AUTHENTICATED_KEY = 'tugeel:authenticated';
export const PERMISSIONS_KEY = 'tugeel:permissions';
export const CUSTOMER_ROUTE_KEY = 'tugeel:customer-route';

/** The OpenAPI security scheme of the customer app's routes (ADR-0079 #3); staff use `bearer`. */
export const CUSTOMER_SECURITY = 'customer';

/** Any logged-in staff member may call the route (ADR-0027 #3). */
export const Authenticated = () =>
  applyDecorators(SetMetadata(AUTHENTICATED_KEY, true), ApiBearerAuth());

/** Logged in and holding every listed permission; otherwise 403 FORBIDDEN (ADR-0027 #3). */
export const RequirePermission = (...permissions: [Permission, ...Permission[]]) =>
  applyDecorators(SetMetadata(PERMISSIONS_KEY, permissions), ApiBearerAuth());

/**
 * A route of the customer app «Bto300» (ADR-0079 #3): only a customer token reaches it, and the
 * caller is the token's own store (`@CurrentCustomer()`). A staff token is refused with 403, as a
 * customer token is on every staff route.
 */
export const CustomerRoute = () =>
  applyDecorators(SetMetadata(CUSTOMER_ROUTE_KEY, true), ApiBearerAuth(CUSTOMER_SECURITY));

export interface AuthenticatedRequest {
  auth?: AuthContext;
  customer?: CustomerContext;
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

/** The signed-in store of a `@CustomerRoute()`; pass it on to services explicitly. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, context: ExecutionContext): CustomerContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.customer)
      throw new Error('@CurrentCustomer() needs @CustomerRoute() on the route');
    return request.customer;
  },
);
