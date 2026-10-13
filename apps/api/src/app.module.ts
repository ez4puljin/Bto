import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { HttpCoreModule } from './common/errors/http-core.module';
import { JobsModule } from './common/jobs/jobs.module';
import { CoreModule } from './core.module';
import { HealthModule } from './health/health.module';
import { LlmModule } from './integrations/llm';
import { AiHttpModule } from './modules/ai';
import { CatalogHttpModule } from './modules/catalog';
import { IdentityHttpModule } from './modules/identity';
import { ImportsHttpModule } from './modules/imports';
import { InventoryHttpModule } from './modules/inventory';
import { PartnersHttpModule } from './modules/partners';
import { PricingHttpModule } from './modules/pricing';

/** The HTTP API (ROLE=api). Business modules are added here, one per session. */
@Module({
  imports: [
    CoreModule.forRoot('api'),
    DbModule,
    JobsModule,
    HttpCoreModule,
    HealthModule,
    LlmModule,
    IdentityHttpModule,
    CatalogHttpModule,
    PartnersHttpModule,
    InventoryHttpModule,
    ImportsHttpModule,
    PricingHttpModule,
    AiHttpModule,
  ],
})
export class AppModule {}
