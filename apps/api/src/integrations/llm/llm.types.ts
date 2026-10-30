import type { LlmProvider } from '../../common/config/env.schema';

export type { LlmProvider };

/** A part of a user turn: text, or an image as base64 bytes with their media type. */
export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/webp'; data: string };

/**
 * One turn of the conversation sent to the model; the instructions travel separately. A user turn
 * may be parts (text and images, ADR-0122); an assistant turn is text.
 */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string | LlmContentPart[];
}

/** The text of a turn, images left out (for providers and logs that take text only). */
export function textOf(content: LlmMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('\n');
}

/** A JSON schema the answer must follow (structured output); every provider enforces it. */
export interface LlmOutputSchema {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmRequest {
  /** The system prompt. */
  instructions: string;
  messages: LlmMessage[];
  /** Without a schema the model answers in plain text. */
  output?: LlmOutputSchema;
  /** Includes the reasoning tokens of reasoning models. */
  maxOutputTokens: number;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmResult {
  text: string;
  /** The model that answered, as the provider reports it. */
  model: string;
  usage: LlmUsage;
}

/** A large language model behind one of the providers of ADR-0045. */
export interface LlmClient {
  readonly provider: LlmProvider;
  readonly model: string;
  complete(request: LlmRequest): Promise<LlmResult>;
}

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  /** Everything before the endpoint name, e.g. https://api.openai.com/v1. */
  baseUrl?: string;
  timeoutMs: number;
}

/** `fetch` as the clients use it; tests pass a fake. */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export const LLM_ERROR_REASONS = [
  'TIMEOUT',
  'NETWORK',
  'HTTP',
  'REFUSED',
  'INCOMPLETE',
  'INVALID_RESPONSE',
] as const;
export type LlmErrorReason = (typeof LLM_ERROR_REASONS)[number];

/**
 * A failed model call. Carries no request or response body: prompts and answers may hold personal
 * data and are never logged (ADR-0045 #7). `providerCode` is the provider's short error code
 * (`invalid_api_key`, `rate_limit_exceeded`, …) when it sends one.
 */
export class LlmError extends Error {
  readonly reason: LlmErrorReason;
  readonly status?: number;
  readonly providerCode?: string;

  constructor(
    reason: LlmErrorReason,
    message: string,
    details: { status?: number; providerCode?: string } = {},
  ) {
    super(message);
    this.name = 'LlmError';
    this.reason = reason;
    this.status = details.status;
    this.providerCode = details.providerCode;
  }
}
