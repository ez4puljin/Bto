import {
  type LiveStockCustomerItem,
  type LiveStockStaffItem,
  type StockApp,
  STOCK_WORDS,
} from '@tugeel/shared/sales';

// The apps' live stock (ADR-0173 #4): the server's event stream read over XMLHttpRequest, the one
// transport of React Native that hands a response over while it is still arriving (its fetch
// cannot stream a body). The stream opens with the session's access token, ends when that token
// does, and is opened again — with backoff after a failure, at once after a healthy end.

/** Each app's stream, relative to the server. */
export const LIVE_STOCK_PATHS: Record<StockApp, string> = {
  STAFF: '/api/v1/sales-rep/stock/live',
  CUSTOMER: '/api/v1/customer-app/stock/live',
};

/** The first wait after a failed stream, doubled up to RETRY_MAX_MS. */
export const RETRY_MIN_MS = 1_000;
export const RETRY_MAX_MS = 30_000;
/** XHR keeps the whole response in `responseText`: past this much the stream is opened anew. */
export const MAX_STREAM_TEXT = 1_000_000;
/** The server pings every 20 s: this long without a byte means the connection silently died. */
export const SILENCE_MS = 50_000;

/** One server-sent event: its name (`message` when the server named none) and its data lines. */
export interface SseMessage {
  event: string;
  data: string;
}

/**
 * The text/event-stream format (the HTML standard's "event stream interpretation"), fed in the
 * chunks the network delivers: lines end with CR, LF or CRLF, a blank line dispatches the event,
 * `:` lines are comments, `id` and `retry` are not needed here. An event without data is dropped.
 */
export class SseParser {
  private pending = '';
  private event = '';
  private data: string[] = [];
  private started = false;

  feed(chunk: string): SseMessage[] {
    let text = this.pending + chunk;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.startsWith('﻿')) text = text.slice(1);
    }
    // A CR at the end may be the first half of a CRLF: it waits for the next chunk.
    let hold = '';
    if (text.endsWith('\r')) {
      text = text.slice(0, -1);
      hold = '\r';
    }
    const lines = text.split(/\r\n|\r|\n/);
    this.pending = (lines.pop() ?? '') + hold;
    const messages: SseMessage[] = [];
    for (const line of lines) {
      if (line === '') {
        if (this.data.length > 0) {
          messages.push({ event: this.event || 'message', data: this.data.join('\n') });
        }
        this.event = '';
        this.data = [];
        continue;
      }
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') this.event = value;
      else if (field === 'data') this.data.push(value);
    }
    return messages;
  }
}

/** An event of the live stock stream (`@tugeel/shared/sales` LIVE_STOCK_EVENTS). */
export type LiveStockEvent<T> =
  { type: 'ready' } | { type: 'resync' } | { type: 'ping' } | { type: 'stock'; items: T[] };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);

export function isStaffItem(value: unknown): value is LiveStockStaffItem {
  return (
    isObject(value) &&
    typeof value.productId === 'number' &&
    isDecimal(value.available) &&
    typeof value.stockBlocked === 'boolean'
  );
}

export function isCustomerItem(value: unknown): value is LiveStockCustomerItem {
  return (
    isObject(value) &&
    typeof value.productId === 'number' &&
    STOCK_WORDS.some((word) => word === value.stock) &&
    (value.available === undefined || isDecimal(value.available))
  );
}

/**
 * The event a message carries; null for one this app does not know (a newer server's). A `stock`
 * event keeps only the items it can read.
 */
export function decodeLiveEvent<T>(
  message: SseMessage,
  isItem: (value: unknown) => value is T,
): LiveStockEvent<T> | null {
  switch (message.event) {
    case 'ready':
    case 'resync':
    case 'ping':
      return { type: message.event };
    case 'stock': {
      let data: unknown;
      try {
        data = JSON.parse(message.data);
      } catch {
        return null;
      }
      if (!isObject(data) || !Array.isArray(data.items)) return null;
      return { type: 'stock', items: data.items.filter(isItem) };
    }
    default:
      return null;
  }
}

/** What a stream request reports: text as it arrives, then its end (0: no answer, aborted). */
export interface StreamSink {
  onText(text: string): void;
  onEnd(status: number): void;
}

/** Opens one stream request; the function it returns aborts it, after which nothing is reported. */
export type StreamTransport = (
  request: { url: string; token: string },
  sink: StreamSink,
) => () => void;

/**
 * The phone's transport: an XMLHttpRequest with `onprogress` set before `send`, which makes React
 * Native deliver the body in pieces (`responseText` grows; Android reads it 8 KB at a time) and,
 * with `timeout` 0, never gives up on a quiet stream. Only a 200's body is reported as text.
 */
export const xhrTransport: StreamTransport = ({ url, token }, sink) => {
  const xhr = new XMLHttpRequest();
  let seen = 0;
  let closed = false;
  const take = () => {
    if (closed || xhr.status !== 200) return;
    const text = xhr.responseText;
    if (text.length <= seen) return;
    const chunk = text.slice(seen);
    seen = text.length;
    sink.onText(chunk);
  };
  const end = (status: number) => {
    if (closed) return;
    take();
    closed = true;
    sink.onEnd(status);
  };
  xhr.open('GET', url);
  xhr.responseType = 'text';
  xhr.timeout = 0;
  xhr.setRequestHeader('Authorization', `Bearer ${token}`);
  xhr.setRequestHeader('Accept', 'text/event-stream');
  xhr.setRequestHeader('Cache-Control', 'no-cache');
  xhr.onprogress = take;
  xhr.onload = () => end(xhr.status);
  xhr.onerror = () => end(0);
  xhr.ontimeout = () => end(0);
  xhr.send();
  return () => {
    if (closed) return;
    closed = true;
    xhr.abort();
  };
};

export interface LiveStockStreamOptions<T> {
  url: string;
  /**
   * The token to open the stream with; `rejected` is the one the server has just answered 401
   * to. Null when there is none to have (no session, no connection): the stream tries again later.
   */
  token: (rejected?: string) => Promise<string | null>;
  isItem: (value: unknown) => value is T;
  onEvent: (event: LiveStockEvent<T>) => void;
  transport?: StreamTransport;
}

/**
 * One app's live stock stream while `start`ed: opened with a fresh token, its events handed to
 * `onEvent`; a stream the server ends after `ready` (its token's end) is opened again at once, one
 * that failed, was refused or never became ready after RETRY_MIN_MS … RETRY_MAX_MS. A silent
 * stream (no ping for SILENCE_MS) and one past MAX_STREAM_TEXT are opened anew.
 */
export class LiveStockStream<T> {
  private readonly options: LiveStockStreamOptions<T>;
  private readonly transport: StreamTransport;
  private running = false;
  /** Bumped by every (re)connect and stop: callbacks of an older request are ignored. */
  private generation = 0;
  private abort: (() => void) | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private delay = RETRY_MIN_MS;

  constructor(options: LiveStockStreamOptions<T>) {
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
      this.retry();
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
            const event = decodeLiveEvent(message, this.options.isItem);
            if (!event) continue;
            if (event.type === 'ready') {
              ready = true;
              this.delay = RETRY_MIN_MS;
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
          if (status === 401) this.retry(token);
          else if (status === 200 && ready) void this.connect();
          else this.retry();
        },
      },
    );
  }

  private deliver(event: LiveStockEvent<T>): void {
    try {
      this.options.onEvent(event);
    } catch {
      // A cache that could not take the event must not end the stream.
    }
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
      this.retry();
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
