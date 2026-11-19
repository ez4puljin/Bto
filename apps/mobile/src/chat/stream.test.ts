import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RETRY_MIN_MS, SILENCE_MS, type StreamSink, type StreamTransport } from '../api/live-stock';
import { decodeChatEvent, ChatStream, type ChatStreamEvent } from './stream';

const frame = (event: string, data: unknown, id = 1) =>
  `event: ${event}\nid: ${id}\ndata: ${JSON.stringify(data)}\n\n`;

const sent = { id: 9, body: 'x' };
const conversation = { id: 1, unread: 1 };

describe('the chat event decoder (ADR-0224 #7)', () => {
  it('reads the five events and keeps the data of message and conversation', () => {
    expect(decodeChatEvent({ event: 'ready', data: '{}' })).toEqual({ type: 'ready' });
    expect(decodeChatEvent({ event: 'resync', data: '{}' })).toEqual({ type: 'resync' });
    expect(decodeChatEvent({ event: 'ping', data: '{}' })).toEqual({ type: 'ping' });
    expect(
      decodeChatEvent({ event: 'message', data: JSON.stringify({ conversation, message: sent }) }),
    ).toEqual({ type: 'message', conversation, message: sent });
    expect(
      decodeChatEvent({
        event: 'conversation',
        data: JSON.stringify({ conversation, message: null }),
      }),
    ).toEqual({ type: 'conversation', conversation, message: null });
  });

  it('drops what it cannot read: an unknown event, broken data, a message without an id', () => {
    expect(decodeChatEvent({ event: 'stock', data: '{}' })).toBeNull();
    expect(decodeChatEvent({ event: 'message', data: '{' })).toBeNull();
    expect(decodeChatEvent({ event: 'message', data: '{}' })).toBeNull();
    expect(
      decodeChatEvent({ event: 'message', data: JSON.stringify({ conversation, message: {} }) }),
    ).toBeNull();
  });
});

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

function setup() {
  const transport = new FakeTransport();
  const events: ChatStreamEvent<typeof conversation>[] = [];
  const status: boolean[] = [];
  const stream = new ChatStream<typeof conversation>({
    url: 'http://server/api/v1/customer-app/chat/live',
    token: () => Promise.resolve('t1'),
    onEvent: (event) => events.push(event),
    onStatus: (up) => status.push(up),
    transport: transport.open,
  });
  return { transport, events, status, stream };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe('the chat stream (ADR-0224 #7)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hands each event over, however the network cuts it, and reports up at ready', async () => {
    const { transport, events, status, stream } = setup();
    stream.start();
    await settle();
    transport.last.sink.onText(
      frame('ready', {}) + 'event: message\ndata: {"conversation":{"id":1,',
    );
    transport.last.sink.onText('"unread":1},"message":{"id":9,"body":"x"}}\n\n');
    expect(events.map((event) => event.type)).toEqual(['ready', 'message']);
    expect(status).toEqual([true]);
    stream.stop();
    expect(transport.last.aborted).toBe(true);
  });

  it('opens again at once after a ready stream ends, and reports down after a failure', async () => {
    const { transport, status, stream } = setup();
    stream.start();
    await settle();
    transport.last.sink.onText(frame('ready', {}));
    transport.last.sink.onEnd(200);
    await settle();
    expect(transport.requests).toHaveLength(2);
    // A stream that fails before ready: down, then a retry after the backoff.
    transport.last.sink.onEnd(0);
    expect(status).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(RETRY_MIN_MS);
    expect(transport.requests).toHaveLength(3);
    stream.stop();
  });

  it('gives up on a silent stream and opens a new one', async () => {
    const { transport, status, stream } = setup();
    stream.start();
    await settle();
    transport.last.sink.onText(frame('ready', {}));
    await vi.advanceTimersByTimeAsync(SILENCE_MS);
    expect(transport.requests[0]?.aborted).toBe(true);
    expect(status).toEqual([true, false]);
    await vi.advanceTimersByTimeAsync(RETRY_MIN_MS);
    expect(transport.requests).toHaveLength(2);
    stream.stop();
  });
});
