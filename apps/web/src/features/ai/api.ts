import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type AiStatus = Schemas['AiStatus'];
export type AiAnswer = Schemas['AiAnswer'];
export type AiQuestion = Schemas['AiQuestion'];
export type AiResult = Schemas['AiResult'];
export type AiColumn = Schemas['AiColumn'];
export type AiConversation = Schemas['AiConversation'];
export type AiConversationDetail = Schemas['AiConversationDetail'];
export type AiReport = Schemas['AiReport'];

export const KEYS = {
  status: ['ai', 'status'] as const,
  conversations: ['ai', 'conversations'] as const,
  reports: ['ai', 'reports'] as const,
};

/** Idempotent routes take one key per user intent, resent unchanged on a retry (ADR-0004). */
type Keyed<T> = T & { key: string };

/** Whether questions can be asked and saved reports run (ADR-0045). */
export function useAiStatus() {
  const api = useApiClient();
  return useQuery({
    queryKey: KEYS.status,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/ai/status', { signal })),
    staleTime: 60_000,
  });
}

/** The user's own conversations, the latest active first. */
export function useConversations() {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.conversations, 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/ai/conversations', {
          params: { query: { cursor: pageParam, limit: 30 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** One conversation with its questions (no rows: they are fetched again on demand). */
export function useConversation(id: number | undefined) {
  const api = useApiClient();
  return useQuery({
    queryKey: [...KEYS.conversations, id],
    enabled: id !== undefined,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/ai/conversations/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
  });
}

export function useReports() {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: [...KEYS.reports, 'list'],
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/ai/reports', {
          params: { query: { cursor: pageParam, limit: 50 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

/** Questions, rows again, Excel files and saved reports. */
export function useAiMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = (queryKey: readonly unknown[]) => queryClient.invalidateQueries({ queryKey });

  return {
    ask: useMutation({
      mutationFn: async ({
        key,
        ...body
      }: Keyed<{ question: string; conversationId?: number }>): Promise<AiAnswer> =>
        unwrap(
          await api.POST('/api/v1/ai/questions', {
            params: { header: idempotencyKey(key) },
            body,
          }),
        ),
      onSuccess: (answer) => {
        // The conversation shows the new step at once (a new one has no cached detail yet);
        // the refetch below then brings the server's copy.
        queryClient.setQueryData<AiConversationDetail>(
          [...KEYS.conversations, answer.conversationId],
          (old) => ({
            conversation: old?.conversation ?? {
              id: answer.conversationId,
              title: answer.question.question,
              createdAt: answer.question.createdAt,
              updatedAt: answer.question.createdAt,
            },
            questions: [
              ...(old?.questions ?? []).filter((step) => step.id !== answer.question.id),
              answer.question,
            ],
          }),
        );
        return invalidate(KEYS.conversations);
      },
    }),
    runQuestion: useMutation({
      mutationFn: async (id: number): Promise<AiResult> =>
        unwrap(await api.POST('/api/v1/ai/questions/{id}/run', { params: { path: { id } } })),
    }),
    runReport: useMutation({
      mutationFn: async (id: number): Promise<AiResult> =>
        unwrap(await api.POST('/api/v1/ai/reports/{id}/run', { params: { path: { id } } })),
    }),
    exportQuestion: useMutation({
      mutationFn: async (id: number): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/ai/questions/{id}/export', {
            params: { path: { id } },
            parseAs: 'blob',
          }),
        ),
    }),
    exportReport: useMutation({
      mutationFn: async (id: number): Promise<Blob> =>
        unwrap(
          await api.GET('/api/v1/ai/reports/{id}/export', {
            params: { path: { id } },
            parseAs: 'blob',
          }),
        ),
    }),
    saveReport: useMutation({
      mutationFn: async ({ key, ...body }: Keyed<{ questionId: number; name: string }>) =>
        unwrap(
          await api.POST('/api/v1/ai/reports', { params: { header: idempotencyKey(key) }, body }),
        ),
      onSuccess: () => invalidate(KEYS.reports),
    }),
    renameReport: useMutation({
      mutationFn: async ({ id, name }: { id: number; name: string }) =>
        unwrap(
          await api.PATCH('/api/v1/ai/reports/{id}', { params: { path: { id } }, body: { name } }),
        ),
      onSuccess: () => invalidate(KEYS.reports),
    }),
    deleteReport: useMutation({
      mutationFn: async (id: number) =>
        unwrap(await api.DELETE('/api/v1/ai/reports/{id}', { params: { path: { id } } })),
      onSuccess: () => invalidate(KEYS.reports),
    }),
  };
}
