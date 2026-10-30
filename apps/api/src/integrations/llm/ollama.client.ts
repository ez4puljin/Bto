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
  textOf,
} from './llm.types';

/** A local Ollama; from a container use http://host.docker.internal:11434/api. */
export const OLLAMA_BASE_URL = 'http://127.0.0.1:11434/api';

const ChatAnswer = z.object({
  model: z.string(),
  message: z.object({ content: z.string() }),
  done_reason: z.string().optional(),
  prompt_eval_count: z.number().optional(),
  eval_count: z.number().optional(),
});

/**
 * Ollama chat API (`POST /chat`, one answer, no streaming); `format` takes the JSON schema. No key
 * is needed locally; one is sent as a bearer token when configured (a proxy in front of Ollama).
 */
export class OllamaClient implements LlmClient {
  readonly provider = 'ollama' as const;
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
      endpoint(this.config.baseUrl ?? OLLAMA_BASE_URL, 'chat'),
      this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {},
      {
        model: this.config.model,
        messages: [
          { role: 'system', content: request.instructions },
          ...request.messages.map(ollamaMessage),
        ],
        stream: false,
        options: { num_predict: request.maxOutputTokens },
        ...(request.output && { format: request.output.schema }),
      },
      this.config.timeoutMs,
      ChatAnswer,
    );
    if (answer.done_reason === 'length') {
      throw new LlmError('INCOMPLETE', 'the answer stopped early (length)');
    }
    const text = answer.message.content;
    if (!text) throw new LlmError('INVALID_RESPONSE', 'the answer has no text');
    return {
      text,
      model: answer.model,
      usage: {
        inputTokens: answer.prompt_eval_count ?? 0,
        outputTokens: answer.eval_count ?? 0,
      },
    };
  }
}

/** A turn as Ollama's chat takes it: the text, with the images as base64 beside it. */
function ollamaMessage(message: LlmMessage) {
  if (typeof message.content === 'string') return message;
  const images = message.content.flatMap((part) => (part.type === 'image' ? [part.data] : []));
  return {
    role: message.role,
    content: textOf(message.content),
    ...(images.length > 0 && { images }),
  };
}
