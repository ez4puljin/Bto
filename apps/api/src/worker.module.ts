import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { JobsModule } from './common/jobs/jobs.module';
import { JobsWorkerModule } from './common/jobs/worker/jobs-worker.module';
import { CoreModule } from './core.module';
import { ExpiryCommerceModule } from './expiry-commerce.module';
import { HealthCoreModule } from './health/health.module';
import { WorkerHealthServer } from './health/worker-health.server';
import { EbarimtIntegrationModule } from './integrations/ebarimt';
import { ElevenLabsIntegrationModule } from './integrations/elevenlabs';
import { ErkhetIntegrationModule } from './integrations/erkhet';
import { SmsIntegrationModule } from './integrations/sms';
import { EbarimtCheckWorkerModule } from './modules/ebarimt-check';
import { ErkhetWorkerModule } from './modules/erkhet';
import { ErxesWorkerModule } from './modules/erxes';
import { FinBridgeModule } from './modules/fin-bridge';
import { FinanceWorkerModule } from './modules/finance';
import { IdentityWorkerModule } from './modules/identity';
import { ImportsWorkerModule } from './modules/imports';
import { InventoryWorkerModule } from './modules/inventory';
import { NotificationsWorkerModule } from './modules/notifications';
import { PhoneAgentWorkerModule } from './modules/phone-agent';
import { ReportingWorkerModule } from './modules/reporting';
import { StockProblemsWorkerModule } from './modules/stock-problems';

/** The pg-boss worker (ROLE=worker): job handlers and their schedules (ADR-0040), no public HTTP. */
@Module({
  imports: [
    CoreModule.forRoot('worker'),
    ExpiryCommerceModule,
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
    ReportingWorkerModule,
    // The checks of Erkhet's lists (ADR-0203): the worker signs in to Erkhet and compares.
    ErkhetIntegrationModule,
    ErkhetWorkerModule,
    // erxes's new deals as draft orders (ADR-0218): the worker pulls every minute.
    ErxesWorkerModule,
    // Settlement SMS (ADR-0216): the worker sends the batches through WeSend.
    SmsIntegrationModule,
    // e-Barimt's purchase receipts (ADR-0228): the worker pulls them every night at 01:30.
    EbarimtIntegrationModule,
    EbarimtCheckWorkerModule,
    // «Асуудалтай бараа» (ADR-0230): the worker builds the morning sheets at 07:00.
    StockProblemsWorkerModule,
    // The phone AI order line (ADR-0232): the worker fills a finished call's transcript from
    // ElevenLabs and closes the calls a dead bridge left open.
    ElevenLabsIntegrationModule,
    PhoneAgentWorkerModule,
  ],
  providers: [WorkerHealthServer],
})
export class WorkerModule {}
