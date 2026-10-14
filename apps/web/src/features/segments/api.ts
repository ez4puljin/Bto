import { useQuery } from '@tanstack/react-query';
import type { components } from '@tugeel/api-client';
import type { SegmentEntity } from '@tugeel/shared/segments';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type Segment = Schemas['Segment'];

export const KEYS = {
  segments: ['segments'] as const,
};

/** Live segments of an entity by name (a filter's choices); segments are few, one page holds them. */
export function useSegments(entity: SegmentEntity, options: { enabled?: boolean } = {}) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.segments, 'list', entity],
    enabled: options.enabled ?? true,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/segments', {
          params: { query: { entity, limit: 200 } },
          signal,
        }),
      ).data,
  });
}
