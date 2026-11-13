import { QueryClient } from '@tanstack/react-query';
import { ApiProblem } from './problem';

/**
 * A failed read is tried once more, except when the server said «not now» (ADR-0193: 429 the
 * reports' gate is full, 503 a statement met its time limit or the database is busy): asking again
 * at once would only join the same line, and the screen's own «Дахин оролдох» is there.
 */
export function retryRead(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiProblem && [429, 503].includes(error.problem.status)) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: retryRead, refetchOnWindowFocus: false, staleTime: 10_000 },
    },
  });
}
