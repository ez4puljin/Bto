import type { LlmClient, LlmRequest, LlmResult } from '../../src/integrations/llm';

type Scripted = Record<string, unknown> | string | Error;

/**
 * A scripted model for the AI assistant's tests (ADR-0045: tests never reach a provider). Answers
 * come out in the order they were queued: an object is sent as JSON, a string as plain text, an
 * Error is thrown. Every request is kept for assertions.
 */
export class FakeLlm implements LlmClient {
  readonly provider = 'openai' as const;
  readonly model = 'fake-model';
  readonly requests: LlmRequest[] = [];
  private readonly script: Scripted[] = [];

  enqueue(...answers: Scripted[]): this {
    this.script.push(...answers);
    return this;
  }

  get pending(): number {
    return this.script.length;
  }

  reset(): void {
    this.requests.length = 0;
    this.script.length = 0;
  }

  complete(request: LlmRequest): Promise<LlmResult> {
    this.requests.push(request);
    const next = this.script.shift();
    if (next === undefined) return Promise.reject(new Error('FakeLlm: no scripted answer'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      text: typeof next === 'string' ? next : JSON.stringify(next),
      model: 'fake-model-2026',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  }
}

export const query = (sql: string, explanation = 'Хүснэгт') => ({
  kind: 'query',
  sql,
  explanation,
});
export const clarify = (explanation: string) => ({ kind: 'clarify', sql: '', explanation });
export const unsupported = (explanation: string) => ({ kind: 'unsupported', sql: '', explanation });
