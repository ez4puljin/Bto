import type { ProblemDetails } from '@tugeel/api-client';
import { useCallback, useState } from 'react';
import { problemFromError } from '@/lib/problem';

/**
 * Runs the API actions of one screen area and keeps the problem of the latest one, so an old error
 * disappears as soon as the next action starts. `run` resolves to whether the action succeeded.
 */
export function useAction() {
  const [problem, setProblem] = useState<ProblemDetails | null>(null);
  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    setProblem(null);
    try {
      await action();
      return true;
    } catch (error) {
      setProblem(problemFromError(error));
      return false;
    }
  }, []);
  const clear = useCallback(() => setProblem(null), []);
  return { problem, run, clear };
}
