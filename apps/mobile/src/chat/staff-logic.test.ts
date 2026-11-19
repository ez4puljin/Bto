import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './logic';
import { outgoingOf, pendingOutgoing } from './logic';
import {
  badgeOf,
  defaultFilter,
  firstLine,
  inFilter,
  mayAnswerChat,
  type StaffChatConversation,
  withConversation,
} from './staff-logic';

const message = (id: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  conversationId: 1,
  sender: 'CUSTOMER',
  staffUserId: null,
  staffName: null,
  body: 'x',
  buttons: null,
  buttonId: null,
  flowNode: null,
  createdAt: `2026-11-19T0${id}:00:00.000Z`,
  ...over,
});

const conversation = (
  id: number,
  over: Partial<StaffChatConversation> = {},
  at = id,
): StaffChatConversation => ({
  id,
  customerId: id,
  customerName: `Store ${id}`,
  customerCode: `C${id}`,
  mode: 'STAFF',
  awaitingStaff: false,
  unread: 0,
  handedOffAt: null,
  closedAt: null,
  lastMessage: message(at),
  reps: [],
  ...over,
});

const page = (data: StaffChatConversation[], nextCursor: string | null = null) => ({
  data,
  nextCursor,
});

describe('who has the chat', () => {
  it('needs chat.answer or chat.answer_own', () => {
    expect(mayAnswerChat({ permissions: ['sales.orders.rep'] })).toBe(false);
    expect(mayAnswerChat({ permissions: ['chat.answer'] })).toBe(true);
    expect(mayAnswerChat({ permissions: ['sales.orders.rep', 'chat.answer_own'] })).toBe(true);
  });
});

describe('the entry and the filters', () => {
  it('opens on the waiting ones when any wait, else on the ones with staff', () => {
    expect(defaultFilter(2)).toBe('WAITING');
    expect(defaultFilter(0)).toBe('STAFF');
  });

  it('shows waiting, or unread when nothing waits', () => {
    expect(badgeOf({ waiting: 3, unread: 9 })).toBe(3);
    expect(badgeOf({ waiting: 0, unread: 4 })).toBe(4);
    expect(badgeOf(undefined)).toBe(0);
  });

  it('puts a conversation in the lists it belongs to', () => {
    const bot = conversation(1, { mode: 'BOT' });
    const waiting = conversation(2, { awaitingStaff: true });
    expect(inFilter(bot, 'ALL')).toBe(true);
    expect(inFilter(bot, 'STAFF')).toBe(false);
    expect(inFilter(waiting, 'WAITING')).toBe(true);
    expect(inFilter(conversation(3), 'WAITING')).toBe(false);
  });

  it('takes the first non-empty line', () => {
    expect(firstLine('\n  hello \nworld')).toBe('hello');
    expect(firstLine('')).toBe('');
  });
});

describe('a live conversation in a loaded list', () => {
  it('moves an updated conversation to the top', () => {
    const pages = [page([conversation(3), conversation(2), conversation(1)])];
    const updated = conversation(1, {}, 9);
    const next = withConversation(pages, updated, 'STAFF');
    expect(next[0]?.data.map((one) => one.id)).toEqual([1, 3, 2]);
  });

  it('adds a new one and drops one that left the filter', () => {
    const pages = [page([conversation(2, { awaitingStaff: true })])];
    const added = withConversation(pages, conversation(3, { awaitingStaff: true }), 'WAITING');
    expect(added[0]?.data.map((one) => one.id)).toEqual([3, 2]);
    const answered = withConversation(
      added,
      conversation(3, { awaitingStaff: false }, 5),
      'WAITING',
    );
    expect(answered[0]?.data.map((one) => one.id)).toEqual([2]);
  });

  it('keeps an older unknown conversation out while more pages wait', () => {
    const pages = [page([conversation(5), conversation(4)], 'c')];
    expect(withConversation(pages, conversation(1), 'STAFF')[0]?.data.map((one) => one.id)).toEqual(
      [5, 4],
    );
    expect(withConversation(pages, conversation(9), 'STAFF')[0]?.data[0]?.id).toBe(9);
  });

  it('removes it from a later page when it moves up', () => {
    const pages = [page([conversation(5)], 'c'), page([conversation(2), conversation(1)])];
    const next = withConversation(pages, conversation(1, {}, 8), 'STAFF');
    expect(next[0]?.data.map((one) => one.id)).toEqual([1, 5]);
    expect(next[1]?.data.map((one) => one.id)).toEqual([2]);
  });
});

describe("a staff member's message on its way", () => {
  it('is settled by the same text from the same staff member only', () => {
    const sent = outgoingOf('k', { text: 'Сайн байна уу' }, 'Сайн байна уу', new Date(), 4);
    const other = message(5, { sender: 'STAFF', staffUserId: 8, body: 'Сайн байна уу' });
    const mine = message(6, { sender: 'STAFF', staffUserId: 7, body: 'Сайн байна уу' });
    const writer = { sender: 'STAFF' as const, staffUserId: 7 };
    expect(pendingOutgoing([other], [sent], writer)).toHaveLength(1);
    expect(pendingOutgoing([other, mine], [sent], writer)).toHaveLength(0);
  });
});
