import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { AppConfig } from '../common/config/app-config';
import { DB_POOL } from '../common/db/db.tokens';
import { PgBossService } from '../common/jobs/pg-boss.service';
import type { ComponentState, HealthResponseDto } from './health.dto';

/** Cheap dependency probes shared by the api's /health and the worker's local health endpoint. */
@Injectable()
export class HealthService {
  constructor(
    @Inject(DB_POOL) private readonly pool: Pool,
    private readonly pgBoss: PgBossService,
    private readonly config: AppConfig,
  ) {}

  async check(): Promise<HealthResponseDto> {
    const [db, pgboss] = await Promise.all([
      probe(() => this.pool.query('SELECT 1')),
      probe(async () => {
        if (!this.pgBoss.isStarted() || !(await this.pgBoss.boss.isInstalled())) {
          throw new Error('pg-boss is not running');
        }
      }),
    ]);
    return {
      status: db === 'up' && pgboss === 'up' ? 'ok' : 'degraded',
      db,
      pgboss,
      version: this.config.get('APP_VERSION'),
    };
  }
}

async function probe(check: () => Promise<unknown>, timeoutMs = 2_000): Promise<ComponentState> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}
