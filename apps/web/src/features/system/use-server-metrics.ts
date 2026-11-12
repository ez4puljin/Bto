import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';
import { mergeHistory } from './server-format';

export type ServerMetrics = components['schemas']['ServerMetrics'];

export const SERVER_METRICS_KEY = ['system', 'server'] as const;

/**
 * GET /api/v1/system/server every five seconds (the api's own pace). The first answer carries the
 * hour of history the api holds; later ones ask only for the points after the newest one held, and
 * the page keeps the hour itself.
 */
export function useServerMetrics(enabled: boolean) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: SERVER_METRICS_KEY,
    enabled,
    queryFn: async ({ signal }): Promise<ServerMetrics> => {
      const held = queryClient.getQueryData<ServerMetrics>(SERVER_METRICS_KEY)?.history ?? [];
      const since = held.at(-1)?.t;
      const data = unwrap(
        await api.GET('/api/v1/system/server', {
          params: { query: since === undefined ? {} : { since: String(since) } },
          signal,
        }),
      );
      return { ...data, history: mergeHistory(held, data.history) };
    },
    refetchInterval: 5_000,
  });
}
