import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { SegmentEntity } from '@tugeel/shared/segments';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type Segment = Schemas['Segment'];
export type SegmentDefinition = Schemas['SegmentDefinition'];
export type SegmentCondition = Schemas['SegmentCondition'];
export type SegmentCreate = Schemas['SegmentCreateRequest'];
export type SegmentUpdate = Schemas['SegmentUpdateRequest'];

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

/** The segments page: live segments of an entity by name, a page at a time. */
export function useSegmentPages(entity: SegmentEntity) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.segments, 'pages', entity],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/segments', {
          params: { query: { entity, cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** How many records each segment keeps, in one read per page of segments. */
export function useSegmentCounts(segmentIds: readonly number[]) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.segments, 'counts', segmentIds],
    enabled: segmentIds.length > 0,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/segments/counts', {
          params: { query: { segmentIds: [...segmentIds] } },
          signal,
        }),
      ),
  });
}

export function useSegment(id: number) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.segments, id],
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/api/v1/segments/{id}', { params: { path: { id } }, signal })),
  });
}

/** The editor's live count of conditions not saved yet; only while they pass the shared rules. */
export function useSegmentPreview(
  entity: SegmentEntity,
  definition: SegmentDefinition,
  enabled: boolean,
) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.segments, 'preview', entity, definition],
    enabled,
    queryFn: async ({ signal }) =>
      unwrap(await api.POST('/api/v1/segments/preview', { body: { entity, definition }, signal }))
        .count,
    placeholderData: keepPreviousData,
  });
}

/** Idempotent routes take the key from the caller: one key per user intent (ADR-0004). */
type Keyed<T> = T & { key: string };

export function useSegmentMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: KEYS.segments });
  return {
    create: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<SegmentCreate>) =>
        unwrap(
          await api.POST('/api/v1/segments', {
            body,
            params: { header: idempotencyKey(key) },
          }),
        ),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: SegmentUpdate & { id: number }) =>
        unwrap(await api.PUT('/api/v1/segments/{id}', { params: { path: { id } }, body })),
      onSuccess: invalidate,
    }),
    archive: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/segments/{id}', { params: { path: { id } } })),
      onSuccess: invalidate,
    }),
  };
}
