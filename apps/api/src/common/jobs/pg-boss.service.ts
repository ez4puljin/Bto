import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { AppConfig } from '../config/app-config';
import { PROCESS_ROLE, type ProcessRole } from '../config/process-role';
import { PG_BOSS } from './pg-boss.provider';

/**
 * Starts pg-boss in both processes (sending needs a started instance) and stops it before the
 * database pool closes. An unhandled 'error' event would crash Node, so errors are logged.
 */
@Injectable()
export class PgBossService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger('PgBoss');
  private started = false;

  constructor(
    @Inject(PG_BOSS) readonly boss: PgBoss,
    private readonly config: AppConfig,
    @Inject(PROCESS_ROLE) private readonly role: ProcessRole,
  ) {
    boss.on('error', (err) => this.logger.error({ err }, 'pg-boss error'));
    boss.on('warning', (warning) => this.logger.warn({ warning }, 'pg-boss warning'));
  }

  async onModuleInit(): Promise<void> {
    await this.boss.start({ attempts: this.config.get('NODE_ENV') === 'test' ? 1 : 10 });
    this.started = true;
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    await this.boss.stop({ graceful: true, timeout: this.role === 'worker' ? 30_000 : 5_000 });
  }

  isStarted(): boolean {
    return this.started;
  }
}
