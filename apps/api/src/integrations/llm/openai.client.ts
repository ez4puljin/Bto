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

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

const ResponsesAnswer = z.object({
  model: z.string(),
  status: z.string(),
  incomplete_details: z.object({ reason: z.string().optional() }).nullish(),
  output: z.array(
    z.object({
      type: z.string(),
      content: z
        .array(
          z.object({
            type: z.string(),
            text: z.string().optional(),
            refusal: z.string().optional(),
          }),
        )
        .optional(),
    }),
  ),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }).nullish(),
});

/**
 * OpenAI Responses API (`POST /responses`). `store: false`: the provider keeps no copy of the
 * conversation for later retrieval (ADR-0045 #7). No temperature or reasoning settings: reasoning
 * models refuse them, and the model is chosen by configuration.
 */
export class OpenAiClient implements LlmClient {
  readonly provider = 'openai' as const;
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
      endpoint(this.config.baseUrl ?? OPENAI_BASE_URL, 'responses'),
      { authorization: `Bearer ${this.config.apiKey ?? ''}` },
      {
        model: this.config.model,
        instructions: request.instructions,
        input: request.messages.map(openAiMessage),
        max_output_tokens: request.maxOutputTokens,
        store: false,
        ...(request.output && {
          text: {
            format: {
              type: 'json_schema',
              name: request.output.name,
              schema: request.output.schema,
              strict: true,
            },
          },
        }),
      },
      this.config.timeoutMs,
      ResponsesAnswer,
    );
    if (answer.status === 'incomplete') {
      throw new LlmError(
        'INCOMPLETE',
        `the answer stopped early (${answer.incomplete_details?.reason ?? 'unknown'})`,
      );
    }
    if (answer.status !== 'completed') {
      throw new LlmError('INVALID_RESPONSE', `the response ended as ${answer.status}`);
    }
    const parts = answer.output
      .filter((item) => item.type === 'message')
      .flatMap((item) => item.content ?? []);
    if (parts.some((part) => part.type === 'refusal')) {
      throw new LlmError('REFUSED', 'the model refused to answer');
    }
    const text = parts
      .filter((part) => part.type === 'output_text')
      .map((part) => part.text ?? '')
      .join('');
    if (!text) throw new LlmError('INVALID_RESPONSE', 'the answer has no text');
    return {
      text,
      model: answer.model,
      usage: {
        inputTokens: answer.usage?.input_tokens ?? 0,
        outputTokens: answer.usage?.output_tokens ?? 0,
      },
    };
  }
}

/** A turn as the Responses API takes it: text, or input parts with images as data URLs. */
function openAiMessage(message: LlmMessage) {
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: message.content.map((part) =>
      part.type === 'text'
        ? { type: 'input_text', text: part.text }
        : { type: 'input_image', image_url: `data:${part.mediaType};base64,${part.data}` },
    ),
  };
}
