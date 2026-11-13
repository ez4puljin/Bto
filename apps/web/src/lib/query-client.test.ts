import { describe, expect, it } from 'vitest';
import { ApiProblem } from './problem';
import { retryRead } from './query-client';

const problem = (status: number, code: 'REPORTS_BUSY' | 'QUERY_TIMEOUT' | 'INTERNAL_ERROR') =>
  new ApiProblem({ type: 'about:blank', title: code, status, code });

describe('retryRead', () => {
  it('tries a failed read once more', () => {
    expect(retryRead(0, problem(500, 'INTERNAL_ERROR'))).toBe(true);
    expect(retryRead(1, problem(500, 'INTERNAL_ERROR'))).toBe(false);
    expect(retryRead(0, new Error('network'))).toBe(true);
  });

  it('does not ask again at once when the server said «not now»', () => {
    expect(retryRead(0, problem(429, 'REPORTS_BUSY'))).toBe(false);
    expect(retryRead(0, problem(503, 'QUERY_TIMEOUT'))).toBe(false);
  });
});
