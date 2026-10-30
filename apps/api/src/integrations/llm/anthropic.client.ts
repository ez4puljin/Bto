import { z } from 'zod';
import { endpoint, postJson } from './http';
import {
  type FetchFn,
  type LlmClient,
  type LlmConfig,
  LlmError,
  type LlmMessage,
  type LlmRequest,
  type LlmResult,
} from './llm.types';

export const ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1';
export const ANTHROPIC_VERSION = '2023-06-01';

const MessagesAnswer = z.object({
  model: z.string(),
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

/** Anthropic Messages API (`POST /messages`) with JSON-schema structured output. */
export class AnthropicClient implements LlmClient {
  readonly provider = 'anthropic' as const;
  readonly model: string;

  constructor(
    private readonly config: LlmConfig,
    private readonly fetchFn: FetchFn,
  ) {
    this.model = config.model;
  }

  async complete(request: LlmRequest): Promise<LlmResult> {
    const answer = await postJson(
      this.fetchFn,
      endpoint(this.config.baseUrl ?? ANTHROPIC_BASE_URL, 'messages'),
      { 'x-api-key': this.config.apiKey ?? '', 'anthropic-version': ANTHROPIC_VERSION },
      {
        model: this.config.model,
        system: request.instructions,
        messages: request.messages.map(anthropicMessage),
        max_tokens: request.maxOutputTokens,
        ...(request.output && {
          output_config: { format: { type: 'json_schema', schema: request.output.schema } },
        }),
      },
      this.config.timeoutMs,
      MessagesAnswer,
    );
    if (answer.stop_reason === 'refusal') {
      throw new LlmError('REFUSED', 'the model refused to answer');
    }
    if (answer.stop_reason !== 'end_turn') {
      throw new LlmError(
        'INCOMPLETE',
        `the answer stopped early (${answer.stop_reason ?? 'none'})`,
      );
    }
    const text = answer.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');
    if (!text) throw new LlmError('INVALID_RESPONSE', 'the answer has no text');
    return {
      text,
      model: answer.model,
      usage: { inputTokens: answer.usage.input_tokens, outputTokens: answer.usage.output_tokens },
    };
  }
}

/** A turn as the Messages API takes it: a string, or content blocks with images as base64. */
function anthropicMessage(message: LlmMessage) {
  if (typeof message.content === 'string') return message;
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'text', text: part.text }
        : {
            type: 'image',
            source: { type: 'base64', media_type: part.mediaType, data: part.data },
          },
    ),
  };
}
