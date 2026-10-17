import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

/** Everything the kiosk calls sits under this prefix; Caddy (or Vite) proxies `/edge/*` here. */
export const EDGE_PREFIX = 'edge/v1';

/** Like the api: JSON only (no urlencoded bodies), buffered logs until pino is ready. */
export const EDGE_APP_OPTIONS = { bufferLogs: true, bodyParser: false } as const;

/** HTTP setup shared by edge.ts and the tests, so the routes the tests call are the real ones. */
export function configureEdgeHttpApp<T extends NestExpressApplication>(app: T): T {
  app.useLogger(app.get(Logger));
  // Caddy on the store PC is the single proxy hop in front of the edge.
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(helmet());
  app.useBodyParser('json', { limit: '1mb' });
  app.setGlobalPrefix(EDGE_PREFIX);
  return app;
}
