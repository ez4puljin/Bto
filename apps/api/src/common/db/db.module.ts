import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../db/schema';
import { AppConfig } from '../config/app-config';
import { PROCESS_ROLE, type ProcessRole } from '../config/process-role';
import { DB, DB_POOL } from './db.tokens';
import type { Db } from './db.types';
import { configurePgTypeParsers } from './pg-types';

@Injectable()
class DbLifecycle implements OnModuleInit, OnApplicationShutdown {
  private ended = false;

  constructor(@Inject(DB_POOL) private readonly pool: Pool) {}

  /** ADR-0003: the process refuses to run on a database that does not case-fold Mongolian Cyrillic. */
  async onModuleInit(): Promise<void> {
    const { rows } = await this.pool.query<{ ok: boolean }>(`SELECT lower('ӨҮЁ') = 'өүё' AS ok`);
    if (!rows[0]?.ok) {
      throw new Error(
        'Database collation does not case-fold Mongolian Cyrillic; recreate it with `pnpm db:provision`',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DB_POOL,
      inject: [AppConfig, PROCESS_ROLE],
      useFactory: (config: AppConfig, role: ProcessRole): Pool => {
        configurePgTypeParsers();
        const pool = new Pool({
          connectionString: config.get('DATABASE_URL'),
          max: config.get('DB_POOL_MAX'),
          application_name: `tugeel-${role}`,
          connectionTimeoutMillis: 5_000,
          idleTimeoutMillis: 30_000,
        });
        // An unhandled 'error' event on an idle client would crash the process.
        pool.on('error', (err) => new Logger('DbPool').error({ err }, 'idle client error'));
        return pool;
      },
    },
    {
      provide: DB,
      inject: [DB_POOL],
      useFactory: (pool: Pool): Db => drizzle({ client: pool, schema }),
    },
    DbLifecycle,
  ],
  exports: [DB, DB_POOL],
})
export class DbModule {}
