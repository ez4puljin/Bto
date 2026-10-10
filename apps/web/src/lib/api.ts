import { AuthSession } from '@/lib/auth/auth-session';

export type { ApiClient } from '@tugeel/api-client';

/**
 * Same origin everywhere: the Vite proxy in development, the edge Caddy after go-live. The session
 * owns the API client so every call carries the in-memory access token (ADR-0027).
 */
export function createBrowserSession(): AuthSession {
  return new AuthSession({ baseUrl: window.location.origin });
}
