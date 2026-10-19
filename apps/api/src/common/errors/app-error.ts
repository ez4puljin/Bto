import type { ErrorCode } from '@tugeel/shared';
import {
  CodedError,
  type FieldError,
  type ProblemParams,
  registerErrorStatuses,
} from './coded-error';
import { ERROR_HTTP_STATUS } from './error-status';

export type { FieldError, ProblemParams };

const STATUS = registerErrorStatuses('bto', ERROR_HTTP_STATUS);

/**
 * The one exception type Bto's services throw for expected failures, over Bto's catalog
 * (`@tugeel/shared` ErrorCode). `detail` is English for logs; the client shows Mongolian text chosen
 * by `code` (ADR-0004, ADR-0011).
 */
export class AppError extends CodedError<ErrorCode> {
  constructor(code: ErrorCode, detail?: string, params?: ProblemParams, errors?: FieldError[]) {
    super(code, STATUS[code], detail, params, errors);
    this.name = 'AppError';
  }
}

/** 422 VALIDATION_FAILED with one field error, the shape the DTO pipe produces. */
export function invalid(path: string, constraint: string, message: string): AppError {
  return new AppError('VALIDATION_FAILED', message, undefined, [{ path, constraint, message }]);
}

export function notFound(entity: string, id: number): AppError {
  return new AppError('NOT_FOUND', `${entity} ${id} not found`, { id });
}
