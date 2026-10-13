import {
  AI_ANSWER_KINDS,
  AI_ANSWER_STATUSES,
  AI_QUESTION_MAX_LENGTH,
  AI_REPORT_NAME_MAX_LENGTH,
} from '@tugeel/shared/ai';
import { type SQL, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { LLM_PROVIDERS } from '../../common/config/env.schema';
import { users } from '../identity/schema';

// Tables owned by the ai module (docs/modules/ai.md, ADR-0045). Migration 0017_ai adds by hand the
// schema `ai` with the read-only views the assistant queries, and the guards that keep
// ai_questions append-only.

const id = () => bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity();
const ref = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const inList = (column: AnyPgColumn, values: readonly string[]): SQL =>
  sql`${column} IN (${sql.join(
    values.map((value) => sql.raw(`'${value}'`)),
    sql`, `,
  )})`;

/** A person's conversation with the assistant; only its owner sees it. */
export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id(),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    /** The first question, cut to fit the history list. */
    title: text('title').notNull(),
    createdAt: createdAt(),
    /** Moves with every question: the history lists the latest conversations first. */
    updatedAt: updatedAt(),
  },
  (t) => [
    index('ai_conversations_user_idx').on(t.userId, t.updatedAt.desc(), t.id.desc()),
    check('ai_conversations_title', sql`length(${t.title}) BETWEEN 1 AND 200`),
  ],
);

/**
 * One asked question and how it ended (append-only, like audit_log): the SQL that ran or was
 * refused, the model's note and summary, counts, duration and tokens. Result rows are never stored:
 * the SQL runs again to show them (ADR-0045 #8).
 */
export const aiQuestions = pgTable(
  'ai_questions',
  {
    id: id(),
    conversationId: ref('conversation_id')
      .notNull()
      .references(() => aiConversations.id),
    userId: ref('user_id')
      .notNull()
      .references(() => users.id),
    question: text('question').notNull(),
    /** NULL when the model gave no usable answer. */
    kind: text('kind', { enum: AI_ANSWER_KINDS }),
    status: text('status', { enum: AI_ANSWER_STATUSES }).notNull(),
    /** The query that ran (after a repair), or the one the guard refused. */
    sql: text('sql'),
    /** The model's note to the person (Mongolian): what it computed, or what it asks. */
    explanation: text('explanation'),
    /** Plain text written from the first rows. */
    summary: text('summary'),
    /** Why a question was REFUSED or FAILED: a guard reason, an SQLSTATE class or a model error. */
    errorCode: text('error_code'),
    /** Rows shown (at most AI_MAX_ROWS); NULL without a query. */
    rowCount: integer('row_count'),
    truncated: boolean('truncated').notNull().default(false),
    /** The model's first query failed and its second attempt was used. */
    repaired: boolean('repaired').notNull().default(false),
    durationMs: integer('duration_ms').notNull(),
    provider: text('provider', { enum: LLM_PROVIDERS }).notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    index('ai_questions_conversation_idx').on(t.conversationId, t.id),
    check('ai_questions_status', inList(t.status, AI_ANSWER_STATUSES)),
    check('ai_questions_kind', sql`${t.kind} IS NULL OR ${inList(t.kind, AI_ANSWER_KINDS)}`),
    check('ai_questions_provider', inList(t.provider, LLM_PROVIDERS)),
    check(
      'ai_questions_question',
      sql`length(${t.question}) BETWEEN 1 AND ${sql.raw(String(AI_QUESTION_MAX_LENGTH))}`,
    ),
    check(
      'ai_questions_answered',
      sql`${t.status} <> 'ANSWERED' OR (${t.sql} IS NOT NULL AND ${t.rowCount} IS NOT NULL)`,
    ),
    check(
      'ai_questions_counts',
      sql`${t.rowCount} >= 0 AND ${t.durationMs} >= 0 AND ${t.inputTokens} >= 0 AND ${t.outputTokens} >= 0`,
    ),
  ],
);

/**
 * A saved report: a name and SQL copied on the server from an answered question (never SQL from a
 * client). Every holder of `ai.ask` sees and runs it; its author or `ai.reports.manage` renames or
 * deletes it (soft delete, audited).
 */
export const aiReports = pgTable(
  'ai_reports',
  {
    id: id(),
    name: text('name').notNull(),
    sql: text('sql').notNull(),
    sourceQuestionId: ref('source_question_id')
      .notNull()
      .references(() => aiQuestions.id),
    createdBy: ref('created_by')
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: ref('deleted_by').references(() => users.id),
  },
  (t) => [
    index('ai_reports_live_idx')
      .on(t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} IS NULL`),
    check(
      'ai_reports_name',
      sql`length(btrim(${t.name})) BETWEEN 1 AND ${sql.raw(String(AI_REPORT_NAME_MAX_LENGTH))}`,
    ),
    check('ai_reports_deleted', sql`(${t.deletedAt} IS NULL) = (${t.deletedBy} IS NULL)`),
  ],
);
