import type { components } from '@tugeel/api-client';
import { CHAT_LIMITS, chatLength } from '@tugeel/shared/chat';
import { ubDate } from '../dates/dates';

// The chat's pure logic (ADR-0224), shared by the customer app's screen and, later, the staff app's:
// merging messages by id, the rows of the list with their day separators, what may be sent, and
// what an outgoing message is while it is on its way. No React, no network.

export type ChatMessage = components['schemas']['ChatMessage'];
export type ChatButton = components['schemas']['ChatButton'];
export type CustomerChatConversation = components['schemas']['CustomerChatConversation'];
export type CustomerChat = components['schemas']['CustomerChat'];
export type CustomerChatRep = components['schemas']['CustomerChatRep'];
export type CustomerChatSendResult = components['schemas']['CustomerChatSendResult'];

/** What a screen keeps of one conversation: the messages loaded so far, oldest first. */
export interface ChatState<C> {
  conversation: C;
  messages: ChatMessage[];
  /** The cursor of the page of older messages; null = the conversation starts in `messages`. */
  nextCursor: string | null;
}

/** Messages by id, each once, oldest first; an incoming copy replaces the one held. */
export function mergeMessages(
  held: readonly ChatMessage[],
  incoming: readonly ChatMessage[],
): ChatMessage[] {
  const byId = new Map<number, ChatMessage>();
  for (const message of held) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

/**
 * A fresh page one (the open call, a refetch after `resync`) over what is held: the messages are
 * merged, so older pages already loaded stay, and the cursor stays too while the held list reaches
 * further back than the fresh one.
 */
export function mergeOpened<C>(held: ChatState<C> | undefined, fresh: ChatState<C>): ChatState<C> {
  if (!held || held.messages.length === 0) return fresh;
  const freshOldest = fresh.messages[0]?.id ?? Number.POSITIVE_INFINITY;
  const reachesBack = (held.messages[0]?.id ?? Number.POSITIVE_INFINITY) < freshOldest;
  return {
    conversation: fresh.conversation,
    messages: mergeMessages(held.messages, fresh.messages),
    nextCursor: reachesBack ? held.nextCursor : fresh.nextCursor,
  };
}

/** A page of older messages added to the state. */
export function withOlder<C, S extends ChatState<C>>(
  state: S,
  page: { data: readonly ChatMessage[]; nextCursor: string | null },
): S {
  return {
    ...state,
    messages: mergeMessages(state.messages, page.data),
    nextCursor: page.nextCursor,
  };
}

/** A live event (or a send's answer) added to the state: its message, and the conversation. */
export function withLive<C, S extends ChatState<C>>(
  state: S,
  event: { conversation: C; message?: ChatMessage | null },
): S {
  return {
    ...state,
    conversation: event.conversation,
    messages: event.message ? mergeMessages(state.messages, [event.message]) : state.messages,
  };
}

/** A send's answer: the store's message and the bot's, and the conversation as it is now. */
export function withSent<C, S extends ChatState<C>>(
  state: S,
  result: { conversation: C; messages: readonly ChatMessage[] },
): S {
  return {
    ...state,
    conversation: result.conversation,
    messages: mergeMessages(state.messages, result.messages),
  };
}

/** A message on its way: shown at once, then replaced by the server's. */
export interface Outgoing {
  /** The Idempotency-Key: a retry repeats it, so the server never writes the message twice. */
  key: string;
  /** What the request carries: a typed text or a pressed button. */
  body: { text: string } | { buttonId: string };
  /** What the bubble says (the text, or the button's label). */
  label: string;
  /**
   * `sending`; `failed` (no answer, a server error: retry); `limited` (429, past the minute's
   * sends: retry); `refused` (422, a text the server will not take: only discard).
   */
  status: 'sending' | 'failed' | 'limited' | 'refused';
  createdAt: string;
  /** The newest message id held when it was sent: a live copy of it has a larger id. */
  sinceId: number;
}

export function outgoingOf(
  key: string,
  body: Outgoing['body'],
  label: string,
  now: Date,
  sinceId = 0,
): Outgoing {
  return { key, body, label, status: 'sending', createdAt: now.toISOString(), sinceId };
}

/** The newest id among the messages (0 for none). */
export function newestId(messages: readonly ChatMessage[]): number {
  return messages.reduce((most, message) => Math.max(most, message.id), 0);
}

/**
 * What is still on its way: a message the stream delivered before the send's answer is the same
 * message, so its outgoing copy goes. The server gives no key back, so a copy is one the customer
 * wrote after `sinceId` with the same button (or the same text); each real message settles one.
 */
export function pendingOutgoing(
  messages: readonly ChatMessage[],
  outgoing: readonly Outgoing[],
): Outgoing[] {
  const used = new Set<number>();
  return outgoing.filter((pending) => {
    if (pending.status === 'refused') return true;
    const buttonId = 'buttonId' in pending.body ? pending.body.buttonId : null;
    const match = messages.find(
      (message) =>
        !used.has(message.id) &&
        message.id > pending.sinceId &&
        message.sender === 'CUSTOMER' &&
        message.buttonId === buttonId &&
        message.body === pending.label,
    );
    if (match) used.add(match.id);
    return !match;
  });
}

/** What a failed send turns into: the minute's limit, a body the server refused, or a plain failure. */
export function sendFailureOf(status: number): 'limited' | 'refused' | 'failed' {
  if (status === 429) return 'limited';
  if (status === 422) return 'refused';
  return 'failed';
}

/** A row of the list: a day's separator, a message of the server, or one on its way. */
export type ChatRow =
  | { kind: 'day'; key: string; day: string }
  | { kind: 'message'; key: string; message: ChatMessage }
  | { kind: 'outgoing'; key: string; outgoing: Outgoing };

/**
 * The rows, oldest first: each day opens with its separator (Ulaanbaatar days); messages on their
 * way follow the server's, under their own day.
 */
export function rowsOf(messages: readonly ChatMessage[], outgoing: readonly Outgoing[]): ChatRow[] {
  const rows: ChatRow[] = [];
  let day = '';
  const dayOf = (iso: string) => {
    const next = ubDate(iso);
    if (next !== '' && next !== day) {
      day = next;
      rows.push({ kind: 'day', key: `day-${next}`, day: next });
    }
  };
  for (const message of messages) {
    dayOf(message.createdAt);
    rows.push({ kind: 'message', key: `m-${message.id}`, message });
  }
  for (const pending of outgoing) {
    dayOf(pending.createdAt);
    rows.push({ kind: 'outgoing', key: `o-${pending.key}`, outgoing: pending });
  }
  return rows;
}

/** The rows for an inverted list (newest at the bottom, the list growing upward). */
export function invertedRowsOf(
  messages: readonly ChatMessage[],
  outgoing: readonly Outgoing[],
): ChatRow[] {
  return rowsOf(messages, outgoing).reverse();
}

/** The text a send would carry: trimmed; null when empty or past the limit. */
export function sendableText(input: string): string | null {
  const text = input.trim();
  if (text === '' || chatLength(text) > CHAT_LIMITS.messageMax) return null;
  return text;
}

/** How many characters of the limit are left; negative past it. */
export function charsLeft(input: string): number {
  return CHAT_LIMITS.messageMax - chatLength(input.trim());
}
