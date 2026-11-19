import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ChatListState } from '@tugeel/shared/chat';
import { CHAT_LIST_STATES } from '@tugeel/shared/chat';
import * as Crypto from 'expo-crypto';
import { useCallback, useRef, useState } from 'react';
import { NETWORK, unwrap } from '../api/problem';
import type { AnySession } from '../api/session';
import { useSignedIn } from '../state/session';
import {
  type ChatState,
  mergeOpened,
  newestId,
  type Outgoing,
  outgoingOf,
  pendingOutgoing,
  sendFailureOf,
  withLive,
  withOlder,
  withSent,
} from './logic';
import {
  badgeOf,
  mayAnswerChat,
  type StaffChatConversation,
  withConversation,
} from './staff-logic';
import type { ChatStreamEvent } from './stream';
import { useChatStream } from './use-chat-stream';

// The staff app's side of the chat (ADR-0224): the conversations in the user's scope under
// /api/v1/chat, kept in the query cache (the stream adds to it while a screen is closed), the badge
// on the entry, and the one live stream mounted in the staff layout.

export const STAFF_CHAT_LIVE_PATH = '/api/v1/chat/live';
const KEY = ['staff-chat'] as const;
const UNREAD_KEY = [...KEY, 'unread'] as const;
const listKey = (filter: ChatListState) => [...KEY, 'list', filter] as const;
const openKey = (id: number) => [...KEY, 'open', id] as const;

type StaffChatEvent = ChatStreamEvent<StaffChatConversation>;
export type StaffChatState = ChatState<StaffChatConversation>;
type ListPage = { data: StaffChatConversation[]; nextCursor: string | null };
type ListData = InfiniteData<ListPage, string | undefined>;

export { mayAnswerChat };

/** The number on the entry (waiting, or unread when nothing waits): refreshed by the stream and each minute. */
export function useStaffChatBadge(enabled: boolean): {
  waiting: number;
  badge: number;
  /** The first answer (or failure) is in. */
  settled: boolean;
  refetch: () => Promise<unknown>;
} {
  const { session } = useSignedIn();
  const query = useQuery({
    queryKey: UNREAD_KEY,
    enabled,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/chat/unread')),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return {
    waiting: query.data?.waiting ?? 0,
    badge: badgeOf(query.data),
    settled: !query.isPending,
    refetch: query.refetch,
  };
}

/** A conversation as it is now put into every list held and the open screen's state. */
function put(queryClient: QueryClient, conversation: StaffChatConversation): void {
  for (const filter of CHAT_LIST_STATES) {
    queryClient.setQueryData<ListData>(listKey(filter), (held) =>
      held ? { ...held, pages: withConversation(held.pages, conversation, filter) } : held,
    );
  }
  queryClient.setQueryData<StaffChatState>(openKey(conversation.id), (held) =>
    held ? { ...held, conversation } : held,
  );
}

/**
 * The staff user's chat stream, mounted once in the staff layout (only for a user with a chat
 * right): a message or a changed conversation reaches the lists and the open conversation; the badge
 * refetches. `ready` and `resync` mark the lists and conversations stale without fetching: the
 * screen in front refetches at once, one behind it when it is back in front.
 */
export function useStaffChatLive(session: AnySession, enabled: boolean): void {
  const queryClient = useQueryClient();
  useChatStream<StaffChatConversation>(
    session,
    STAFF_CHAT_LIVE_PATH,
    (event: StaffChatEvent) => {
      if (event.type === 'ready' || event.type === 'resync') {
        void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
        void queryClient.invalidateQueries({ queryKey: [...KEY, 'list'] });
        void queryClient.invalidateQueries({ queryKey: [...KEY, 'open'] });
      } else if (event.type === 'message' || event.type === 'conversation') {
        put(queryClient, event.conversation);
        queryClient.setQueryData<StaffChatState>(openKey(event.conversation.id), (held) =>
          held ? withLive(held, event) : held,
        );
        void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
      }
    },
    enabled,
  );
}

/** The list of one filter, page by page; refetched when the screen is in front and stale. */
export function useStaffChatList(filter: ChatListState, focused: boolean) {
  const { session } = useSignedIn();
  return useInfiniteQuery({
    queryKey: listKey(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam }): Promise<ListPage> =>
      unwrap(
        await session.client.GET('/api/v1/chat/conversations', {
          params: {
            query: { state: filter, limit: 30, ...(pageParam ? { cursor: pageParam } : {}) },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 0,
    enabled: focused,
  });
}

/** What the conversation screen works with. */
export interface StaffChatScreen {
  state: StaffChatState | undefined;
  loading: boolean;
  failed: boolean;
  refetch: () => void;
  outgoing: Outgoing[];
  send: (text: string) => void;
  retry: (key: string) => void;
  discard: (key: string) => void;
  loadOlder: () => void;
  loadingOlder: boolean;
  markRead: () => void;
  /** Closes the conversation (back to the bot); resolves false when it failed. */
  close: () => Promise<boolean>;
}

/** One conversation: its first page, older pages, answers with retry, «read» and the close. */
export function useStaffChat(id: number, focused: boolean): StaffChatScreen {
  const { session, me } = useSignedIn();
  const queryClient = useQueryClient();
  const open = useQuery({
    queryKey: openKey(id),
    queryFn: async (): Promise<StaffChatState> => {
      const [conversation, page] = await Promise.all([
        session.client.GET('/api/v1/chat/conversations/{id}', { params: { path: { id } } }),
        session.client.GET('/api/v1/chat/conversations/{id}/messages', {
          params: { path: { id }, query: { limit: 30 } },
        }),
      ]);
      const fresh: StaffChatState = {
        conversation: unwrap(conversation),
        messages: unwrap(page).data,
        nextCursor: unwrap(page).nextCursor,
      };
      return mergeOpened(queryClient.getQueryData<StaffChatState>(openKey(id)), fresh);
    },
    staleTime: 0,
    retry: 1,
    enabled: focused,
  });
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderBusy = useRef(false);
  const readBusy = useRef(false);

  const change = useCallback(
    (update: (held: StaffChatState) => StaffChatState) =>
      queryClient.setQueryData<StaffChatState>(openKey(id), (held) => (held ? update(held) : held)),
    [queryClient, id],
  );

  const post = useCallback(
    async (pending: Outgoing) => {
      let status: number;
      try {
        const result = await session.client.POST('/api/v1/chat/conversations/{id}/messages', {
          params: { path: { id }, header: { 'Idempotency-Key': pending.key } },
          body: { text: 'text' in pending.body ? pending.body.text : pending.label },
        });
        status = result.response.status;
        if (result.data) {
          const sent = result.data;
          change((held) =>
            withSent(held, { conversation: sent.conversation, messages: [sent.message] }),
          );
          put(queryClient, sent.conversation);
          void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
          setOutgoing((list) => list.filter((one) => one.key !== pending.key));
          return;
        }
      } catch {
        status = NETWORK.status;
      }
      const failure = sendFailureOf(status);
      setOutgoing((list) =>
        list.map((one) => (one.key === pending.key ? { ...one, status: failure } : one)),
      );
    },
    [session, queryClient, change, id],
  );

  const send = useCallback(
    (text: string) => {
      const pending = outgoingOf(
        Crypto.randomUUID(),
        { text },
        text,
        new Date(),
        newestId(queryClient.getQueryData<StaffChatState>(openKey(id))?.messages ?? []),
      );
      setOutgoing((list) => [...list, pending]);
      void post(pending);
    },
    [post, queryClient, id],
  );

  const retry = useCallback(
    (key: string) => {
      const found = outgoing.find((one) => one.key === key);
      if (!found || found.status === 'sending' || found.status === 'refused') return;
      const again = { ...found, status: 'sending' as const };
      setOutgoing((list) => list.map((one) => (one.key === key ? again : one)));
      void post(again);
    },
    [outgoing, post],
  );

  const discard = useCallback(
    (key: string) => setOutgoing((list) => list.filter((one) => one.key !== key)),
    [],
  );

  const cursor = open.data?.nextCursor ?? null;
  const loadOlder = useCallback(() => {
    if (cursor === null || olderBusy.current) return;
    olderBusy.current = true;
    setLoadingOlder(true);
    void (async () => {
      try {
        const page = unwrap(
          await session.client.GET('/api/v1/chat/conversations/{id}/messages', {
            params: { path: { id }, query: { cursor, limit: 30 } },
          }),
        );
        change((held) => withOlder(held, page));
      } catch {
        // Offline: the history shown stays, and scrolling up tries again.
      } finally {
        olderBusy.current = false;
        setLoadingOlder(false);
      }
    })();
  }, [cursor, session, change, id]);

  const markRead = useCallback(() => {
    if (readBusy.current) return;
    readBusy.current = true;
    void (async () => {
      try {
        const conversation = unwrap(
          await session.client.POST('/api/v1/chat/conversations/{id}/read', {
            params: { path: { id } },
          }),
        );
        put(queryClient, conversation);
        void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
      } catch {
        // The next arrival marks it again.
      } finally {
        readBusy.current = false;
      }
    })();
  }, [session, queryClient, id]);

  const close = useCallback(async (): Promise<boolean> => {
    try {
      const conversation = unwrap(
        await session.client.POST('/api/v1/chat/conversations/{id}/close', {
          params: { path: { id } },
        }),
      );
      put(queryClient, conversation);
      // The closing note the bot wrote is a message too: the next opening shows it.
      void queryClient.invalidateQueries({ queryKey: openKey(id), refetchType: 'none' });
      void queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
      return true;
    } catch {
      return false;
    }
  }, [session, queryClient, id]);

  return {
    state: open.data,
    loading: open.isPending,
    failed: open.isError,
    refetch: () => void open.refetch(),
    outgoing: pendingOutgoing(open.data?.messages ?? [], outgoing, {
      sender: 'STAFF',
      staffUserId: me.id,
    }),
    send,
    retry,
    discard,
    loadOlder,
    loadingOlder,
    markRead,
    close,
  };
}
