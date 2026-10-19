import type { FactoryProvider } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { AppConfig } from '../config/app-config';
import { PROCESS_ROLE, type ProcessRole } from '../config/process-role';
import { PGBOSS_SCHEMA } from './job-catalog';
import { PG_BOSS } from './jobs.tokens';

export { PG_BOSS };

/**
 * Runtime pg-boss on role app (ADR-0024): it never installs or migrates its schema (`db:migrate` does,
 * as migrator). Maintenance and cron run only in the worker.
 */
export const pgBossProvider: FactoryProvider<PgBoss> = {
  provide: PG_BOSS,
  inject: [AppConfig, PROCESS_ROLE],
  useFactory: (config: AppConfig, role: ProcessRole) =>
    new PgBoss({
      connectionString: config.get('DATABASE_URL'),
      application_name: `tugeel-${role}-pgboss`,
      schema: PGBOSS_SCHEMA,
      max: config.get('PGBOSS_POOL_MAX'),
      migrate: false,
      createSchema: false,
      supervise: role === 'worker',
      schedule: role === 'worker',
      instanceName: `tugeel-${role}`,
    }),
};
