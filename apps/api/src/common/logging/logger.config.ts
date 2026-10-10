import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env, ProcessRole } from '../config/env.schema';

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/**
 * Defence in depth only: lottery/qrData (ADR-0017) and credentials must never be passed to a logger
 * in the first place. Request headers are never logged (see serializers).
 */
const SENSITIVE_KEYS = [
  'lottery',
  'qrData',
  'password',
  'newPassword',
  'currentPassword',
  'passwordHash',
  'refreshToken',
  'accessToken',
  'token',
  'tokenHash',
  'codeHash',
  'setupCode',
];
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`, `*.*.*.${key}`]),
];

/** Signed URLs carry their credential in the query string (ADR-0030); logs keep the path only. */
export function redactUrl(url: string | undefined): string | undefined {
  return url?.replace(/([?&]sig=)[^&]*/g, '$1[redacted]');
}

/** Health probes and public file reads (dozens per page of thumbnails) are not access-logged. */
function isQuietUrl(url: string | undefined): boolean {
  return (url?.startsWith('/health') || url?.startsWith('/api/v1/files/public/')) ?? false;
}

/** Reuses a well-formed incoming x-request-id, otherwise creates one; echoes it on the response. */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

export function buildLoggerParams(
  env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>,
  role: ProcessRole,
): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      base: { service: `tugeel-${role}` },
      redact: { paths: REDACT_PATHS, remove: true },
      genReqId,
      autoLogging: { ignore: (req) => isQuietUrl(req.url) },
      serializers: {
        req: (req: { id?: unknown; method?: string; url?: string }) => ({
          id: req.id,
          method: req.method,
          url: redactUrl(req.url),
        }),
        res: (res: { statusCode?: number }) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      ...(env.NODE_ENV === 'development'
        ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
        : {}),
    },
  };
}
