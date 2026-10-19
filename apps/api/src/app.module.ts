import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { HttpCoreModule } from './common/errors/http-core.module';
import { JobsModule } from './common/jobs/jobs.module';
import { CoreModule } from './core.module';
import { FinanceCoreModule } from './finance-core';
import { HealthModule } from './health/health.module';
import { LlmModule } from './integrations/llm';
import { AiHttpModule } from './modules/ai';
import { CatalogHttpModule } from './modules/catalog';
import { CustomerHttpModule } from './modules/customer';
import { FinBridgeHttpModule } from './modules/fin-bridge';
import { FinanceHttpModule } from './modules/finance';
import { IdentityHttpModule } from './modules/identity';
import { ImportsHttpModule } from './modules/imports';
import { InventoryHttpModule } from './modules/inventory';
import { NotificationsHttpModule } from './modules/notifications';
import { PartnersHttpModule } from './modules/partners';
import { PosHttpModule } from './modules/pos';
import { PricingHttpModule } from './modules/pricing';
import { SalesHttpModule } from './modules/sales';
import { SegmentsHttpModule } from './modules/segments';

/** The HTTP API (ROLE=api). Business modules are added here, one per session. */
@Module({
  imports: [
    CoreModule.forRoot('api'),
    DbModule,
    JobsModule,
    HttpCoreModule,
    HealthModule,
    LlmModule,
    FinanceCoreModule,
    FinBridgeHttpModule,
    IdentityHttpModule,
    CatalogHttpModule,
    PartnersHttpModule,
    InventoryHttpModule,
    ImportsHttpModule,
    PricingHttpModule,
    AiHttpModule,
    SegmentsHttpModule,
    SalesHttpModule,
    FinanceHttpModule,
    PosHttpModule,
    NotificationsHttpModule,
    CustomerHttpModule,
  ],
})
export class AppModule {}
