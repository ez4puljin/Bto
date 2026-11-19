import {
  type InfiniteData,
  keepPreviousData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { type components, idempotencyKey } from '@tugeel/api-client';
import type { ChatListState } from '@tugeel/shared/chat';
import { useApiClient } from '@/app/api-client-context';
import { unwrap } from '@/lib/problem';

type Schemas = components['schemas'];
export type ChatConversation = Schemas['StaffChatConversation'];
export type ChatMessage = Schemas['ChatMessage'];
export type ChatMessagePage = Schemas['ChatMessagePage'];
export type ChatConversationPage = Schemas['StaffChatPage'];
export type ChatSettings = Schemas['ChatSettings'];
export type ChatSettingsRequest = Schemas['ChatSettingsRequest'];

const ROOT = ['chat'] as const;
export const CHAT_KEYS = {
  all: ROOT,
  list: (state: ChatListState) => [...ROOT, 'conversations', state] as const,
  lists: [...ROOT, 'conversations'] as const,
  one: (id: number) => [...ROOT, 'conversation', id] as const,
  messages: (id: number) => [...ROOT, 'messages', id] as const,
  unread: [...ROOT, 'unread'] as const,
  settings: [...ROOT, 'settings'] as const,
};

/** The conversations of one tab, latest message first (ADR-0224). */
export function useChatConversations(state: ChatListState, enabled = true) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: CHAT_KEYS.list(state),
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/chat/conversations', {
          params: { query: { state, cursor: pageParam, limit: 30 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    // The live stream refreshes the lists; this is the fallback when it is down.
    refetchInterval: 60_000,
  });
}

/** How many conversations wait and how many messages are unread: the menu's badge. */
export function useChatUnread(enabled = true) {
  const api = useApiClient();
  return useQuery({
    queryKey: CHAT_KEYS.unread,
    enabled,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/chat/unread', { signal })),
    staleTime: 30_000,
    // The slow poll beside the live stream.
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useChatConversation(id: number | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: CHAT_KEYS.one(id ?? 0),
    enabled: id !== null,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/api/v1/chat/conversations/{id}', {
          params: { path: { id: id ?? 0 } },
          signal,
        }),
      ),
    retry: false,
  });
}

/** The newest page first; each older page follows (`fetchNextPage`). */
export function useChatMessages(id: number | null) {
  const api = useApiClient();
  return useInfiniteQuery({
    queryKey: CHAT_KEYS.messages(id ?? 0),
    enabled: id !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }) =>
      unwrap(
        await api.GET('/api/v1/chat/conversations/{id}/messages', {
          params: { path: { id: id ?? 0 }, query: { cursor: pageParam, limit: 30 } },
          signal,
        }),
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
}

/** The loaded messages, oldest first. */
export function messagesOf(data: InfiniteData<ChatMessagePage> | undefined): ChatMessage[] {
  return [...(data?.pages ?? [])].reverse().flatMap((page) => page.data);
}

/** Puts a message at the end of a conversation's cached history, once. */
export function appendMessage(
  queryClient: QueryClient,
  conversationId: number,
  message: ChatMessage,
): void {
  queryClient.setQueryData<InfiniteData<ChatMessagePage>>(
    CHAT_KEYS.messages(conversationId),
    (previous) => {
      if (!previous || previous.pages.length === 0) return previous;
      if (previous.pages.some((page) => page.data.some((entry) => entry.id === message.id))) {
        return previous;
      }
      const [first, ...rest] = previous.pages;
      if (!first) return previous;
      return { ...previous, pages: [{ ...first, data: [...first.data, message] }, ...rest] };
    },
  );
}

export function useChatMutations() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refreshLists = () => {
    void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.lists });
    void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.unread });
  };
  return {
    /** One key per typed message, resent unchanged when the send failed (ADR-0004). */
    reply: useMutation({
      mutationFn: async (input: { id: number; text: string; key: string }) =>
        unwrap(
          await api.POST('/api/v1/chat/conversations/{id}/messages', {
            params: { path: { id: input.id }, header: idempotencyKey(input.key) },
            body: { text: input.text },
          }),
        ),
      onSuccess: (result) => {
        queryClient.setQueryData(CHAT_KEYS.one(result.conversation.id), result.conversation);
        appendMessage(queryClient, result.conversation.id, result.message);
        refreshLists();
      },
    }),
    read: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/chat/conversations/{id}/read', { params: { path: { id } } }),
        ),
      onSuccess: (conversation) => {
        queryClient.setQueryData(CHAT_KEYS.one(conversation.id), conversation);
        refreshLists();
      },
    }),
    close: useMutation({
      mutationFn: async (id: number) =>
        unwrap(
          await api.POST('/api/v1/chat/conversations/{id}/close', { params: { path: { id } } }),
        ),
      onSuccess: (conversation) => {
        queryClient.setQueryData(CHAT_KEYS.one(conversation.id), conversation);
        void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.messages(conversation.id) });
        refreshLists();
      },
    }),
  };
}

export function useChatSettings() {
  const api = useApiClient();
  return useQuery({
    queryKey: CHAT_KEYS.settings,
    queryFn: async ({ signal }) => unwrap(await api.GET('/api/v1/chat/settings', { signal })),
  });
}

export function useUpdateChatSettings() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: ChatSettingsRequest) =>
      unwrap(await api.PUT('/api/v1/chat/settings', { body })),
    onSuccess: (settings) => queryClient.setQueryData(CHAT_KEYS.settings, settings),
  });
}
