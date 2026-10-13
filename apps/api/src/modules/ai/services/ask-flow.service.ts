import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AiAnswerKind, AiAnswerStatus } from '@tugeel/shared/ai';
import { businessDate } from '@tugeel/shared/time';
import { AppError } from '../../../common/errors/app-error';
import { LLM_CLIENT, type LlmClient, LlmError, type LlmMessage } from '../../../integrations/llm';
import type { AuthContext } from '../../identity';
import {
  ANSWER_SCHEMA,
  buildInstructions,
  buildRepairTurn,
  buildSummaryRequest,
  buildUserTurn,
  type ModelAnswer,
  parseAnswer,
} from '../semantic/prompt';
import { AiQueryError, AiReaderService, type AiResult } from '../sql/ai-reader.service';
import { type AiQuestionView, ConversationsService } from './conversations.service';

const GENERATE_TOKENS = 8_000;
const SUMMARY_TOKENS = 3_000;

export interface AiStatus {
  /** Questions can be asked: a provider and the read-only database are configured. */
  configured: boolean;
  /** Saved reports can run: the read-only database is configured. */
  database: boolean;
  provider: string | null;
  model: string | null;
}

export interface AiAnswer {
  conversationId: number;
  question: AiQuestionView;
  /** The rows (never stored: an idempotent replay leaves them out). */
  result: AiResult | null;
}

/** Where a question ended before it is logged. */
interface Outcome {
  status: AiAnswerStatus;
  kind: AiAnswerKind | null;
  sql: string | null;
  explanation: string | null;
  errorCode: string | null;
  repaired: boolean;
  result: AiResult | null;
}

class Usage {
  inputTokens = 0;
  outputTokens = 0;
  model = '';
}

/**
 * The question flow of the AI assistant (ADR-0045 #6), a flow service: model calls happen
 * between transactions, the log is one short transaction at the end. A question becomes one
 * guarded query; a refusal or a query mistake goes back to the model once; rows get a short
 * Mongolian summary. Prompts, answers and rows are never logged.
 */
@Injectable()
export class AskFlowService {
  private readonly logger = new Logger(AskFlowService.name);

  constructor(
    @Inject(LLM_CLIENT) private readonly llm: LlmClient | null,
    private readonly reader: AiReaderService,
    private readonly conversations: ConversationsService,
  ) {}

  status(): AiStatus {
    return {
      configured: this.llm !== null && this.reader.configured,
      database: this.reader.configured,
      provider: this.llm?.provider ?? null,
      model: this.llm?.model ?? null,
    };
  }

  async ask(
    actor: AuthContext,
    input: { conversationId?: number; question: string },
  ): Promise<AiAnswer> {
    const llm = this.llm;
    if (!llm || !this.reader.configured) {
      throw new AppError('AI_NOT_CONFIGURED', 'the AI assistant is not configured');
    }
    const started = Date.now();
    const question = input.question.trim();
    const history =
      input.conversationId === undefined
        ? []
        : await this.conversations.history(actor, input.conversationId);
    const usage = new Usage();
    const instructions = buildInstructions(businessDate());
    const turn: LlmMessage = { role: 'user', content: buildUserTurn(question, history) };
    const first = await this.generate(llm, instructions, [turn], usage);
    const outcome = await this.outcomeOf(llm, instructions, turn, first, usage);
    const summary =
      outcome.status === 'ANSWERED' && outcome.result && outcome.result.rows.length > 0
        ? await this.summarize(llm, question, outcome, usage)
        : null;
    const saved = await this.conversations.record(actor, {
      conversationId: input.conversationId ?? null,
      question,
      kind: outcome.kind,
      status: outcome.status,
      sql: outcome.sql,
      explanation: outcome.explanation,
      summary,
      errorCode: outcome.errorCode,
      rowCount: outcome.result ? outcome.result.rows.length : null,
      truncated: outcome.result?.truncated ?? false,
      repaired: outcome.repaired,
      durationMs: Date.now() - started,
      provider: llm.provider,
      model: usage.model || llm.model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });
    return {
      conversationId: saved.conversationId,
      question: saved.question,
      result: outcome.result,
    };
  }

  /** Runs the model's query; one repair after a guard refusal or a query mistake. */
  private async outcomeOf(
    llm: LlmClient,
    instructions: string,
    turn: LlmMessage,
    first: ModelAnswer,
    usage: Usage,
  ): Promise<Outcome> {
    if (first.kind !== 'query') return withoutQuery(first, false);
    try {
      return answered(first.sql, first.explanation, await this.reader.run(first.sql), false);
    } catch (error: unknown) {
      if (!(error instanceof AiQueryError)) throw error;
      if (!error.repairable) return failed(first, error, false);
      let second: ModelAnswer;
      try {
        second = await this.generate(
          llm,
          instructions,
          [
            turn,
            { role: 'assistant', content: JSON.stringify(first) },
            { role: 'user', content: buildRepairTurn(error) },
          ],
          usage,
        );
      } catch (repairError: unknown) {
        if (repairError instanceof AppError) return failed(first, error, false);
        throw repairError;
      }
      if (second.kind !== 'query') return withoutQuery(second, true);
      try {
        return answered(second.sql, second.explanation, await this.reader.run(second.sql), true);
      } catch (again: unknown) {
        if (again instanceof AiQueryError) return failed(second, again, true);
        throw again;
      }
    }
  }

  /** One model call that must return an answer of the schema; a provider failure is a 502. */
  private async generate(
    llm: LlmClient,
    instructions: string,
    messages: LlmMessage[],
    usage: Usage,
  ): Promise<ModelAnswer> {
    try {
      const result = await llm.complete({
        instructions,
        messages,
        output: ANSWER_SCHEMA,
        maxOutputTokens: GENERATE_TOKENS,
      });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      usage.model = result.model;
      const answer = parseAnswer(result.text);
      if (!answer) throw new LlmError('INVALID_RESPONSE', 'the answer does not match the schema');
      return answer;
    } catch (error: unknown) {
      if (!(error instanceof LlmError)) throw error;
      this.logger.warn(
        { reason: error.reason, status: error.status, providerCode: error.providerCode },
        'AI provider failed',
      );
      throw new AppError('AI_PROVIDER_FAILED', error.message, {
        reason: error.reason,
        ...(error.status === undefined ? {} : { status: error.status }),
        ...(error.providerCode === undefined ? {} : { providerCode: error.providerCode }),
      });
    }
  }

  /** A short plain-text summary of the first rows; the answer stands without it on failure. */
  private async summarize(
    llm: LlmClient,
    question: string,
    outcome: Outcome,
    usage: Usage,
  ): Promise<string | null> {
    if (!outcome.result) return null;
    try {
      const request = buildSummaryRequest(question, outcome.explanation, outcome.result);
      const result = await llm.complete({ ...request, maxOutputTokens: SUMMARY_TOKENS });
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;
      const text = result.text.trim();
      return text ? text.slice(0, 4_000) : null;
    } catch (error: unknown) {
      if (!(error instanceof LlmError)) throw error;
      this.logger.warn({ reason: error.reason, status: error.status }, 'AI summary failed');
      return null;
    }
  }
}

function withoutQuery(answer: ModelAnswer, repaired: boolean): Outcome {
  const kind = answer.kind === 'clarify' ? 'CLARIFY' : 'UNSUPPORTED';
  return {
    status: kind,
    kind,
    sql: null,
    explanation: answer.explanation,
    errorCode: null,
    repaired,
    result: null,
  };
}

function answered(sql: string, explanation: string, result: AiResult, repaired: boolean): Outcome {
  return { status: 'ANSWERED', kind: 'QUERY', sql, explanation, errorCode: null, repaired, result };
}

function failed(answer: ModelAnswer, error: AiQueryError, repaired: boolean): Outcome {
  return {
    status: error.source === 'GUARD' ? 'REFUSED' : 'FAILED',
    kind: 'QUERY',
    sql: answer.sql,
    explanation: answer.explanation,
    errorCode: error.code,
    repaired,
    result: null,
  };
}
