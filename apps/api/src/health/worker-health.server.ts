import { createServer, type Server } from 'node:http';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../common/config/app-config';
import { HealthService } from './health.service';

/**
 * The worker has no HTTP API; this loopback-only endpoint lets the container HEALTHCHECK
 * (apps/api/docker/healthcheck.mjs) see whether the database and pg-boss are reachable.
 */
@Injectable()
export class WorkerHealthServer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('WorkerHealth');
  private server: Server | undefined;

  constructor(
    private readonly health: HealthService,
    private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const server = createServer((req, res) => {
      if (req.method !== 'GET' || req.url !== '/health') {
        res.writeHead(404).end();
        return;
      }
      this.health.check().then(
        (report) => {
          res
            .writeHead(report.status === 'ok' ? 200 : 503, {
              'content-type': 'application/json',
              'cache-control': 'no-store',
            })
            .end(JSON.stringify(report));
        },
        (err: unknown) => {
          this.logger.error({ err }, 'health check failed');
          res.writeHead(500).end();
        },
      );
    });
    const port = this.config.get('WORKER_HEALTH_PORT');
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => resolve());
    });
    this.server = server;
    this.logger.log(`worker health on http://127.0.0.1:${this.port() ?? port}/health`);
  }

  /** The bound port (differs from the configured one when WORKER_HEALTH_PORT=0). */
  port(): number | undefined {
    const address = this.server?.address();
    return typeof address === 'object' && address ? address.port : undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
