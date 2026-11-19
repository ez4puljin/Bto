import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { describe, expect, it } from 'vitest';

// The chat screens' `enabled: focused` rule (ADR-0224): `ready`/`resync` invalidate with the default
// refetch type, so a focused (enabled) query refetches at once, and an unfocused (disabled) one is
// only marked stale and refetches once when it is enabled again.

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function watch(client: QueryClient, calls: { n: number }, enabled: boolean) {
  return new QueryObserver(client, {
    queryKey: ['chat', 'open'],
    queryFn: () => Promise.resolve(++calls.n),
    staleTime: 0,
    enabled,
  });
}

describe('invalidating on ready/resync', () => {
  it('refetches a focused query at once', async () => {
    const client = new QueryClient();
    const calls = { n: 0 };
    const observer = watch(client, calls, true);
    const stop = observer.subscribe(() => undefined);
    await settle();
    expect(calls.n).toBe(1);
    await client.invalidateQueries({ queryKey: ['chat', 'open'] });
    expect(calls.n).toBe(2);
    stop();
  });

  it('leaves an unfocused query alone, and refetches it once when focus returns', async () => {
    const client = new QueryClient();
    const calls = { n: 0 };
    const observer = watch(client, calls, true);
    const stop = observer.subscribe(() => undefined);
    await settle();
    observer.setOptions({
      queryKey: ['chat', 'open'],
      queryFn: () => Promise.resolve(++calls.n),
      enabled: false,
    });
    await client.invalidateQueries({ queryKey: ['chat', 'open'] });
    await settle();
    expect(calls.n).toBe(1);
    observer.setOptions({
      queryKey: ['chat', 'open'],
      queryFn: () => Promise.resolve(++calls.n),
      staleTime: 0,
      enabled: true,
    });
    await settle();
    expect(calls.n).toBe(2);
    stop();
  });
});
