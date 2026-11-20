/** `fetch` as the ElevenLabs client uses it; tests pass a scripted one, never the network. */
export type ElevenLabsFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The account's key and the agent that answers the phone; both from the environment only. */
export interface ElevenLabsConfig {
  apiKey: string;
  agentId: string;
  baseUrl: string;
}

export type ElevenLabsErrorCode =
  'NOT_CONFIGURED' | 'TIMEOUT' | 'NETWORK' | 'HTTP' | 'INVALID_RESPONSE';

/**
 * A refused or failed exchange. It carries a code and an HTTP status only: never the key, a signed
 * URL or a word of a conversation (ADR-0045 #7, ADR-0232 #11).
 */
export class ElevenLabsError extends Error {
  constructor(
    readonly code: ElevenLabsErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'ElevenLabsError';
  }
}

/** One turn of a finished conversation, as the provider kept it. */
export interface ElevenLabsTurn {
  role: 'user' | 'agent';
  /** The words; empty for a turn that only called a tool. */
  message: string;
  /** Seconds from the conversation's start. */
  timeInCallSecs: number;
}

/** `GET /v1/convai/conversations/:id`, the part Bto reads. */
export interface ElevenLabsConversation {
  conversationId: string;
  /** `done` once the provider finished processing; `failed` for a conversation that broke. */
  status: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';
  transcript: ElevenLabsTurn[];
  durationSecs: number | null;
  /** The provider's own cost figure for the conversation (its credits); null when not reported. */
  cost: number | null;
}
