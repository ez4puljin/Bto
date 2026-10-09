import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { pgBossProvider } from './pg-boss.provider';
import { PgBossService } from './pg-boss.service';

@Global()
@Module({
  providers: [pgBossProvider, PgBossService, JobsService],
  exports: [pgBossProvider, PgBossService, JobsService],
})
export class JobsModule {}
