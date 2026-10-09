import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { JobsModule } from './common/jobs/jobs.module';
import { JobsWorkerModule } from './common/jobs/worker/jobs-worker.module';
import { CoreModule } from './core.module';
import { HealthCoreModule } from './health/health.module';
import { WorkerHealthServer } from './health/worker-health.server';

/** The pg-boss worker (ROLE=worker): job handlers and cron, no public HTTP. */
@Module({
  imports: [CoreModule.forRoot('worker'), DbModule, JobsModule, JobsWorkerModule, HealthCoreModule],
  providers: [WorkerHealthServer],
})
export class WorkerModule {}
