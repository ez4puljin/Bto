import { formatMnt } from '../format/format';

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

const CREDIT_KEYS = {
  HOLD: 'errors.CREDIT_BLOCKED_HOLD',
  OVERDUE: 'errors.CREDIT_BLOCKED_OVERDUE',
  LIMIT: 'errors.CREDIT_BLOCKED_LIMIT',
} as const;
const amount = (value: unknown) => (typeof value === 'string' ? formatMnt(value) : '');

export interface CreditMessage {
  key: (typeof CREDIT_KEYS)[keyof typeof CREDIT_KEYS];
  params: {
    exposure: string;
    limit: string;
    excess: string;
    overdueAmount: string;
    oldestDueDate: string;
  };
}

/**
 * The credit refusal (ADR-0060 #2) a CONFIRM stage may answer: one message per reason with its
 * amounts formatted, as the web shows it; null for any other problem.
 */
export function creditMessage(problem: AppProblem): CreditMessage | null {
  if (problem.code !== 'CREDIT_BLOCKED') return null;
  const params = problem.params ?? {};
  const reason = (Object.keys(CREDIT_KEYS) as (keyof typeof CREDIT_KEYS)[]).find(
    (entry) => entry === params.reason,
  );
  if (!reason) return null;
  return {
    key: CREDIT_KEYS[reason],
    params: {
      exposure: amount(params.exposure),
      limit: amount(params.limit),
      excess: amount(params.excess),
      overdueAmount: amount(params.overdueAmount),
      oldestDueDate: typeof params.oldestDueDate === 'string' ? params.oldestDueDate : '',
    },
  };
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
