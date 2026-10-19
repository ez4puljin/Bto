import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'tugeel:public';

/**
 * Marks a route that needs no login (ADR-0027 #3): health, login, refresh, logout, password setup.
 * Every other route must declare `@Authenticated()`, `@RequirePermission(...)` or `@CustomerRoute()`
 * (identity module, ADR-0082); a route with none of them is refused by the global AuthGuard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
