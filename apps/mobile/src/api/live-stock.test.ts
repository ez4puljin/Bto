import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeLiveEvent,
  isCustomerItem,
  isStaffItem,
  type LiveStockEvent,
  LiveStockStream,
  MAX_STREAM_TEXT,
  RETRY_MAX_MS,
  SILENCE_MS,
  SseParser,
  type StreamSink,
  type StreamTransport,
} from './live-stock';

/** One event as Nest's `@Sse()` writes it (with its running id). */
const frame = (event: string, data: unknown, id = 1) =>
  `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

describe('the event stream parser (ADR-0173 #4)', () => {
  it('reads Nest’s events, however the network cuts them', () => {
    const text =
      '\n' +
      frame('ready', {}) +
      frame('stock', { items: [{ productId: 1, available: '5', stockBlocked: false }] }, 2);
    const whole = new SseParser().feed(text);
    expect(whole).toEqual([
      { event: 'ready', data: '{}' },
      {
        event: 'stock',
        data: '{"items":[{"productId":1,"available":"5","stockBlocked":false}]}',
      },
    ]);
    // One character at a time gives the same events.
    const parser = new SseParser();
    const pieces = [...text].flatMap((char) => parser.feed(char));
    expect(pieces).toEqual(whole);
  });

  it('takes CR, LF and CRLF line ends, a CRLF split across chunks, comments and bare fields', () => {
    const parser = new SseParser();
    expect(parser.feed('﻿: a comment\r\nevent: ping\r')).toEqual([]);
    // The last CR may still become a CRLF: the event waits for the next chunk.
    expect(parser.feed('\ndata: {}\r\r')).toEqual([]);
    expect(parser.feed('\n')).toEqual([{ event: 'ping', data: '{}' }]);
    expect(parser.feed('data: first\ndata:second\n\n')).toEqual([
      { event: 'message', data: 'first\nsecond' },
    ]);
    // No data: nothing is dispatched, and the name does not leak into the next event.
    expect(parser.feed('event: stock\nid: 4\n\ndata\n\n')).toEqual([
      { event: 'message', data: '' },
    ]);
  });

  it('decodes the four events and keeps only the items it can read', () => {
    expect(decodeLiveEvent({ event: 'ready', data: '{}' }, isStaffItem)).toEqual({
      type: 'ready',
    });
    expect(decodeLiveEvent({ event: 'resync', data: '{}' }, isStaffItem)).toEqual({
      type: 'resync',
    });
    expect(decodeLiveEvent({ event: 'ping', data: '{}' }, isStaffItem)).toEqual({ type: 'ping' });
    expect(decodeLiveEvent({ event: 'later', data: '{}' }, isStaffItem)).toBeNull();
    expect(decodeLiveEvent({ event: 'stock', data: '{not json' }, isStaffItem)).toBeNull();
    expect(decodeLiveEvent({ event: 'stock', data: '{"rows":[]}' }, isStaffItem)).toBeNull();
    const staff = {
      items: [
        { productId: 1, available: '12.5', stockBlocked: false },
        { productId: 2, available: 12, stockBlocked: false },
        { productId: 3, available: '0', stockBlocked: true },
      ],
    };
    expect(decodeLiveEvent({ event: 'stock', data: JSON.stringify(staff) }, isStaffItem)).toEqual({
      type: 'stock',
      items: [
        { productId: 1, available: '12.5', stockBlocked: false },
        { productId: 3, available: '0', stockBlocked: true },
      ],
    });
    const customer = {
      items: [
        { productId: 1, stock: 'LOW' },
        { productId: 2, stock: 'IN', available: '40' },
        { productId: 3, stock: 'SOME' },
        { productId: 4, stock: 'OUT', available: 'many' },
      ],
    };
    expect(
      decodeLiveEvent({ event: 'stock', data: JSON.stringify(customer) }, isCustomerItem),
    ).toEqual({
      type: 'stock',
      items: [
        { productId: 1, stock: 'LOW' },
        { productId: 2, stock: 'IN', available: '40' },
      ],
    });
  });
});

/** A fake network: each opened request is kept so a test can answer it. */
class FakeTransport {
  requests: { token: string; sink: StreamSink; aborted: boolean }[] = [];
  open: StreamTransport = ({ token }, sink) => {
    const request = { token, sink, aborted: false };
    this.requests.push(request);
    return () => {
      request.aborted = true;
    };
  };
  get last() {
    const request = this.requests.at(-1);
    if (!request) throw new Error('no request');
    return request;
  }
}

type Item = { productId: number; available: string; stockBlocked: boolean };

function setup(
  tokens: (rejected?: string) => Promise<string | null> = () => Promise.resolve('t1'),
) {
  const transport = new FakeTransport();
  const events: LiveStockEvent<Item>[] = [];
  const token = vi.fn(tokens);
  const stream = new LiveStockStream<Item>({
    url: 'http://server/api/v1/sales-rep/stock/live',
    token,
    isItem: isStaffItem,
    onEvent: (event) => events.push(event),
    transport: transport.open,
  });
  return { transport, events, token, stream };
}

/** Lets the token's promise settle. */
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the live stock stream (ADR-0173 #4)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('opens with the session’s token and hands each event over', async () => {
    const { transport, events, stream } = setup();
    stream.start();
    stream.start();
    await settle();
    expect(transport.requests).toHaveLength(1);
    expect(transport.last.token).toBe('t1');
    transport.last.sink.onText(frame('ready', {}) + 'event: stock\ndata: {"items":[{"produ');
    transport.last.sink.onText(
      'ctId":7,"available":"3","stockBlocked":false}]}\n\n' + frame('ping', {}),
    );
    expect(events).toEqual([
      { type: 'ready' },
      { type: 'stock', items: [{ productId: 7, available: '3', stockBlocked: false }] },
      { type: 'ping' },
    ]);
    stream.stop();
    expect(transport.last.aborted).toBe(true);
    transport.last.sink.onText(frame('resync', {}));
    expect(events).toHaveLength(3);
  });

  it('opens again at once when the server ends a ready stream (its token ran out)', async () => {
    const { transport, stream } = setup();
    stream.start();
    await settle();
    transport.last.sink.onText(frame('ready', {}));
    transport.last.sink.onEnd(200);
    await settle();
    expect(transport.requests).toHaveLength(2);
    stream.stop();
  });

  it('waits 1 s, 2 s, 4 s … at most 30 s after failures, and from 1 s again once ready', async () => {
    const { transport, stream } = setup();
    stream.start();
    await settle();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      transport.last.sink.onEnd(0);
      const before = transport.requests.length;
      let waited = 0;
      while (transport.requests.length === before) {
        await vi.advanceTimersByTimeAsync(500);
        waited += 500;
      }
      waits.push(waited);
    }
    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, RETRY_MAX_MS, RETRY_MAX_MS]);
    transport.last.sink.onText(frame('ready', {}));
    transport.last.sink.onEnd(503);
    await vi.advanceTimersByTimeAsync(999);
    expect(transport.requests).toHaveLength(8);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.requests).toHaveLength(9);
    stream.stop();
  });

  it('asks for a new token after a 401, naming the refused one', async () => {
    let n = 0;
    const { transport, token, stream } = setup(() => Promise.resolve(`t${(n += 1)}`));
    stream.start();
    await settle();
    transport.last.sink.onEnd(401);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(token).toHaveBeenLastCalledWith('t1');
    expect(transport.last.token).toBe('t2');
    stream.stop();
  });

  it('waits without a token and opens nothing after stop', async () => {
    let token: string | null = null;
    const { transport, stream } = setup(() => Promise.resolve(token));
    stream.start();
    await settle();
    expect(transport.requests).toHaveLength(0);
    token = 't9';
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.requests).toHaveLength(1);
    transport.last.sink.onEnd(0);
    stream.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.requests).toHaveLength(1);
  });

  it('opens anew after a silent minute and after too much text', async () => {
    const { transport, stream } = setup();
    stream.start();
    await settle();
    transport.last.sink.onText(frame('ready', {}));
    await vi.advanceTimersByTimeAsync(SILENCE_MS - 1);
    expect(transport.last.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.requests[0]?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(transport.requests).toHaveLength(2);

    transport.last.sink.onText(frame('ready', {}));
    transport.last.sink.onText(`: ${'x'.repeat(MAX_STREAM_TEXT)}\n`);
    await settle();
    expect(transport.requests[1]?.aborted).toBe(true);
    expect(transport.requests).toHaveLength(3);
    stream.stop();
  });
});
