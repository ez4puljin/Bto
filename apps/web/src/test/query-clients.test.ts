import { QueryClient } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { clearQueryClients, registerQueryClient } from './query-clients';

it('releases owned inactive query timers after a test while leaving other clients intact', () => {
  vi.useFakeTimers();
  const other = new QueryClient();
  try {
    other.setQueryData(['other'], 'independent cache');
    const baselineTimers = vi.getTimerCount();
    const first = registerQueryClient(new QueryClient());
    const second = registerQueryClient(new QueryClient());
    first.setQueryData(['first'], 'first cached result');
    second.setQueryData(['second'], 'second cached result');

    // Registration does not shorten the normal cache lifetime during the test.
    vi.advanceTimersByTime(299_999);
    expect(first.getQueryData(['first'])).toBe('first cached result');
    expect(second.getQueryData(['second'])).toBe('second cached result');
    expect(vi.getTimerCount()).toBeGreaterThan(baselineTimers);

    clearQueryClients();
    expect(first.getQueryCache().getAll()).toHaveLength(0);
    expect(second.getQueryCache().getAll()).toHaveLength(0);
    expect(other.getQueryData(['other'])).toBe('independent cache');
    expect(vi.getTimerCount()).toBe(baselineTimers);
  } finally {
    clearQueryClients();
    other.clear();
    vi.useRealTimers();
  }
});
