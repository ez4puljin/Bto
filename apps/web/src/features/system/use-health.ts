import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';

function isHealthResponse(value: unknown): value is HealthResponse {
  return typeof value === 'object' && value !== null && 'db' in value && 'pgboss' in value;
}

/** GET /health every 30 s. A 503 carries the same body, so a degraded system still renders. */
export function useHealth() {
  const api = useApiClient();
  return useQuery({
    queryKey: ['system', 'health'],
    queryFn: async ({ signal }) => {
      const { data, error, response } = await api.GET('/health', { signal });
      const body: unknown = data ?? error;
      if (!isHealthResponse(body)) throw new Error(`GET /health failed: HTTP ${response.status}`);
      return body;
    },
    refetchInterval: 30_000,
  });
}
