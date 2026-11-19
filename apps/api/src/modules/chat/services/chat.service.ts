import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNotNull, lt, ne, type SQL, sql } from 'drizzle-orm';
import { DB } from '../../../common/db/db.tokens';
import type { Db, Tx } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { AppError, invalid, notFound } from '../../../common/errors/app-error';
import { decodeCursor, invalidCursor, toPage } from '../../../common/pagination/page';
import { type AuthContext, type CustomerContext, UserNamesService } from '../../identity';
import { CustomersService } from '../../partners';
import {
  CHAT_LIMITS,
  type ChatButton,
  chatButtonOfText,
  chatLength,
  type ChatListState,
  type ChatMode,
  type ChatSender,
} from '@tugeel/shared/chat';
import { chatConversations, chatMessages } from '../schema';
import { type BotReply, ChatBotService, type ChatFlow } from './chat-bot.service';
import { notifyChat } from './chat-notify';
import { type ChatRep, ChatRepsService, type ChatScope } from './chat-reps.service';

type ConversationRow = typeof chatConversations.$inferSelect;
type MessageRow = typeof chatMessages.$inferSelect;

/** A message as every chat screen shows it. */
export interface ChatMessageView {
  id: number;
  conversationId: number;
  sender: ChatSender;
  /** The staff member of a STAFF message, with the name shown beside it; null otherwise. */
  staffUserId: number | null;
  staffName: string | null;
  body: string;
  /** A BOT message's quick replies; null = none. */
  buttons: ChatButton[] | null;
  /** The button a CUSTOMER message pressed (or repeated by typing its label); null = free text. */
  buttonId: string | null;
  /** The step of the bot's flow that wrote a BOT message. */
  flowNode: string | null;
  createdAt: Date;
}

/** A conversation's state. */
export interface ChatConversationView {
  id: number;
  customerId: number;
  mode: ChatMode;
  /** With staff and the last word is the store's (or the hand-off): somebody should answer. */
  awaitingStaff: boolean;
  staffUnread: number;
  customerUnread: number;
  handedOffAt: Date | null;
  closedAt: Date | null;
  lastMessageId: number | null;
  lastMessageAt: Date | null;
}

export interface ChatMessagePage {
  /** Oldest first within the page. */
  data: ChatMessageView[];
  /** The cursor of the page of older messages; null = the conversation starts here. */
  nextCursor: string | null;
}

/** The store's side of a conversation. */
export interface CustomerChatState {
  conversation: ChatConversationView;
  /** The buttons the app offers now: the bot's latest, none while staff answer. */
  buttons: ChatButton[];
}

export interface CustomerChat extends CustomerChatState {
  messages: ChatMessageView[];
  nextCursor: string | null;
  /** «Залгах»: the store's sales rep, null when it stands on no rep's round. */
  rep: ChatRep | null;
}

/** A conversation in the staff list. */
export interface StaffChat {
  conversation: ChatConversationView;
  customerName: string;
  customerCode: string;
  lastMessage: ChatMessageView | null;
  /** The reps on whose round the store stands. */
  reps: { id: number; name: string }[];
}

export interface StaffChatQuery {
  state?: ChatListState;
  cursor?: string;
  limit?: number;
}

/** How often a send is tried again when staff took or closed the conversation meanwhile. */
const SEND_ATTEMPTS = 3;

const view = (row: ConversationRow): ChatConversationView => ({
  id: row.id,
  customerId: row.customerId,
  mode: row.mode,
  awaitingStaff: row.awaitingStaff,
  staffUnread: row.staffUnread,
  customerUnread: row.customerUnread,
  handedOffAt: row.handedOffAt,
  closedAt: row.closedAt,
  lastMessageId: row.lastMessageId,
  lastMessageAt: row.lastMessageAt,
});

/** The stored buttons of a message: only well-formed `{ id, label }` pairs come back. */
function buttonsOf(value: unknown): ChatButton[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((item: unknown) => {
    if (typeof item !== 'object' || item === null) return [];
    const { id, label } = item as { id?: unknown; label?: unknown };
    return typeof id === 'string' && typeof label === 'string' ? [{ id, label }] : [];
  });
}

/** A trimmed text a person wrote, 1 … `messageMax` characters, or 422. */
function writtenText(value: string | undefined): string {
  const text = value?.trim() ?? '';
  if (text.length === 0) throw invalid('text', 'isNotEmpty', 'a message needs a text');
  if (chatLength(text) > CHAT_LIMITS.messageMax) {
    throw invalid('text', 'maxLength', `at most ${CHAT_LIMITS.messageMax} characters`);
  }
  return text;
}

/**
 * The customer chat (ADR-0224): a store's one conversation, the bot's and the staff's answers,
 * the hand-off and the close. Every write is one transaction that locks the conversation row,
 * writes the messages, moves the counters and NOTIFYs the live streams (`notifyChat`); the bot's
 * answer is computed before it (it only reads) and dropped when the conversation moved meanwhile.
 * A customer is never an `Actor` here: the store's routes pass its `CustomerContext`, and the
 * customer id is always the token's own.
 */
@Injectable()
export class ChatService {
  private readonly flow: ChatFlow;

  constructor(
    @Inject(DB) private readonly db: Db,
    bot: ChatBotService,
    private readonly reps: ChatRepsService,
    private readonly users: UserNamesService,
    private readonly customers: CustomersService,
  ) {
    this.flow = bot;
  }

  // --- the store's side

  /**
   * Opens the store's conversation: creates it with the bot's greeting the first time, marks what
   * waited as read, and returns the newest messages with the buttons to offer and the rep to call.
   */
  async open(ctx: CustomerContext): Promise<CustomerChat> {
    let row = await this.ensure(ctx.customerId);
    if (row.customerUnread > 0) row = await this.readByCustomer(ctx);
    const page = await this.pageOf(row.id, {});
    return {
      ...(await this.customerState(row)),
      messages: page.data,
      nextCursor: page.nextCursor,
      rep: await this.reps.repOf(ctx.customerId),
    };
  }

  /** Older messages of the store's own conversation. */
  async history(
    ctx: CustomerContext,
    query: { cursor?: string; limit?: number },
  ): Promise<ChatMessagePage> {
    const row = await this.rowOf(ctx.customerId);
    return row ? this.pageOf(row.id, query) : { data: [], nextCursor: null };
  }

  /** How many messages reached the store unasked and unread; 0 before its first conversation. */
  async customerUnread(ctx: CustomerContext): Promise<number> {
    return (await this.rowOf(ctx.customerId))?.customerUnread ?? 0;
  }

  /** The store has seen everything: its unread count goes to 0. */
  async readByCustomer(ctx: CustomerContext): Promise<ConversationRow> {
    const row = await this.ensure(ctx.customerId);
    if (row.customerUnread === 0) return row;
    return inTransaction(this.db, async (tx) => {
      const [updated] = await tx
        .update(chatConversations)
        .set({ customerUnread: 0, updatedAt: sql`now()` })
        .where(eq(chatConversations.id, row.id))
        .returning();
      await notifyChat(tx, { conversationId: row.id, customerId: row.customerId, messageId: null });
      return updated ?? row;
    });
  }

  async readByCustomerState(ctx: CustomerContext): Promise<CustomerChatState> {
    return this.customerState(await this.readByCustomer(ctx));
  }

  /**
   * The store writes: a typed text, or a pressed button (`buttonId`, one the bot's latest buttons
   * offer; its label becomes the text). While the bot answers it replies in the same transaction
   * — a topic, the hand-off, or the buttons once more for a text that repeats none; while staff
   * answer the bot is silent and the message waits for them. 429 past `sendsPerMinute`.
   */
  async send(
    ctx: CustomerContext,
    input: { text?: string; buttonId?: string },
  ): Promise<CustomerChatState & { messages: ChatMessageView[] }> {
    if ((input.text === undefined) === (input.buttonId === undefined)) {
      throw invalid('text', 'oneOf', 'send a text or a buttonId, not both');
    }
    const typed = input.buttonId === undefined ? writtenText(input.text) : null;
    await this.ensure(ctx.customerId);
    for (let attempt = 1; attempt <= SEND_ATTEMPTS; attempt += 1) {
      const before = await this.rowOf(ctx.customerId);
      if (!before) break;
      const offered = await this.offeredButtons(before.id);
      const pressed =
        input.buttonId !== undefined
          ? offered.find((button) => button.id === input.buttonId)
          : undefined;
      if (input.buttonId !== undefined && !pressed) {
        throw invalid('buttonId', 'offered', 'not one of the buttons the bot offers now');
      }
      const body = pressed?.label ?? typed ?? '';
      const buttonId = pressed?.id ?? chatButtonOfText(body, offered);
      const reply =
        before.mode === 'BOT'
          ? await this.flow.answer(ctx.customerId, buttonId, await this.afterFallback(before.id))
          : null;
      const written = await inTransaction(this.db, async (tx) => {
        const locked = await this.lock(tx, before.id);
        // Staff took or closed it since the bot's answer was computed: read again.
        if (locked.mode !== before.mode) return null;
        await this.assertSendRate(tx, locked.id);
        const own = await this.write(tx, locked.id, {
          sender: 'CUSTOMER',
          customerUserId: ctx.customerUserId,
          body,
          buttonId,
        });
        const answer = reply ? await this.write(tx, locked.id, botMessage(reply)) : null;
        const withStaff = locked.mode === 'STAFF' || reply?.handOff === true;
        const last = answer ?? own;
        const [row] = await tx
          .update(chatConversations)
          .set({
            mode: withStaff ? 'STAFF' : 'BOT',
            handedOffAt: withStaff ? (locked.handedOffAt ?? sql`now()`) : null,
            awaitingStaff: withStaff,
            staffUnread: withStaff ? locked.staffUnread + 1 : 0,
            lastMessageId: last.id,
            lastMessageAt: last.createdAt,
            updatedAt: sql`now()`,
          })
          .where(eq(chatConversations.id, locked.id))
          .returning();
        for (const message of answer ? [own, answer] : [own]) {
          await notifyChat(tx, {
            conversationId: locked.id,
            customerId: locked.customerId,
            messageId: message.id,
          });
        }
        return { row: row ?? locked, messages: answer ? [own, answer] : [own] };
      });
      if (written) {
        return {
          ...(await this.customerState(written.row)),
          messages: await this.messageViews(written.messages),
        };
      }
    }
    throw new AppError('CONFLICT', 'the conversation kept changing; send again');
  }

  // --- the staff's side

  /** The conversations the caller may answer, the latest message first. */
  async list(
    ctx: AuthContext,
    query: StaffChatQuery,
  ): Promise<{ data: StaffChat[]; nextCursor: string | null }> {
    const scope = await this.reps.scopeOf(ctx);
    const limit = Math.min(query.limit ?? CHAT_LIMITS.pageDefault, CHAT_LIMITS.pageMax);
    const cursor = decodeCursor(query.cursor);
    if (cursor !== undefined && typeof cursor.id !== 'number') throw invalidCursor();
    const inScope = scopeFilter(scope);
    if (inScope === null) return { data: [], nextCursor: null };
    const state = query.state ?? 'STAFF';
    const rows = await this.db
      .select()
      .from(chatConversations)
      .where(
        and(
          isNotNull(chatConversations.lastMessageId),
          inScope,
          state === 'WAITING' ? eq(chatConversations.awaitingStaff, true) : undefined,
          state === 'STAFF' ? eq(chatConversations.mode, 'STAFF') : undefined,
          typeof cursor?.id === 'number'
            ? lt(chatConversations.lastMessageId, cursor.id)
            : undefined,
        ),
      )
      .orderBy(desc(chatConversations.lastMessageId))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.lastMessageId ?? 0 }));
    return { data: await this.staffChats(page.data), nextCursor: page.nextCursor };
  }

  /** One conversation the caller may answer; 404 for any other, as for one that does not exist. */
  async get(ctx: AuthContext, id: number): Promise<StaffChat> {
    return this.staffChat(await this.visible(ctx, id));
  }

  async messages(
    ctx: AuthContext,
    id: number,
    query: { cursor?: string; limit?: number },
  ): Promise<ChatMessagePage> {
    return this.pageOf((await this.visible(ctx, id)).id, query);
  }

  /** What waits for the caller: conversations awaiting an answer, and unread customer messages. */
  async staffUnread(ctx: AuthContext): Promise<{ waiting: number; unread: number }> {
    const inScope = scopeFilter(await this.reps.scopeOf(ctx));
    if (inScope === null) return { waiting: 0, unread: 0 };
    const [row] = await this.db
      .select({
        waiting: sql<number>`(count(*) FILTER (WHERE ${chatConversations.awaitingStaff}))::int`,
        unread: sql<number>`coalesce(sum(${chatConversations.staffUnread}), 0)::int`,
      })
      .from(chatConversations)
      .where(and(eq(chatConversations.mode, 'STAFF'), inScope));
    return { waiting: row?.waiting ?? 0, unread: row?.unread ?? 0 };
  }

  /**
   * A staff member answers. A conversation still with the bot is taken over by the answer
   * (ADR-0224 #6): from then on the bot is silent until somebody closes it.
   */
  async reply(
    ctx: AuthContext,
    id: number,
    input: { text?: string },
  ): Promise<{ chat: StaffChat; message: ChatMessageView }> {
    const text = writtenText(input.text);
    const before = await this.visible(ctx, id);
    const written = await inTransaction(this.db, async (tx) => {
      const locked = await this.lock(tx, before.id);
      const message = await this.write(tx, locked.id, {
        sender: 'STAFF',
        staffUserId: ctx.userId,
        body: text,
      });
      const [row] = await tx
        .update(chatConversations)
        .set({
          mode: 'STAFF',
          handedOffAt: locked.handedOffAt ?? sql`now()`,
          awaitingStaff: false,
          staffUnread: 0,
          customerUnread: locked.customerUnread + 1,
          lastMessageId: message.id,
          lastMessageAt: message.createdAt,
          updatedAt: sql`now()`,
        })
        .where(eq(chatConversations.id, locked.id))
        .returning();
      await notifyChat(tx, {
        conversationId: locked.id,
        customerId: locked.customerId,
        messageId: message.id,
      });
      return { row: row ?? locked, message };
    });
    const [message] = await this.messageViews([written.message]);
    if (!message) throw notFound('chat message', written.message.id);
    return { chat: await this.staffChat(written.row), message };
  }

  /** The staff have seen the store's messages: the conversation's unread count goes to 0. */
  async readByStaff(ctx: AuthContext, id: number): Promise<StaffChat> {
    const before = await this.visible(ctx, id);
    if (before.staffUnread === 0) return this.staffChat(before);
    const row = await inTransaction(this.db, async (tx) => {
      const [updated] = await tx
        .update(chatConversations)
        .set({ staffUnread: 0, updatedAt: sql`now()` })
        .where(eq(chatConversations.id, before.id))
        .returning();
      await notifyChat(tx, {
        conversationId: before.id,
        customerId: before.customerId,
        messageId: null,
      });
      return updated ?? before;
    });
    return this.staffChat(row);
  }

  /**
   * A staff member closes the conversation (ADR-0224 #6): it goes back to the bot, which says so
   * with its buttons; the history stays. Closing one the bot already answers changes nothing.
   */
  async close(ctx: AuthContext, id: number): Promise<StaffChat> {
    const before = await this.visible(ctx, id);
    const note = await this.flow.closed();
    const row = await inTransaction(this.db, async (tx) => {
      const locked = await this.lock(tx, before.id);
      if (locked.mode === 'BOT') return locked;
      const message = await this.write(tx, locked.id, botMessage(note));
      const [updated] = await tx
        .update(chatConversations)
        .set({
          mode: 'BOT',
          handedOffAt: null,
          awaitingStaff: false,
          staffUnread: 0,
          customerUnread: locked.customerUnread + 1,
          closedAt: sql`now()`,
          closedBy: ctx.userId,
          lastMessageId: message.id,
          lastMessageAt: message.createdAt,
          updatedAt: sql`now()`,
        })
        .where(eq(chatConversations.id, locked.id))
        .returning();
      await notifyChat(tx, {
        conversationId: locked.id,
        customerId: locked.customerId,
        messageId: message.id,
      });
      return updated ?? locked;
    });
    return this.staffChat(row);
  }

  // --- the live hub's reads

  /** A conversation and one of its messages as both sides' streams carry them; null when gone. */
  async snapshot(
    conversationId: number,
    messageId: number | null,
  ): Promise<{
    customer: CustomerChatState;
    staff: StaffChat;
    message: ChatMessageView | null;
  } | null> {
    const [row] = await this.db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, conversationId));
    if (!row) return null;
    const rows =
      messageId === null
        ? []
        : await this.db
            .select()
            .from(chatMessages)
            .where(
              and(eq(chatMessages.id, messageId), eq(chatMessages.conversationId, conversationId)),
            );
    const [message] = await this.messageViews(rows);
    return {
      customer: await this.customerState(row),
      staff: await this.staffChat(row),
      message: message ?? null,
    };
  }

  // --- shared

  private async rowOf(
    customerId: number,
    executor: Db | Tx = this.db,
  ): Promise<ConversationRow | null> {
    const [row] = await executor
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.customerId, customerId));
    return row ?? null;
  }

  /** The store's conversation, created with the bot's greeting when it has none yet. */
  private async ensure(customerId: number): Promise<ConversationRow> {
    const existing = await this.rowOf(customerId);
    if (existing) return existing;
    const greeting = await this.flow.greet(customerId);
    return inTransaction(this.db, async (tx) => {
      const [created] = await tx
        .insert(chatConversations)
        .values({ customerId })
        .onConflictDoNothing({ target: chatConversations.customerId })
        .returning();
      if (!created) {
        // Another request of the same store made it first.
        const other = await this.rowOf(customerId, tx);
        if (!other) throw new AppError('CONFLICT', 'the conversation could not be opened');
        return other;
      }
      const message = await this.write(tx, created.id, botMessage(greeting));
      const [row] = await tx
        .update(chatConversations)
        .set({ lastMessageId: message.id, lastMessageAt: message.createdAt })
        .where(eq(chatConversations.id, created.id))
        .returning();
      await notifyChat(tx, { conversationId: created.id, customerId, messageId: message.id });
      return row ?? created;
    });
  }

  private async visible(ctx: AuthContext, id: number): Promise<ConversationRow> {
    const scope = await this.reps.scopeOf(ctx);
    const [row] = await this.db
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, id));
    if (!row || (!scope.all && !scope.customerIds.has(row.customerId))) {
      throw notFound('chat conversation', id);
    }
    return row;
  }

  private async lock(tx: Tx, id: number): Promise<ConversationRow> {
    const [row] = await tx
      .select()
      .from(chatConversations)
      .where(eq(chatConversations.id, id))
      .for('update');
    if (!row) throw notFound('chat conversation', id);
    return row;
  }

  private async write(
    tx: Tx,
    conversationId: number,
    values: Omit<typeof chatMessages.$inferInsert, 'conversationId'>,
  ): Promise<MessageRow> {
    const [row] = await tx
      .insert(chatMessages)
      .values({ ...values, conversationId })
      .returning();
    if (!row) throw new AppError('CONFLICT', 'the message was not written');
    return row;
  }

  /** 429 when the store already sent `sendsPerMinute` messages within the last minute. */
  private async assertSendRate(tx: Tx, conversationId: number): Promise<void> {
    const [recent] = await tx
      .select({ n: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          eq(chatMessages.sender, 'CUSTOMER'),
          sql`${chatMessages.createdAt} > now() - interval '1 minute'`,
        ),
      );
    if ((recent?.n ?? 0) >= CHAT_LIMITS.sendsPerMinute) {
      throw new AppError('TOO_MANY_REQUESTS', 'too many chat messages within a minute', {
        limit: CHAT_LIMITS.sendsPerMinute,
      });
    }
  }

  /** The buttons of the bot's latest message that carries any. */
  private async offeredButtons(conversationId: number): Promise<ChatButton[]> {
    const [row] = await this.db
      .select({ buttons: chatMessages.buttons })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          eq(chatMessages.sender, 'BOT'),
          isNotNull(chatMessages.buttons),
        ),
      )
      .orderBy(desc(chatMessages.id))
      .limit(1);
    return buttonsOf(row?.buttons) ?? [];
  }

  /** True when the last word that was not the store's is the bot's «choose a button». */
  private async afterFallback(conversationId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ sender: chatMessages.sender, flowNode: chatMessages.flowNode })
      .from(chatMessages)
      .where(
        and(eq(chatMessages.conversationId, conversationId), ne(chatMessages.sender, 'CUSTOMER')),
      )
      .orderBy(desc(chatMessages.id))
      .limit(1);
    return row?.sender === 'BOT' && row.flowNode === 'FALLBACK';
  }

  private async customerState(row: ConversationRow): Promise<CustomerChatState> {
    return {
      conversation: view(row),
      buttons: row.mode === 'BOT' ? await this.offeredButtons(row.id) : [],
    };
  }

  /** A page of a conversation: the newest messages, or those older than the cursor. */
  private async pageOf(
    conversationId: number,
    query: { cursor?: string; limit?: number },
  ): Promise<ChatMessagePage> {
    const limit = Math.min(query.limit ?? CHAT_LIMITS.pageDefault, CHAT_LIMITS.pageMax);
    const cursor = decodeCursor(query.cursor);
    if (cursor !== undefined && typeof cursor.id !== 'number') throw invalidCursor();
    const rows = await this.db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.conversationId, conversationId),
          typeof cursor?.id === 'number' ? lt(chatMessages.id, cursor.id) : undefined,
        ),
      )
      .orderBy(desc(chatMessages.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return {
      data: (await this.messageViews(page.data)).reverse(),
      nextCursor: page.nextCursor,
    };
  }

  private async messageViews(rows: readonly MessageRow[]): Promise<ChatMessageView[]> {
    const names = await this.users.namesOf(
      rows.flatMap((row) => (row.staffUserId === null ? [] : [row.staffUserId])),
    );
    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      sender: row.sender,
      staffUserId: row.staffUserId,
      staffName: row.staffUserId === null ? null : (names.get(row.staffUserId) ?? null),
      body: row.body,
      buttons: buttonsOf(row.buttons),
      buttonId: row.buttonId,
      flowNode: row.flowNode,
      createdAt: row.createdAt,
    }));
  }

  private async staffChat(row: ConversationRow): Promise<StaffChat> {
    const [chat] = await this.staffChats([row]);
    if (!chat) throw notFound('chat conversation', row.id);
    return chat;
  }

  private async staffChats(rows: readonly ConversationRow[]): Promise<StaffChat[]> {
    if (rows.length === 0) return [];
    const customerIds = rows.map((row) => row.customerId);
    const customers = new Map(
      (await this.customers.getMany(customerIds)).map((customer) => [customer.id, customer]),
    );
    const lastIds = rows.flatMap((row) => (row.lastMessageId === null ? [] : [row.lastMessageId]));
    const last = new Map(
      (lastIds.length === 0
        ? []
        : await this.messageViews(
            await this.db.select().from(chatMessages).where(inArray(chatMessages.id, lastIds)),
          )
      ).map((message) => [message.id, message]),
    );
    const reps = await this.reps.repsOf(customerIds);
    return rows.map((row) => ({
      conversation: view(row),
      customerName: customers.get(row.customerId)?.name ?? '',
      customerCode: customers.get(row.customerId)?.code ?? '',
      lastMessage: row.lastMessageId === null ? null : (last.get(row.lastMessageId) ?? null),
      reps: (reps.get(row.customerId) ?? []).map((rep) => ({ id: rep.id, name: rep.name })),
    }));
  }
}

function botMessage(reply: BotReply): Omit<typeof chatMessages.$inferInsert, 'conversationId'> {
  return { sender: 'BOT', body: reply.body, buttons: reply.buttons, flowNode: reply.node };
}

/** The scope as a filter on the conversations; null = the caller's scope holds no store. */
function scopeFilter(scope: ChatScope): SQL | undefined | null {
  if (scope.all) return undefined;
  if (scope.customerIds.size === 0) return null;
  return inArray(chatConversations.customerId, [...scope.customerIds]);
}
