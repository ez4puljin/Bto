import type { ErrorCode } from '@tugeel/shared';
import { ERROR_HTTP_STATUS } from './error-status';

/** Values the client interpolates into its Mongolian message for `code`. */
export type ProblemParams = Record<string, string | number | boolean | null>;

export interface FieldError {
  path: string;
  constraint: string;
  message: string;
}

/**
 * The one exception type services throw for expected failures. `detail` is English for logs; the
 * client shows Mongolian text chosen by `code` (ADR-0004, ADR-0011).
 */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly detail?: string,
    readonly params?: ProblemParams,
    readonly errors?: FieldError[],
  ) {
    super(detail ?? code);
    this.name = 'AppError';
    this.status = ERROR_HTTP_STATUS[code];
  }
}

/** 422 VALIDATION_FAILED with one field error, the shape the DTO pipe produces. */
export function invalid(path: string, constraint: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, undefined, [{ path, constraint, message }]);
}

export function notFound(entity: string, id: number): AppError {
  return new AppError('NOT_FOUND', `${entity} ${id} not found`, { id });
}
