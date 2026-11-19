import {
  MAX_STREAM_TEXT,
  RETRY_MAX_MS,
  RETRY_MIN_MS,
  SILENCE_MS,
  type SseMessage,
  SseParser,
  type StreamTransport,
  xhrTransport,
} from '../api/live-stock';
import type { ChatMessage } from './logic';

// The chat's live stream (ADR-0224 #7) on the live stock's pattern (src/api/live-stock.ts): the
// server's event stream over XMLHttpRequest with the access token, opened again after its end, with
// backoff after a failure. The same reader serves the customer's stream and the staff's, which differ
// only in the path and in the conversation's shape (`C`).

/** The event a stream message carries. `message` and `conversation` hold the data of the route. */
export type ChatStreamEvent<C> =
  | { type: 'ready' }
  | { type: 'resync' }
  | { type: 'ping' }
  | { type: 'message' | 'conversation'; conversation: C; message: ChatMessage | null };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The event a message stands for; null for one this app does not know (a newer server's). */
export function decodeChatEvent<C>(message: SseMessage): ChatStreamEvent<C> | null {
  switch (message.event) {
    case 'ready':
    case 'resync':
    case 'ping':
      return { type: message.event };
    case 'message':
    case 'conversation': {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return null;
      }
      if (!isObject(data) || !isObject(data.conversation)) return null;
      const sent = data.message;
      if (sent !== null && sent !== undefined && !(isObject(sent) && typeof sent.id === 'number')) {
        return null;
      }
      return {
        type: message.event,
        conversation: data.conversation as C,
        message: (sent ?? null) as ChatMessage | null,
      };
    }
    default:
      return null;
  }
}

export interface ChatStreamOptions<C> {
  url: string;
  /** The token to open with; `rejected` is the one the server has just answered 401 to. */
  token: (rejected?: string) => Promise<string | null>;
  onEvent: (event: ChatStreamEvent<C>) => void;
  /** True once `ready` came, false when the stream failed or fell silent and waits to retry. */
  onStatus?: (up: boolean) => void;
  transport?: StreamTransport;
}

export class ChatStream<C> {
  private readonly options: ChatStreamOptions<C>;
  private readonly transport: StreamTransport;
  private running = false;
  private generation = 0;
  private abort: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private delay = RETRY_MIN_MS;

  constructor(options: ChatStreamOptions<C>) {
    this.options = options;
    this.transport = options.transport ?? xhrTransport;
  }

  get active(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.delay = RETRY_MIN_MS;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    this.generation += 1;
    this.clearRetry();
    this.close();
  }

  private async connect(rejected?: string): Promise<void> {
    this.generation += 1;
    const generation = this.generation;
    this.clearRetry();
    this.close();
    let token: string | null;
    try {
      token = await this.options.token(rejected);
    } catch {
      token = null;
    }
    if (!this.running || generation !== this.generation) return;
    if (token === null) {
      this.down();
      return;
    }
    const parser = new SseParser();
    let ready = false;
    let received = 0;
    const current = () => this.running && generation === this.generation;
    this.watchSilence(generation);
    this.abort = this.transport(
      { url: this.options.url, token },
      {
        onText: (text) => {
          if (!current()) return;
          received += text.length;
          this.watchSilence(generation);
          for (const message of parser.feed(text)) {
            const event = decodeChatEvent<C>(message);
            if (!event) continue;
            if (event.type === 'ready') {
              ready = true;
              this.delay = RETRY_MIN_MS;
              this.status(true);
            }
            this.deliver(event);
            if (!current()) return;
          }
          if (received > MAX_STREAM_TEXT) void this.connect();
        },
        onEnd: (status) => {
          if (!current()) return;
          this.abort = null;
          this.clearSilence();
          if (status === 401) this.down(token);
          else if (status === 200 && ready) void this.connect();
          else this.down();
        },
      },
    );
  }

  private deliver(event: ChatStreamEvent<C>): void {
    try {
      this.options.onEvent(event);
    } catch {
      // A cache that could not take the event must not end the stream.
    }
  }

  private status(up: boolean): void {
    try {
      this.options.onStatus?.(up);
    } catch {
      // Same as above.
    }
  }

  /** The stream is gone: say so, and try again after the backoff. */
  private down(rejected?: string): void {
    this.status(false);
    this.retry(rejected);
  }

  private retry(rejected?: string): void {
    if (!this.running || this.retryTimer) return;
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, RETRY_MAX_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect(rejected);
    }, delay);
  }

  private watchSilence(generation: number): void {
    this.clearSilence();
    this.silenceTimer = setTimeout(() => {
      this.silenceTimer = null;
      if (!this.running || generation !== this.generation) return;
      this.generation += 1;
      this.close();
      this.down();
    }, SILENCE_MS);
  }

  private close(): void {
    this.clearSilence();
    const abort = this.abort;
    this.abort = null;
    abort?.();
  }

  private clearRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearSilence(): void {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = null;
  }
}
