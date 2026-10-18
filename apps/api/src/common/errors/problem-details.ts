import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@tugeel/shared';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { type FieldError, isCodedError, type ProblemParams } from './coded-error';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const PROBLEM_TYPE_BASE = 'https://tugeel.local/errors/';

/**
 * RFC 9457 problem details with a stable `code` (docs/architecture.md §6): Bto's catalog, or the
 * catalog of another owner such as the Finance Core's FIN_* codes (ADR-0069 #7).
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode | (string & Record<never, never>);
  detail?: string;
  instance?: string;
  requestId?: string;
  params?: ProblemParams;
  errors?: FieldError[];
}

export interface ProblemContext {
  instance?: string;
  requestId?: string;
}

const CODE_BY_STATUS: Readonly<Partial<Record<number, ErrorCode>>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'TOO_MANY_REQUESTS',
  503: 'SERVICE_UNAVAILABLE',
};

/** Maps any thrown value to problem details. Never leaks messages or stacks of unexpected errors. */
export function toProblem(error: unknown, context: ProblemContext): ProblemDetails {
  if (isCodedError(error)) {
    return build(error.code, error.status, context, error.detail, error.params, error.errors);
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const code = CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST');
    return build(code, status, context, status < 500 ? messageOf(error.getResponse()) : undefined);
  }
  const http = clientHttpError(error);
  if (http) {
    return build(CODE_BY_STATUS[http.status] ?? 'BAD_REQUEST', http.status, context, http.detail);
  }
  const constraint = constraintViolation(error);
  if (constraint) {
    const params = constraint.name ? { constraint: constraint.name } : undefined;
    return build(constraint.code, constraint.status, context, constraint.detail, params);
  }
  return build('INTERNAL_ERROR', 500, context, 'Internal server error');
}

/** PostgreSQL SQLSTATEs that mean "the request conflicts with the data", not a server fault. */
const CONSTRAINT_CODES: Readonly<Record<string, { code: ErrorCode; status: number }>> = {
  '23505': { code: 'DUPLICATE_VALUE', status: 409 },
  '23503': { code: 'CONFLICT', status: 409 },
  '23514': { code: 'VALIDATION_FAILED', status: 422 },
  // An EXCLUDE constraint: two rows for the same thing over overlapping dates.
  '23P01': { code: 'CONFLICT', status: 409 },
};

/**
 * The PostgreSQL error behind a failed query. Drizzle wraps it in DrizzleQueryError, whose message
 * contains the bound parameters (password hashes, tokens): only the cause may be logged or mapped.
 */
export function databaseErrorOf(error: unknown): { code?: unknown; constraint?: unknown } | null {
  const cause: unknown = error instanceof DrizzleQueryError ? error.cause : error;
  if (typeof cause !== 'object' || cause === null) return null;
  return 'severity' in cause && 'code' in cause ? cause : null;
}

function constraintViolation(
  error: unknown,
): { code: ErrorCode; status: number; name?: string; detail: string } | undefined {
  const database = databaseErrorOf(error);
  const sqlState = typeof database?.code === 'string' ? database.code : undefined;
  const mapped = sqlState ? CONSTRAINT_CODES[sqlState] : undefined;
  if (!mapped || !database) return undefined;
  const name = typeof database.constraint === 'string' ? database.constraint : undefined;
  return {
    ...mapped,
    ...(name ? { name } : {}),
    detail: `constraint ${name ?? 'unknown'} (SQLSTATE ${sqlState ?? ''})`,
  };
}

/** What the filter may log for an unexpected error: never a DrizzleQueryError with its params. */
export function loggableError(error: unknown): { err: unknown; sql?: string } {
  if (error instanceof DrizzleQueryError) return { err: error.cause, sql: error.query };
  return { err: error };
}

function build(
  code: string,
  status: number,
  context: ProblemContext,
  detail?: string,
  params?: ProblemParams,
  errors?: FieldError[],
): ProblemDetails {
  return {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title: code.charAt(0) + code.slice(1).toLowerCase().replaceAll('_', ' '),
    status,
    code,
    ...(detail ? { detail } : {}),
    ...(context.instance ? { instance: context.instance } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(params ? { params } : {}),
    ...(errors?.length ? { errors } : {}),
  };
}

function messageOf(response: string | object): string | undefined {
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  return typeof message === 'string' ? message : undefined;
}

/** body-parser / http-errors style errors (malformed JSON 400, entity too large 413). */
function clientHttpError(error: unknown): { status: number; detail?: string } | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const { status, statusCode, expose, message } = error as Record<string, unknown>;
  const value = typeof statusCode === 'number' ? statusCode : status;
  if (typeof value !== 'number' || value < 400 || value > 499) return undefined;
  return {
    status: value,
    ...(expose === true && typeof message === 'string' ? { detail: message } : {}),
  };
}
