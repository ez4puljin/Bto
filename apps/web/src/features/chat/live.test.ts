import { describe, expect, it } from 'vitest';
import { parseEventStream } from './live';

describe('parseEventStream', () => {
  it('splits whole events and keeps the unfinished rest', () => {
    const { events, rest } = parseEventStream(
      'event: ready\ndata: {}\n\n: comment\n\nevent: message\ndata: {"a":1}\n\nevent: pi',
    );
    expect(events).toEqual([
      { event: 'ready', data: '{}' },
      { event: 'message', data: '{"a":1}' },
    ]);
    expect(rest).toBe('event: pi');
  });
});
