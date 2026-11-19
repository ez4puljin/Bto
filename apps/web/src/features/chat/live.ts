import { useQueryClient } from '@tanstack/react-query';
import type { ChatLiveEvent } from '@tugeel/shared/chat';
import { useEffect, useRef } from 'react';
import { useApiClient } from '@/app/api-client-context';
import type { ApiClient } from '@/lib/api';
import { appendMessage, CHAT_KEYS, type ChatConversation, type ChatMessage } from './api';

/** The data of a `message` or a `conversation` event. */
export interface ChatLivePayload {
  conversation: ChatConversation;
  message: ChatMessage | null;
}

export interface ChatLiveMessage {
  event: string;
  data: string;
}

/**
 * Splits what an event stream has delivered so far into whole events and the unfinished rest
 * (`event:` and `data:` lines, a blank line between events, `:` lines are comments).
 */
export function parseEventStream(buffer: string): { events: ChatLiveMessage[]; rest: string } {
  const normal = buffer.replace(/\r\n?/g, '\n');
  const blocks = normal.split('\n\n');
  const rest = blocks.pop() ?? '';
  const events: ChatLiveMessage[] = [];
  for (const block of blocks) {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
    }
    if (data.length > 0 || event !== 'message') events.push({ event, data: data.join('\n') });
  }
  return { events, rest };
}

export function payloadOf(data: string): ChatLivePayload | null {
  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === 'object' && parsed !== null && 'conversation' in parsed) {
      return parsed as ChatLivePayload;
    }
  } catch {
    // A broken event is ignored; the next ready or resync refetches.
  }
  return null;
}

type Listener = (event: ChatLiveEvent, payload: ChatLivePayload | null) => void;

interface Hub {
  listeners: Set<Listener>;
  stop: () => void;
}

const hubs = new WeakMap<ApiClient, Hub>();

const RETRY_MIN_MS = 2_000;
const RETRY_MAX_MS = 30_000;

/** One stream per client, shared by the page and the menu's badge; it reconnects by itself. */
function connect(api: ApiClient, hub: { listeners: Set<Listener> }): () => void {
  const controller = new AbortController();
  let delay = RETRY_MIN_MS;
  const emit = (event: ChatLiveEvent, payload: ChatLivePayload | null) => {
    for (const listener of hub.listeners) listener(event, payload);
  };
  const run = async () => {
    while (!controller.signal.aborted) {
      try {
        const result = await api.GET('/api/v1/chat/live', {
          // The bearer token is added by the client; the schema lists the header as required.
          params: { header: { authorization: '' } },
          parseAs: 'stream',
          signal: controller.signal,
        });
        const body = result.response.body;
        if (!result.response.ok || !body) throw new Error('chat stream');
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          delay = RETRY_MIN_MS;
          buffer += decoder.decode(chunk.value, { stream: true });
          const parsed = parseEventStream(buffer);
          buffer = parsed.rest;
          for (const entry of parsed.events) {
            if (entry.event === 'message' || entry.event === 'conversation') {
              const payload = payloadOf(entry.data);
              if (payload) emit(entry.event, payload);
            } else if (entry.event === 'ready' || entry.event === 'resync') {
              emit(entry.event, null);
            }
          }
        }
      } catch {
        if (controller.signal.aborted) return;
      }
      if (controller.signal.aborted) return;
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, RETRY_MAX_MS);
      // A stream that ended may have missed events: refetch once it is back.
      emit('resync', null);
    }
  };
  void run();
  return () => controller.abort();
}

/** Calls `listener` for every live event while the component is mounted. */
export function useChatLive(listener: Listener, enabled = true): void {
  const api = useApiClient();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    if (!enabled) return;
    let hub = hubs.get(api);
    if (!hub) {
      const listeners = new Set<Listener>();
      hub = { listeners, stop: () => undefined };
      hubs.set(api, hub);
    }
    const mine: Listener = (event, payload) => latest.current(event, payload);
    const current = hub;
    current.listeners.add(mine);
    if (current.listeners.size === 1) current.stop = connect(api, current);
    return () => {
      current.listeners.delete(mine);
      if (current.listeners.size === 0) {
        current.stop();
        hubs.delete(api);
      }
    };
  }, [api, enabled]);
}

/** Keeps the unread counts and the lists fresh while the app is open (the badge's feed). */
export function useChatUnreadLive(enabled: boolean): void {
  const queryClient = useQueryClient();
  useChatLive(() => {
    void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.unread });
  }, enabled);
}

/** The chat page's feed: the lists and the open conversation follow the events. */
export function useChatPageLive(openId: number | null, onOpenMessage: (id: number) => void): void {
  const queryClient = useQueryClient();
  useChatLive((event, payload) => {
    void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.unread });
    void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.lists });
    if (!payload) {
      if (openId !== null) {
        void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.one(openId) });
        void queryClient.invalidateQueries({ queryKey: CHAT_KEYS.messages(openId) });
      }
      return;
    }
    const { conversation, message } = payload;
    queryClient.setQueryData(CHAT_KEYS.one(conversation.id), conversation);
    if (message) appendMessage(queryClient, conversation.id, message);
    if (event === 'message' && message?.sender === 'CUSTOMER' && conversation.id === openId) {
      onOpenMessage(conversation.id);
    }
  });
}
