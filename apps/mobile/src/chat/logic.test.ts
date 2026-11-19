import { CHAT_LIMITS } from '@tugeel/shared/chat';
import { describe, expect, it } from 'vitest';
import {
  type ChatMessage,
  type ChatState,
  charsLeft,
  invertedRowsOf,
  mergeMessages,
  mergeOpened,
  newestId,
  outgoingOf,
  pendingOutgoing,
  rowsOf,
  sendableText,
  sendFailureOf,
  withLive,
  withOlder,
  withSent,
} from './logic';

const message = (
  id: number,
  createdAt = '2026-11-19T02:00:00.000Z',
  body = `m${id}`,
): ChatMessage => ({
  id,
  conversationId: 1,
  sender: 'BOT',
  staffUserId: null,
  staffName: null,
  body,
  buttons: null,
  buttonId: null,
  flowNode: null,
  createdAt,
});

type C = { unread: number };
const state = (ids: number[], nextCursor: string | null = null, unread = 0): ChatState<C> => ({
  conversation: { unread },
  messages: ids.map((id) => message(id)),
  nextCursor,
});
const idsOf = (s: ChatState<C>) => s.messages.map((m) => m.id);

describe('chat messages (ADR-0224)', () => {
  it('merges by id, oldest first, the incoming copy winning', () => {
    const merged = mergeMessages(
      [message(2), message(1)],
      [message(3), message(2, undefined, 'new')],
    );
    expect(merged.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(merged[1]?.body).toBe('new');
  });

  it('keeps older pages over a refetched first page, with the cursor that reaches furthest back', () => {
    const held = state([1, 2, 3, 4], 'c-old');
    const fresh = state([3, 4, 5], 'c-fresh', 2);
    const merged = mergeOpened(held, fresh);
    expect(idsOf(merged)).toEqual([1, 2, 3, 4, 5]);
    expect(merged.nextCursor).toBe('c-old');
    expect(merged.conversation.unread).toBe(2);
    // Nothing held, or a fresh page that reaches further back: the fresh state.
    expect(mergeOpened(undefined, fresh)).toBe(fresh);
    expect(mergeOpened(state([5, 6], 'c-held'), state([1, 2, 6], 'c-fresh')).nextCursor).toBe(
      'c-fresh',
    );
  });

  it('adds an older page, a live message and a send’s answer', () => {
    expect(
      idsOf(withOlder(state([5, 6], 'x'), { data: [message(3), message(4)], nextCursor: null })),
    ).toEqual([3, 4, 5, 6]);
    expect(withOlder(state([5]), { data: [], nextCursor: null }).nextCursor).toBeNull();
    const live = withLive(state([1]), { conversation: { unread: 4 }, message: message(2) });
    expect(idsOf(live)).toEqual([1, 2]);
    expect(live.conversation.unread).toBe(4);
    // A conversation event carries no message.
    expect(idsOf(withLive(live, { conversation: { unread: 0 }, message: null }))).toEqual([1, 2]);
    // The live copy and the send's answer of the same message do not double it.
    expect(
      idsOf(withSent(live, { conversation: { unread: 0 }, messages: [message(2), message(3)] })),
    ).toEqual([1, 2, 3]);
  });
});

describe('the chat list rows', () => {
  it('opens each Ulaanbaatar day with its separator and puts what is on its way last', () => {
    // 23:30 UTC on the 18th is already the 19th in Ulaanbaatar (UTC+8).
    const messages = [
      message(1, '2026-11-18T01:00:00.000Z'),
      message(2, '2026-11-18T23:30:00.000Z'),
      message(3, '2026-11-19T02:00:00.000Z'),
    ];
    const pending = outgoingOf('k1', { text: 'hi' }, 'hi', new Date('2026-11-19T03:00:00.000Z'));
    const rows = rowsOf(messages, [pending]);
    expect(rows.map((row) => row.kind)).toEqual([
      'day',
      'message',
      'day',
      'message',
      'message',
      'outgoing',
    ]);
    expect(
      rows.filter((row) => row.kind === 'day').map((row) => (row.kind === 'day' ? row.day : '')),
    ).toEqual(['2026-11-18', '2026-11-19']);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
    expect(invertedRowsOf(messages, [pending])[0]?.kind).toBe('outgoing');
    expect(rowsOf([], [])).toEqual([]);
  });

  it('starts a message on its way as sending, and sorts a failure by its status', () => {
    expect(outgoingOf('k', { buttonId: 'BALANCE' }, 'Үлдэгдэл', new Date(0))).toMatchObject({
      status: 'sending',
      body: { buttonId: 'BALANCE' },
    });
    expect(sendFailureOf(429)).toBe('limited');
    expect(sendFailureOf(422)).toBe('refused');
    expect(sendFailureOf(0)).toBe('failed');
    expect(sendFailureOf(500)).toBe('failed');
  });
});

describe('what the input may send', () => {
  it('trims, and refuses an empty text and one past the limit (characters, not code units)', () => {
    expect(sendableText('  сайн уу \n')).toBe('сайн уу');
    expect(sendableText('   ')).toBeNull();
    expect(sendableText('a'.repeat(CHAT_LIMITS.messageMax))).not.toBeNull();
    expect(sendableText('a'.repeat(CHAT_LIMITS.messageMax + 1))).toBeNull();
    // An emoji is one character for the database, two UTF-16 units.
    expect(sendableText('😀'.repeat(CHAT_LIMITS.messageMax))).not.toBeNull();
    expect(charsLeft('abc')).toBe(CHAT_LIMITS.messageMax - 3);
    expect(charsLeft('a'.repeat(CHAT_LIMITS.messageMax + 2))).toBe(-2);
  });
});

describe('a message on its way and its live copy', () => {
  const mine = (id: number, body: string, buttonId: string | null = null): ChatMessage => ({
    ...message(id, undefined, body),
    sender: 'CUSTOMER',
    buttonId,
  });
  const when = new Date('2026-11-19T02:00:00.000Z');

  it('drops the outgoing copy once the stream delivers the same message', () => {
    const text = outgoingOf('k1', { text: 'hi' }, 'hi', when, 5);
    const button = outgoingOf('k2', { buttonId: 'BALANCE' }, 'Үлдэгдэл', when, 5);
    expect(newestId([message(3), message(5)])).toBe(5);
    expect(pendingOutgoing([message(5)], [text, button])).toEqual([text, button]);
    expect(pendingOutgoing([mine(6, 'hi')], [text, button])).toEqual([button]);
    expect(pendingOutgoing([mine(6, 'Үлдэгдэл', 'BALANCE')], [text, button])).toEqual([text]);
  });

  it('does not take an older message, another sender, a typed text for a button, or one twice', () => {
    const text = outgoingOf('k1', { text: 'hi' }, 'hi', when, 5);
    expect(pendingOutgoing([mine(4, 'hi')], [text])).toEqual([text]);
    expect(pendingOutgoing([{ ...mine(6, 'hi'), sender: 'STAFF' }], [text])).toEqual([text]);
    expect(pendingOutgoing([mine(6, 'hi', 'X')], [text])).toEqual([text]);
    // Two identical texts on their way: one live copy settles one of them.
    const again = outgoingOf('k2', { text: 'hi' }, 'hi', when, 5);
    expect(pendingOutgoing([mine(6, 'hi')], [text, again])).toEqual([again]);
  });

  it('keeps a refused text for the customer to read and discard', () => {
    const refused = {
      ...outgoingOf('k1', { text: 'hi' }, 'hi', when, 5),
      status: 'refused' as const,
    };
    expect(pendingOutgoing([mine(6, 'hi')], [refused])).toEqual([refused]);
    expect(sendFailureOf(422)).toBe('refused');
  });
});
