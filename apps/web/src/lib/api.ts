import { createApiClient } from '@tugeel/api-client';

export type ApiClient = ReturnType<typeof createApiClient>;

/** Same origin everywhere: the Vite proxy in development, the edge Caddy on staging and production. */
export function createBrowserApiClient(): ApiClient {
  return createApiClient({ baseUrl: window.location.origin });
}
