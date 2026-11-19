import type { components } from '@tugeel/api-client';
import type { ChatListState } from '@tugeel/shared/chat';

// The staff side of the chat's pure logic (ADR-0224): who sees the entry, which list a
// conversation belongs to, how a live conversation changes a loaded list, and the badge's number.
// No React, no network.

export type StaffChatConversation = components['schemas']['StaffChatConversation'];
export type StaffChatUnread = components['schemas']['StaffChatUnread'];

export const CHAT_ANSWER_RIGHT = 'chat.answer';
export const CHAT_ANSWER_OWN_RIGHT = 'chat.answer_own';

/** Who has the chat: a user with the wider right or the one for their own round's stores. */
export function mayAnswerChat(me: { permissions: readonly string[] }): boolean {
  return (
    me.permissions.includes(CHAT_ANSWER_RIGHT) || me.permissions.includes(CHAT_ANSWER_OWN_RIGHT)
  );
}

/** The list the staff opens on: the waiting ones when anything waits, else the ones with staff. */
export function defaultFilter(waiting: number): ChatListState {
  return waiting > 0 ? 'WAITING' : 'STAFF';
}

/** The number on the entry: the conversations waiting, or the unread messages when nothing waits. */
export function badgeOf(counts: { waiting: number; unread: number } | undefined): number {
  if (!counts) return 0;
  return counts.waiting > 0 ? counts.waiting : counts.unread;
}

/** Whether a conversation belongs in the list of a filter. */
export function inFilter(conversation: StaffChatConversation, filter: ChatListState): boolean {
  switch (filter) {
    case 'WAITING':
      return conversation.awaitingStaff;
    case 'STAFF':
      return conversation.mode === 'STAFF';
    case 'ALL':
      return true;
  }
}

const stamp = (conversation: StaffChatConversation): number => {
  const at = conversation.lastMessage?.createdAt ?? conversation.handedOffAt;
  return at ? Date.parse(at) : 0;
};

/** The server's order: the latest message first, the newest id breaking a tie. */
export function newestFirst(a: StaffChatConversation, b: StaffChatConversation): number {
  return stamp(b) - stamp(a) || (b.lastMessage?.id ?? 0) - (a.lastMessage?.id ?? 0) || b.id - a.id;
}

/**
 * A live (or answered) conversation put into the pages of one filter's list: taken out of wherever
 * it stood, and added again, in order, to the first page when it belongs there. When the list has
 * more pages and the conversation is older than the last one shown, it stays out (the next page
 * brings it), so only the head of the list is ever rewritten.
 */
export function withConversation<
  P extends { data: StaffChatConversation[]; nextCursor: string | null },
>(pages: readonly P[], conversation: StaffChatConversation, filter: ChatListState): P[] {
  const stripped = pages.map((page) => ({
    ...page,
    data: page.data.filter((one) => one.id !== conversation.id),
  }));
  const [first, ...rest] = stripped;
  if (!first || !inFilter(conversation, filter)) return stripped;
  const last = stripped.at(-1);
  const oldest = last?.data.at(-1);
  const moreBelow = last?.nextCursor != null;
  if (moreBelow && oldest && newestFirst(conversation, oldest) > 0) return stripped;
  return [{ ...first, data: [...first.data, conversation].sort(newestFirst) }, ...rest];
}

/** The first line of a message, for a list row. */
export function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .find((line) => line.trim() !== '')
      ?.trim() ?? ''
  );
}
