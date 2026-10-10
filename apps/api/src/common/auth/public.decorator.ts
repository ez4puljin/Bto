import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'tugeel:public';

/**
 * Marks a route that needs no login (ADR-0027 #3): health, login, refresh, logout, password setup.
 * Every other route must declare `@Authenticated()` or `@RequirePermission(...)` (identity module);
 * a route with none of the three is refused by the global AuthGuard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
