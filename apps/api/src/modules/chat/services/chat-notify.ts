import { sql } from 'drizzle-orm';
import type { Tx } from '../../../common/db/db.types';

/**
 * The chat's live notice (ADR-0224 #7): every write that changes what a chat screen shows — a
 * message, a hand-off, a read, a close — calls `notifyChat` inside its transaction. PostgreSQL
 * delivers a NOTIFY only when that transaction commits and to every listening connection of the
 * database, so the customer on one api replica and the staff member on another both hear it
 * (ADR-0192). Nothing here waits on a listener.
 */
export const CHAT_NOTICE_CHANNEL = 'bto_chat';

/** What changed: a conversation of a store, and the new message (null = no message, only state). */
export interface ChatNotice {
  conversationId: number;
  customerId: number;
  messageId: number | null;
}

/** Announces a change of a conversation at commit; one notice per new message. */
export async function notifyChat(tx: Tx, notice: ChatNotice): Promise<void> {
  const payload = `${notice.conversationId}:${notice.customerId}:${notice.messageId ?? 0}`;
  await tx.execute(sql`SELECT pg_notify(${CHAT_NOTICE_CHANNEL}, ${payload})`);
}

/** A received payload, or null for anything that does not parse (the hub then says `resync`). */
export function parseChatNotice(payload: string | undefined): ChatNotice | null {
  const match = /^([1-9][0-9]{0,15}):([1-9][0-9]{0,15}):(0|[1-9][0-9]{0,15})$/.exec(payload ?? '');
  if (!match) return null;
  const [, conversation = '', customer = '', message = ''] = match;
  const messageId = Number.parseInt(message, 10);
  return {
    conversationId: Number.parseInt(conversation, 10),
    customerId: Number.parseInt(customer, 10),
    messageId: messageId === 0 ? null : messageId,
  };
}
