import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { jsonValue } from '../../common/db/types';
import { customerUsers, users } from '../identity/schema';
import { customers } from '../partners/schema';
import { CHAT_LIMITS, CHAT_MODES, CHAT_SENDERS } from '@tugeel/shared/chat';

// The tables owned by the chat module (docs/modules/chat.md, ADR-0224). Migration 0114_chat adds
// by hand: the REVOKE that leaves a written message unchangeable.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;
/** A limit from the shared rules, inlined: a bound parameter would not do in a CHECK. */
const lim = (value: number): SQL => sql.raw(String(value));
const textOrNull = (column: AnyPgColumn): SQL =>
  sql`${column} IS NULL OR char_length(${column}) BETWEEN 1 AND ${lim(CHAT_LIMITS.textMax)}`;

/**
 * The chat's settings, one row (ADR-0224 #2): the greeting and the two fixed texts the office
 * edits. A null text, or no row, means the built-in default (mn.json `chat.bot.defaults`).
 */
export const chatSettings = pgTable(
  'chat_settings',
  {
    id: smallint('id').primaryKey(),
    greeting: text('greeting'),
    deliveryText: text('delivery_text'),
    hoursText: text('hours_text'),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('chat_settings_single', sql`${t.id} = 1`),
    check('chat_settings_greeting', textOrNull(t.greeting)),
    check('chat_settings_delivery_text', textOrNull(t.deliveryText)),
    check('chat_settings_hours_text', textOrNull(t.hoursText)),
  ],
);

/**
 * A store's one conversation (ADR-0224 #1): it belongs to the customer, not to the app account, so
 * it outlives a changed sign-in phone. `mode` says who answers now; `awaiting_staff` is true from
 * the hand-off, and from every customer message while with staff, until a staff member answers.
 * `staff_unread` counts the customer's messages no staff member has seen since the hand-off;
 * `customer_unread` the messages that reached the store unasked (a staff answer, the closing
 * note). `last_message_id` orders the staff list (no foreign key: the message points here).
 */
export const chatConversations = pgTable(
  'chat_conversations',
  {
    id: id(),
    customerId: ref('customer_id')
      .notNull()
      .references(() => customers.id),
    mode: text('mode', { enum: CHAT_MODES }).notNull().default('BOT'),
    handedOffAt: timestamp('handed_off_at', { withTimezone: true }),
    awaitingStaff: boolean('awaiting_staff').notNull().default(false),
    staffUnread: integer('staff_unread').notNull().default(0),
    customerUnread: integer('customer_unread').notNull().default(0),
    lastMessageId: ref('last_message_id'),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    /** The last close: when and by whom; the history stays. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: userRef('closed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('chat_conversations_customer_key').on(t.customerId),
    index('chat_conversations_last_idx').on(t.lastMessageId),
    index('chat_conversations_staff_idx')
      .on(t.lastMessageId)
      .where(sql`${t.mode} = 'STAFF'`),
    check('chat_conversations_mode', inList(t.mode, CHAT_MODES)),
    check(
      'chat_conversations_handed_off',
      sql`(${t.mode} = 'STAFF') = (${t.handedOffAt} IS NOT NULL)`,
    ),
    check('chat_conversations_awaiting', sql`NOT ${t.awaitingStaff} OR ${t.mode} = 'STAFF'`),
    check('chat_conversations_unread', sql`${t.staffUnread} >= 0 AND ${t.customerUnread} >= 0`),
  ],
);

/**
 * A message (ADR-0224 #1): text, written once and never changed or removed. A BOT message may
 * carry `buttons` (`[{ id, label }]`) and names the step of the flow that wrote it (`flow_node`);
 * a CUSTOMER message that was a pressed button carries its id (`button_id`) and the label as its
 * text; a STAFF message names the staff member.
 */
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: id(),
    conversationId: ref('conversation_id')
      .notNull()
      .references(() => chatConversations.id),
    sender: text('sender', { enum: CHAT_SENDERS }).notNull(),
    staffUserId: userRef('staff_user_id'),
    customerUserId: ref('customer_user_id').references(() => customerUsers.id),
    body: text('body').notNull(),
    buttons: jsonValue('buttons'),
    buttonId: text('button_id'),
    flowNode: text('flow_node'),
    createdAt: createdAt(),
  },
  (t) => [
    index('chat_messages_conversation_idx').on(t.conversationId, t.id),
    check('chat_messages_sender', inList(t.sender, CHAT_SENDERS)),
    check(
      'chat_messages_body',
      sql`char_length(${t.body}) BETWEEN 1 AND ${lim(CHAT_LIMITS.bodyMax)}`,
    ),
    check('chat_messages_staff', sql`(${t.sender} = 'STAFF') = (${t.staffUserId} IS NOT NULL)`),
    check(
      'chat_messages_customer',
      sql`(${t.sender} = 'CUSTOMER') = (${t.customerUserId} IS NOT NULL)`,
    ),
    check(
      'chat_messages_buttons',
      sql`${t.buttons} IS NULL OR (${t.sender} = 'BOT' AND jsonb_typeof(${t.buttons}) = 'array')`,
    ),
    check(
      'chat_messages_button_id',
      sql`${t.buttonId} IS NULL OR (${t.sender} = 'CUSTOMER' AND char_length(${t.buttonId}) BETWEEN 1 AND ${lim(CHAT_LIMITS.buttonIdMax)})`,
    ),
    check(
      'chat_messages_flow_node',
      sql`${t.flowNode} IS NULL OR (${t.sender} = 'BOT' AND char_length(${t.flowNode}) BETWEEN 1 AND ${lim(CHAT_LIMITS.buttonIdMax)})`,
    ),
  ],
);
