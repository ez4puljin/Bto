import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { jsonValue } from '../../common/db/types';
import { users } from '../identity/schema';
import { customers } from '../partners/schema';
import { salesOrders } from '../sales/schema';
import {
  PHONE_CALL_OUTCOMES,
  PHONE_CALLBACK_STATUSES,
  PHONE_DECLINE_REASONS,
  PHONE_END_REASONS,
  PHONE_LIMITS,
  PHONE_MESSAGE_ROLES,
} from './phone-agent.rules';

// The tables owned by the phone-agent module (docs/modules/phone-agent.md, ADR-0232). Migration
// 0118_phone_agent adds by hand: the REVOKEs. A transcript is a business record, kept forever:
// `phone_call_messages` is append-only for the app role and no housekeeping deletes any of these.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const userRef = (name: string) => ref(name).references(() => users.id);
const at = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => at('created_at').notNull().defaultNow();
const updatedAt = () => at('updated_at').notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;
const lim = (value: number): SQL => sql.raw(String(value));
/** Mongolian numbers in E.164 (ADR-0005 #3); `[+]` avoids backslashes in SQL text. */
const phoneCheck = (column: AnyPgColumn) =>
  sql`${column} IS NULL OR ${column} ~ '^[+]976[0-9]{8}$'`;

/**
 * A phone line's station (ADR-0232 #2): the Windows bridge beside the Android phone. It calls the
 * api with a key, kept here as a sha-256 of the whole key. `schedule` holds the working hours in
 * which staff answer themselves (`PhoneSchedule`); outside them, while `active`, the AI answers.
 */
export const phoneLines = pgTable(
  'phone_lines',
  {
    id: id(),
    name: text('name').notNull(),
    active: boolean('active').notNull().default(false),
    schedule: jsonValue('schedule').notNull(),
    /** The agent's first sentence for this line; null = the agent's own configured greeting. */
    greeting: text('greeting'),
    keyHash: text('key_hash').notNull(),
    lastSeenAt: at('last_seen_at'),
    createdBy: userRef('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'phone_lines_name',
      sql`char_length(${t.name}) BETWEEN 1 AND ${lim(PHONE_LIMITS.nameMax)}`,
    ),
    check(
      'phone_lines_greeting',
      sql`${t.greeting} IS NULL OR char_length(${t.greeting}) BETWEEN 1 AND ${lim(PHONE_LIMITS.greetingMax)}`,
    ),
    check('phone_lines_schedule', sql`jsonb_typeof(${t.schedule}) = 'object'`),
  ],
);

/**
 * One incoming call the station reported (ADR-0232 #2). `call_ref` is Android's id, unique per
 * line. `caller_phone` is the number in E.164 when it is a Mongolian one, `caller_raw` what the
 * phone showed (both null when withheld). `answered` false: the phone rang for staff, with
 * `decline_reason`. `outcome` is set when the call ends; `cost_estimate` is what the provider
 * reported for the conversation (its credits), filled by the reconcile.
 */
export const phoneCalls = pgTable(
  'phone_calls',
  {
    id: id(),
    lineId: ref('line_id')
      .notNull()
      .references(() => phoneLines.id),
    callRef: text('call_ref').notNull(),
    callerPhone: text('caller_phone'),
    callerRaw: text('caller_raw'),
    customerId: ref('customer_id').references(() => customers.id),
    elConversationId: text('el_conversation_id'),
    answered: boolean('answered').notNull(),
    declineReason: text('decline_reason', { enum: PHONE_DECLINE_REASONS }),
    startedAt: at('started_at').notNull().defaultNow(),
    endedAt: at('ended_at'),
    endReason: text('end_reason', { enum: PHONE_END_REASONS }),
    durationS: integer('duration_s'),
    outcome: text('outcome', { enum: PHONE_CALL_OUTCOMES }),
    salesOrderId: ref('sales_order_id').references(() => salesOrders.id),
    /** The order's number by value: it never changes once the draft exists (ADR-0057). */
    orderNumber: text('order_number'),
    costEstimate: numeric('cost_estimate', { precision: 14, scale: 4 }),
    reconciledAt: at('reconciled_at'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('phone_calls_ref').on(t.lineId, t.callRef),
    index('phone_calls_customer_idx').on(t.customerId, t.id),
    index('phone_calls_order_idx').on(t.salesOrderId),
    index('phone_calls_open_idx')
      .on(t.startedAt)
      .where(sql`${t.endedAt} IS NULL`),
    check(
      'phone_calls_ref_length',
      sql`char_length(${t.callRef}) BETWEEN 1 AND ${lim(PHONE_LIMITS.callRefMax)}`,
    ),
    check('phone_calls_caller_phone', phoneCheck(t.callerPhone)),
    check(
      'phone_calls_caller_raw',
      sql`${t.callerRaw} IS NULL OR char_length(${t.callerRaw}) BETWEEN 1 AND 32`,
    ),
    check(
      'phone_calls_decline',
      sql`${t.declineReason} IS NULL OR (NOT ${t.answered} AND ${inList(t.declineReason, PHONE_DECLINE_REASONS)})`,
    ),
    check(
      'phone_calls_outcome',
      sql`${t.outcome} IS NULL OR ${inList(t.outcome, PHONE_CALL_OUTCOMES)}`,
    ),
    check(
      'phone_calls_end_reason',
      sql`${t.endReason} IS NULL OR ${inList(t.endReason, PHONE_END_REASONS)}`,
    ),
    check(
      'phone_calls_duration',
      sql`${t.durationS} IS NULL OR ${t.durationS} BETWEEN 0 AND ${lim(PHONE_LIMITS.durationMax)}`,
    ),
    check(
      'phone_calls_conversation',
      sql`${t.elConversationId} IS NULL OR char_length(${t.elConversationId}) BETWEEN 1 AND ${lim(PHONE_LIMITS.conversationIdMax)}`,
    ),
    // An order belongs to a recognised caller's call (ADR-0232 #4).
    check(
      'phone_calls_order_customer',
      sql`${t.salesOrderId} IS NULL OR ${t.customerId} IS NOT NULL`,
    ),
    check(
      'phone_calls_order_number',
      sql`(${t.salesOrderId} IS NULL) = (${t.orderNumber} IS NULL)`,
    ),
  ],
);

/**
 * A call's transcript, turn by turn (ADR-0232 #2): what the caller said (USER), what the agent
 * said (AGENT) and each tool call with its answer (TOOL). `seq` is the bridge's own numbering in
 * the order the provider delivered the events; `at_ms` counts from the call's start. `meta` holds
 * the source (BRIDGE or RECONCILED) and, for a tool, its name, arguments, answer, `no_hit` and
 * `quote_id`. Append-only: the app role may only insert and read.
 */
export const phoneCallMessages = pgTable(
  'phone_call_messages',
  {
    callId: ref('call_id')
      .notNull()
      .references(() => phoneCalls.id),
    seq: integer('seq').notNull(),
    role: text('role', { enum: PHONE_MESSAGE_ROLES }).notNull(),
    text: text('text').notNull(),
    atMs: integer('at_ms').notNull(),
    meta: jsonValue('meta').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.callId, t.seq] }),
    index('phone_call_messages_no_hit_idx')
      .on(t.callId, t.seq)
      .where(sql`${t.role} = 'TOOL' AND (${t.meta} ->> 'no_hit') = 'true'`),
    check('phone_call_messages_role', inList(t.role, PHONE_MESSAGE_ROLES)),
    check('phone_call_messages_seq', sql`${t.seq} BETWEEN 1 AND ${lim(PHONE_LIMITS.seqMax)}`),
    check('phone_call_messages_text', sql`char_length(${t.text}) <= ${lim(PHONE_LIMITS.textMax)}`),
    check('phone_call_messages_at', sql`${t.atMs} BETWEEN 0 AND ${lim(PHONE_LIMITS.atMsMax)}`),
    check('phone_call_messages_meta', sql`jsonb_typeof(${t.meta}) = 'object'`),
  ],
);

/**
 * A task for staff a call left (ADR-0232 #2): ring this number back. OPEN until someone marks it
 * DONE or DROPPED.
 */
export const phoneCallbacks = pgTable(
  'phone_callbacks',
  {
    id: id(),
    callId: ref('call_id')
      .notNull()
      .references(() => phoneCalls.id),
    phone: text('phone'),
    customerId: ref('customer_id').references(() => customers.id),
    reason: text('reason').notNull(),
    status: text('status', { enum: PHONE_CALLBACK_STATUSES }).notNull().default('OPEN'),
    doneBy: userRef('done_by'),
    doneAt: at('done_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('phone_callbacks_call_idx').on(t.callId),
    index('phone_callbacks_open_idx')
      .on(t.id)
      .where(sql`${t.status} = 'OPEN'`),
    check('phone_callbacks_status', inList(t.status, PHONE_CALLBACK_STATUSES)),
    check(
      'phone_callbacks_phone',
      sql`${t.phone} IS NULL OR char_length(${t.phone}) BETWEEN 1 AND 32`,
    ),
    check(
      'phone_callbacks_reason',
      sql`char_length(${t.reason}) BETWEEN 1 AND ${lim(PHONE_LIMITS.reasonMax)}`,
    ),
    check(
      'phone_callbacks_done',
      sql`(${t.status} = 'OPEN') = (${t.doneAt} IS NULL) AND (${t.doneAt} IS NULL) = (${t.doneBy} IS NULL)`,
    ),
  ],
);
