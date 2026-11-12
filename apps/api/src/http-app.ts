import { RequestMethod } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

export const API_PREFIX = 'api/v1';

/**
 * Creation options shared by main.ts, the test harness and the OpenAPI export. The default parsers are
 * off: configureHttpApp adds JSON only, so a cross-site HTML form (urlencoded) never reaches a
 * handler (login CSRF; ADR-0027 #8). Uploads stream their raw body.
 */
export const HTTP_APP_OPTIONS = { bufferLogs: true, bodyParser: false } as const;

/** The admin's page that shows what GET /health and the server panel report. */
export const STATUS_PAGE = '/system/status';

/**
 * A person who opens /health in a browser lands on «Системийн төлөв» instead of raw JSON. Only a
 * request that prefers HTML is sent there: probes, scripts and the apps (which accept anything, or
 * JSON) get the JSON as before.
 */
function healthForBrowsers(request: Request, response: Response, next: NextFunction): void {
  const direct = request.method === 'GET' && request.path === '/';
  if (direct && request.accepts(['json', 'html']) === 'html') {
    response.redirect(302, STATUS_PAGE);
    return;
  }
  next();
}

/**
 * HTTP setup shared by main.ts, the integration tests and the OpenAPI export, so the routes and the
 * published contract always agree.
 */
export function configureHttpApp<T extends NestExpressApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  // Caddy is the single proxy hop in front of the api (docs/architecture.md §10.2).
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  app.use('/health', healthForBrowsers);
  app.setGlobalPrefix(API_PREFIX, { exclude: [{ path: 'health', method: RequestMethod.GET }] });
  return app;
}
