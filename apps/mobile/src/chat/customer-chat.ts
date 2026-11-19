import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { STORE_KEY } from '../api/customer';
import { NETWORK, unwrap } from '../api/problem';
import type { CustomerSession } from '../api/session';
import { useCustomer } from '../state/session';
import {
  type ChatState,
  type CustomerChat,
  type CustomerChatConversation,
  type CustomerChatRep,
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
import type { ChatStreamEvent } from './stream';
import { useChatStream } from './use-chat-stream';

// The customer app's side of the chat (ADR-0224): the store's own routes under
// /api/v1/customer-app/chat, the conversation kept in the query cache (so the stream can add to it
// while the screen is closed and the screen shows the history offline), the unread badge, and the
// live stream mounted once in the signed-in layout.

export const CHAT_LIVE_PATH = '/api/v1/customer-app/chat/live';
const CHAT_KEY = [...STORE_KEY, 'chat'] as const;
export const CHAT_OPEN_KEY = [...CHAT_KEY, 'open'] as const;
export const CHAT_UNREAD_KEY = [...CHAT_KEY, 'unread'] as const;

export type CustomerChatState = ChatState<CustomerChatConversation> & {
  rep: CustomerChatRep | null;
};
type CustomerChatEvent = ChatStreamEvent<CustomerChatConversation>;

const stateOf = (chat: CustomerChat): CustomerChatState => ({
  conversation: chat.conversation,
  messages: chat.messages,
  nextCursor: chat.nextCursor,
  rep: chat.rep,
});

/** The unread count of the chat's buttons (home, profile): refreshed by the stream and every minute. */
export function useChatUnread(): number {
  const { session } = useCustomer();
  const query = useQuery({
    queryKey: CHAT_UNREAD_KEY,
    queryFn: async () => unwrap(await session.client.GET('/api/v1/customer-app/chat/unread')),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return query.data?.unread ?? 0;
}

function setUnread(queryClient: QueryClient, unread: number): void {
  queryClient.setQueryData(CHAT_UNREAD_KEY, { unread });
}

/**
 * The store's chat stream, mounted beside `useLiveStock` in the customer layout: a new message or a
 * changed conversation reaches the open conversation's cache and the badge; `ready` and `resync`
 * refetch both (the open screen's conversation refetches at once, a closed one on its next opening).
 */
export function useCustomerChatLive(session: CustomerSession): void {
  const queryClient = useQueryClient();
  useChatStream<CustomerChatConversation>(session, CHAT_LIVE_PATH, (event: CustomerChatEvent) => {
    if (event.type === 'ready' || event.type === 'resync') {
      // The badge refetches (a read-only GET). The conversation (`POST open`, which marks it read)
      // is `enabled` only while the screen is in front: invalidating refetches it then, and a screen
      // behind (disabled, so not active) is only marked stale and refetches when it comes back.
      void queryClient.invalidateQueries({ queryKey: CHAT_UNREAD_KEY });
      void queryClient.invalidateQueries({ queryKey: CHAT_OPEN_KEY });
    } else if (event.type === 'message' || event.type === 'conversation') {
      setUnread(queryClient, event.conversation.unread);
      queryClient.setQueryData<CustomerChatState>(CHAT_OPEN_KEY, (held) =>
        held ? withLive(held, event) : held,
      );
    }
  });
}

/** What the chat screen works with. */
export interface CustomerChatScreen {
  state: CustomerChatState | undefined;
  loading: boolean;
  /** The open call failed (with a history shown, the quiet «Холболт тасарсан» line). */
  failed: boolean;
  refetch: () => void;
  outgoing: Outgoing[];
  send: (body: Outgoing['body'], label: string) => void;
  retry: (key: string) => void;
  discard: (key: string) => void;
  loadOlder: () => void;
  loadingOlder: boolean;
  markRead: () => void;
}

/** The conversation: opened (and made, the first time), older pages, sends with retry, «read». */
export function useCustomerChat(focused: boolean): CustomerChatScreen {
  const { session } = useCustomer();
  const queryClient = useQueryClient();
  const open = useQuery({
    queryKey: CHAT_OPEN_KEY,
    queryFn: async (): Promise<CustomerChatState> => {
      const fresh = stateOf(unwrap(await session.client.POST('/api/v1/customer-app/chat/open')));
      const merged = mergeOpened(queryClient.getQueryData<CustomerChatState>(CHAT_OPEN_KEY), fresh);
      setUnread(queryClient, merged.conversation.unread);
      return { ...merged, rep: fresh.rep };
    },
    staleTime: 0,
    retry: 1,
    // Opening marks the conversation read: only while the screen is in front. Coming back to it
    // refetches (stale since an event, or simply old).
    enabled: focused,
  });
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderBusy = useRef(false);
  const readBusy = useRef(false);

  const change = useCallback(
    (update: (held: CustomerChatState) => CustomerChatState) =>
      queryClient.setQueryData<CustomerChatState>(CHAT_OPEN_KEY, (held) =>
        held ? update(held) : held,
      ),
    [queryClient],
  );

  const post = useCallback(
    async (pending: Outgoing) => {
      let status: number;
      try {
        const result = await session.client.POST('/api/v1/customer-app/chat/messages', {
          body: pending.body,
          params: { header: { 'Idempotency-Key': pending.key } },
        });
        status = result.response.status;
        if (result.data) {
          const sent = result.data;
          change((held) => withSent(held, sent));
          setUnread(queryClient, sent.conversation.unread);
          setOutgoing((list) => list.filter((one) => one.key !== pending.key));
          return;
        }
      } catch {
        status = NETWORK.status;
      }
      const failure = sendFailureOf(status);
      if (failure === 'refused' && 'buttonId' in pending.body) {
        // The button is no longer offered: drop it; the refetch shows the buttons offered now.
        setOutgoing((list) => list.filter((one) => one.key !== pending.key));
        void queryClient.invalidateQueries({ queryKey: CHAT_OPEN_KEY });
        return;
      }
      setOutgoing((list) =>
        list.map((one) => (one.key === pending.key ? { ...one, status: failure } : one)),
      );
    },
    [session, queryClient, change],
  );

  const send = useCallback(
    (body: Outgoing['body'], label: string) => {
      const pending = outgoingOf(
        Crypto.randomUUID(),
        body,
        label,
        new Date(),
        newestId(queryClient.getQueryData<CustomerChatState>(CHAT_OPEN_KEY)?.messages ?? []),
      );
      setOutgoing((list) => [...list, pending]);
      void post(pending);
    },
    [post, queryClient],
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
          await session.client.GET('/api/v1/customer-app/chat/messages', {
            params: { query: { cursor, limit: 30 } },
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
  }, [cursor, session, change]);

  const markRead = useCallback(() => {
    if (readBusy.current) return;
    readBusy.current = true;
    void (async () => {
      try {
        const conversation = unwrap(await session.client.POST('/api/v1/customer-app/chat/read'));
        change((held) => ({ ...held, conversation }));
        setUnread(queryClient, conversation.unread);
      } catch {
        // The next arrival or the next opening marks it again.
      } finally {
        readBusy.current = false;
      }
    })();
  }, [session, queryClient, change]);

  return {
    state: open.data,
    loading: open.isPending,
    failed: open.isError,
    refetch: () => void open.refetch(),
    outgoing: pendingOutgoing(open.data?.messages ?? [], outgoing),
    send,
    retry,
    discard,
    loadOlder,
    loadingOlder,
    markRead,
  };
}
