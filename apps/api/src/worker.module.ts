import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { JobsModule } from './common/jobs/jobs.module';
import { JobsWorkerModule } from './common/jobs/worker/jobs-worker.module';
import { CoreModule } from './core.module';
import { HealthCoreModule } from './health/health.module';
import { WorkerHealthServer } from './health/worker-health.server';
import { FinBridgeModule } from './modules/fin-bridge';
import { FinanceWorkerModule } from './modules/finance';
import { IdentityWorkerModule } from './modules/identity';
import { ImportsWorkerModule } from './modules/imports';
import { InventoryWorkerModule } from './modules/inventory';
import { NotificationsWorkerModule } from './modules/notifications';

/** The pg-boss worker (ROLE=worker): job handlers and their schedules (ADR-0040), no public HTTP. */
@Module({
  imports: [
    CoreModule.forRoot('worker'),
    DbModule,
    JobsModule,
    JobsWorkerModule,
    HealthCoreModule,
    IdentityWorkerModule,
    InventoryWorkerModule,
    ImportsWorkerModule,
    FinanceWorkerModule,
    // Imports create customers in the worker: their Finance Core parties follow (ADR-0084).
    FinBridgeModule,
    NotificationsWorkerModule,
  ],
  providers: [WorkerHealthServer],
})
export class WorkerModule {}
