/** A failed call as the screens show it: the server's problem+json, or no answer at all. */
export interface AppProblem {
  /** An error code of the API (`errors.<code>` in mn.json), or NETWORK when nothing answered. */
  code: string;
  /** The HTTP status; 0 without an answer. */
  status: number;
  params?: Record<string, unknown>;
  errors?: { path: string; constraint: string; message?: string }[];
}

export const NETWORK: AppProblem = { code: 'NETWORK', status: 0 };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The problem+json body of a failed call; a generic one when the body is not one. */
export function problemOf(body: unknown, status: number): AppProblem {
  if (isRecord(body) && typeof body.code === 'string') {
    return {
      code: body.code,
      status,
      ...(isRecord(body.params) ? { params: body.params } : {}),
      ...(Array.isArray(body.errors)
        ? {
            errors: body.errors.flatMap((entry: unknown) =>
              isRecord(entry) && typeof entry.path === 'string'
                ? [
                    {
                      path: entry.path,
                      constraint: typeof entry.constraint === 'string' ? entry.constraint : '',
                      ...(typeof entry.message === 'string' ? { message: entry.message } : {}),
                    },
                  ]
                : [],
            ),
          }
        : {}),
    };
  }
  return { code: status === 0 ? 'NETWORK' : 'INTERNAL_ERROR', status };
}

/** Thrown by query and mutation functions, so TanStack Query hands the problem to the screen. */
export class ApiProblem extends Error {
  readonly problem: AppProblem;

  constructor(problem: AppProblem) {
    super(problem.code);
    this.name = 'ApiProblem';
    this.problem = problem;
  }
}

/** The problem behind a failed call: no answer at all (a dropped connection) is NETWORK. */
export function problemFrom(error: unknown): AppProblem {
  return error instanceof ApiProblem ? error.problem : NETWORK;
}

/** Unwraps an openapi-fetch result: the data, or an ApiProblem with the server's code. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok || result.data === undefined) {
    throw new ApiProblem(problemOf(result.error, result.response.status));
  }
  return result.data;
}
