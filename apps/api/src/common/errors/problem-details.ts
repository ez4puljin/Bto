import { HttpException } from '@nestjs/common';
import type { ErrorCode } from '@tugeel/shared';
import { AppError, type FieldError, type ProblemParams } from './app-error';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
export const PROBLEM_TYPE_BASE = 'https://tugeel.local/errors/';

/** RFC 9457 problem details with Tugeel's stable `code` (docs/architecture.md §6). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
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
  if (error instanceof AppError) {
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
  return build('INTERNAL_ERROR', 500, context, 'Internal server error');
}

function build(
  code: ErrorCode,
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
