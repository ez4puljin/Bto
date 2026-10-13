import { Inject, Injectable } from '@nestjs/common';
import { AI_CONTEXT_STEPS, type AiAnswerKind, type AiAnswerStatus } from '@tugeel/shared/ai';
import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { LlmProvider } from '../../../common/config/env.schema';
import { DB } from '../../../common/db/db.tokens';
import type { Db } from '../../../common/db/db.types';
import { inTransaction } from '../../../common/db/transaction';
import { notFound } from '../../../common/errors/app-error';
import { DEFAULT_PAGE_LIMIT, decodeCursor, toPage } from '../../../common/pagination/page';
import type { AuthContext } from '../../identity';
import { aiConversations, aiQuestions } from '../schema';
import type { HistoryStep } from '../semantic/prompt';

/** A logged question as the api shows it (never its rows). */
export interface AiQuestionView {
  id: number;
  conversationId: number;
  question: string;
  status: AiAnswerStatus;
  kind: AiAnswerKind | null;
  sql: string | null;
  explanation: string | null;
  summary: string | null;
  errorCode: string | null;
  rowCount: number | null;
  truncated: boolean;
  repaired: boolean;
  createdAt: Date;
}

export interface AiConversationView {
  id: number;
  title: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Everything the flow logs about one question (ADR-0045 #8). */
export interface QuestionRecord {
  conversationId: number | null;
  question: string;
  kind: AiAnswerKind | null;
  status: AiAnswerStatus;
  sql: string | null;
  explanation: string | null;
  summary: string | null;
  errorCode: string | null;
  rowCount: number | null;
  truncated: boolean;
  repaired: boolean;
  durationMs: number;
  provider: LlmProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

const TITLE_MAX = 120;

type QuestionRow = typeof aiQuestions.$inferSelect;

/**
 * Conversations and their question log. A conversation is its owner's alone: anyone else's is
 * 404. Questions are append-only; their rows are never stored.
 */
@Injectable()
export class ConversationsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The last steps of the actor's conversation, oldest first, for a follow-up question. */
  async history(actor: AuthContext, conversationId: number): Promise<HistoryStep[]> {
    await this.own(actor, conversationId);
    const rows = await this.db
      .select()
      .from(aiQuestions)
      .where(eq(aiQuestions.conversationId, conversationId))
      .orderBy(desc(aiQuestions.id))
      .limit(AI_CONTEXT_STEPS);
    return rows.reverse().map((row) => ({
      question: row.question,
      status: row.status,
      sql: row.status === 'ANSWERED' ? row.sql : null,
      answer: row.summary ?? row.explanation,
    }));
  }

  /** Logs a question in one short transaction, opening the conversation for a first one. */
  async record(
    actor: AuthContext,
    record: QuestionRecord,
  ): Promise<{ conversationId: number; question: AiQuestionView }> {
    return inTransaction(this.db, async (tx) => {
      let conversationId = record.conversationId;
      if (conversationId === null) {
        const [created] = await tx
          .insert(aiConversations)
          .values({ userId: actor.userId, title: titleOf(record.question) })
          .returning({ id: aiConversations.id });
        if (!created) throw new Error('conversation not created');
        conversationId = created.id;
      } else {
        const touched = await tx
          .update(aiConversations)
          .set({ updatedAt: sql`now()` })
          .where(
            and(eq(aiConversations.id, conversationId), eq(aiConversations.userId, actor.userId)),
          )
          .returning({ id: aiConversations.id });
        if (touched.length === 0) throw notFound('conversation', conversationId);
      }
      const { conversationId: _ignored, ...fields } = record;
      const [row] = await tx
        .insert(aiQuestions)
        .values({ ...fields, conversationId, userId: actor.userId })
        .returning();
      if (!row) throw new Error('question not logged');
      return { conversationId, question: questionView(row) };
    });
  }

  /** The actor's conversations, the latest active first. */
  async list(
    actor: AuthContext,
    query: { cursor?: string; limit?: number },
  ): Promise<{ data: AiConversationView[]; nextCursor: string | null }> {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const after = decodeCursor(query.cursor);
    const filters = [eq(aiConversations.userId, actor.userId)];
    if (typeof after?.id === 'number') {
      // The cursor names the last row; its own timestamp keeps the order exact to the microsecond.
      const last = sql`(SELECT c.updated_at FROM ai_conversations c WHERE c.id = ${after.id})`;
      const position = or(
        lt(aiConversations.updatedAt, last),
        and(eq(aiConversations.updatedAt, last), lt(aiConversations.id, after.id)),
      );
      if (position) filters.push(position);
    }
    const rows = await this.db
      .select()
      .from(aiConversations)
      .where(and(...filters))
      .orderBy(desc(aiConversations.updatedAt), desc(aiConversations.id))
      .limit(limit + 1);
    const page = toPage(rows, limit, (row) => ({ id: row.id }));
    return { data: page.data.map(conversationView), nextCursor: page.nextCursor };
  }

  /** One of the actor's conversations with every question, oldest first. */
  async get(
    actor: AuthContext,
    id: number,
  ): Promise<{ conversation: AiConversationView; questions: AiQuestionView[] }> {
    const conversation = await this.own(actor, id);
    const rows = await this.db
      .select()
      .from(aiQuestions)
      .where(eq(aiQuestions.conversationId, id))
      .orderBy(asc(aiQuestions.id));
    return { conversation: conversationView(conversation), questions: rows.map(questionView) };
  }

  /** One of the actor's own questions (anyone else's is 404). */
  async question(actor: AuthContext, id: number): Promise<AiQuestionView> {
    const [row] = await this.db
      .select()
      .from(aiQuestions)
      .where(and(eq(aiQuestions.id, id), eq(aiQuestions.userId, actor.userId)));
    if (!row) throw notFound('question', id);
    return questionView(row);
  }

  private async own(actor: AuthContext, id: number) {
    const [row] = await this.db
      .select()
      .from(aiConversations)
      .where(and(eq(aiConversations.id, id), eq(aiConversations.userId, actor.userId)));
    if (!row) throw notFound('conversation', id);
    return row;
  }
}

/** The first question, on one line and cut for the history list. */
function titleOf(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  return line.length > TITLE_MAX ? `${line.slice(0, TITLE_MAX - 1)}…` : line;
}

function questionView(row: QuestionRow): AiQuestionView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    question: row.question,
    status: row.status,
    kind: row.kind,
    sql: row.sql,
    explanation: row.explanation,
    summary: row.summary,
    errorCode: row.errorCode,
    rowCount: row.rowCount,
    truncated: row.truncated,
    repaired: row.repaired,
    createdAt: row.createdAt,
  };
}

function conversationView(row: typeof aiConversations.$inferSelect): AiConversationView {
  return { id: row.id, title: row.title, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
