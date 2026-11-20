import { z } from 'zod';
import {
  type ElevenLabsConfig,
  type ElevenLabsConversation,
  ElevenLabsError,
  type ElevenLabsFetch,
} from './elevenlabs.types';

export const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io';
/** Reading a finished conversation (the reconcile job): no caller waits for it. */
export const ELEVENLABS_READ_TIMEOUT_MS = 15_000;

const SignedUrlAnswer = z.object({ signed_url: z.string().min(1) });

const ConversationAnswer = z.object({
  conversation_id: z.string().min(1),
  status: z.enum(['initiated', 'in-progress', 'processing', 'done', 'failed']),
  transcript: z
    .array(
      z.object({
        role: z.string(),
        message: z.string().nullish(),
        time_in_call_secs: z.number().nullish(),
      }),
    )
    .nullish(),
  metadata: z
    .object({
      call_duration_secs: z.number().nullish(),
      cost: z.number().nullish(),
    })
    .nullish(),
});

/** By name: the abort reason is a DOMException, which may come from another realm than `Error`. */
function isAbort(error: unknown): boolean {
  const name =
    typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

/**
 * ElevenLabs Agents over plain `fetch` (ADR-0232 #3, #11; no SDK, like `integrations/llm`): the
 * signed URL the Windows bridge opens its conversation with, and a finished conversation's
 * transcript. The key goes only into the `xi-api-key` header. No retry here: the caller decides.
 */
export class ElevenLabsClient {
  constructor(
    private readonly config: ElevenLabsConfig,
    private readonly fetchFn: ElevenLabsFetch,
  ) {}

  /**
   * `GET /v1/convai/conversation/get-signed-url` for the configured agent. The URL's lifetime is
   * undocumented: it is fetched for each call right before connecting and never kept.
   */
  async getSignedUrl(timeoutMs: number): Promise<string> {
    const url = `${this.base()}/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(this.config.agentId)}`;
    const answer = await this.get(url, timeoutMs, SignedUrlAnswer);
    return answer.signed_url;
  }

  /** `GET /v1/convai/conversations/:id`: the turns with a role of `user` or `agent`, in order. */
  async getConversation(
    conversationId: string,
    timeoutMs: number = ELEVENLABS_READ_TIMEOUT_MS,
  ): Promise<ElevenLabsConversation> {
    const url = `${this.base()}/v1/convai/conversations/${encodeURIComponent(conversationId)}`;
    const answer = await this.get(url, timeoutMs, ConversationAnswer);
    return {
      conversationId: answer.conversation_id,
      status: answer.status,
      transcript: (answer.transcript ?? []).flatMap((turn) =>
        turn.role === 'user' || turn.role === 'agent'
          ? [
              {
                role: turn.role,
                message: turn.message ?? '',
                timeInCallSecs: Math.max(0, turn.time_in_call_secs ?? 0),
              },
            ]
          : [],
      ),
      durationSecs: answer.metadata?.call_duration_secs ?? null,
      cost: answer.metadata?.cost ?? null,
    };
  }

  private base(): string {
    return this.config.baseUrl.replace(/\/+$/, '');
  }

  private async get<T>(url: string, timeoutMs: number, shape: z.ZodType<T>): Promise<T> {
    let response: Response;
    let payload: unknown;
    try {
      response = await this.fetchFn(url, {
        method: 'GET',
        headers: { 'xi-api-key': this.config.apiKey, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      payload = await response.json().catch((error: unknown) => {
        if (isAbort(error)) throw error;
        return undefined; // not JSON
      });
    } catch (error: unknown) {
      if (isAbort(error)) {
        throw new ElevenLabsError('TIMEOUT', `no answer within ${timeoutMs} ms`);
      }
      throw new ElevenLabsError('NETWORK', 'the provider could not be reached');
    }
    if (!response.ok) {
      throw new ElevenLabsError(
        'HTTP',
        `the provider answered HTTP ${response.status}`,
        response.status,
      );
    }
    const parsed = shape.safeParse(payload);
    if (!parsed.success) {
      throw new ElevenLabsError('INVALID_RESPONSE', 'the provider answered in an unexpected shape');
    }
    return parsed.data;
  }
}
