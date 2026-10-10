import type { ProblemDetails } from '@tugeel/api-client';
import { isErrorCode } from '@tugeel/shared/errors';

/** The problem+json body of a failed call, or a generic one for network failures (ADR-0004 #4). */
export function problemOf(error: unknown): ProblemDetails {
  if (typeof error === 'object' && error !== null && 'code' in error && isErrorCode(error.code)) {
    return error as ProblemDetails;
  }
  return { type: 'about:blank', title: 'Internal error', status: 500, code: 'INTERNAL_ERROR' };
}

/** Thrown by query and mutation functions so TanStack Query hands the problem to the screen. */
export class ApiProblem extends Error {
  readonly problem: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.code);
    this.name = 'ApiProblem';
    this.problem = problem;
  }
}

/** Unwraps an openapi-fetch result: the data, or an ApiProblem with the server's code. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    throw new ApiProblem(problemOf(result.error));
  }
  return result.data as T;
}
