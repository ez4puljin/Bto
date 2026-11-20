import { Module } from '@nestjs/common';
import { DbModule } from './common/db/db.module';
import { HttpCoreModule } from './common/errors/http-core.module';
import { ReportGateModule } from './common/reports/report-gate.module';
import { JobsModule } from './common/jobs/jobs.module';
import { CoreModule } from './core.module';
import { FinanceCoreModule } from './finance-core';
import { HealthModule } from './health/health.module';
import { EbarimtIntegrationModule } from './integrations/ebarimt';
import { ElevenLabsIntegrationModule } from './integrations/elevenlabs';
import { ErkhetIntegrationModule } from './integrations/erkhet';
import { SmsIntegrationModule } from './integrations/sms';
import { LlmModule } from './integrations/llm';
import { PictureModule } from './integrations/picture';
import { ScannerModule } from './integrations/scanner';
import { AiHttpModule } from './modules/ai';
import { CatalogHttpModule } from './modules/catalog';
import { ChatHttpModule } from './modules/chat';
import { EbarimtHttpModule } from './modules/ebarimt';
import { EbarimtCheckHttpModule } from './modules/ebarimt-check';
import { CustomerHttpModule } from './modules/customer';
import { ErkhetHttpModule } from './modules/erkhet';
import { ErxesHttpModule } from './modules/erxes';
import { ExpiryHttpModule } from './modules/expiry';
import { FinBridgeHttpModule } from './modules/fin-bridge';
import { FinanceHttpModule } from './modules/finance';
import { HrHttpModule } from './modules/hr';
import { IdentityHttpModule } from './modules/identity';
import { ImportsHttpModule } from './modules/imports';
import { InventoryHttpModule } from './modules/inventory';
import { NotificationsHttpModule } from './modules/notifications';
import { PartnersHttpModule } from './modules/partners';
import { PayrollHttpModule } from './modules/payroll';
import { PhoneAgentHttpModule } from './modules/phone-agent';
import { PosHttpModule } from './modules/pos';
import { PricingHttpModule } from './modules/pricing';
import { PrintingHttpModule } from './modules/printing';
import { ProcurementHttpModule } from './modules/procurement';
import { ReportingHttpModule } from './modules/reporting';
import { SalesHttpModule } from './modules/sales';
import { SegmentsHttpModule } from './modules/segments';
import { StockProblemsHttpModule } from './modules/stock-problems';

/** The HTTP API (ROLE=api). Business modules are added here, one per session. */
@Module({
  imports: [
    CoreModule.forRoot('api'),
    DbModule,
    JobsModule,
    HttpCoreModule,
    ReportGateModule,
    HealthModule,
    LlmModule,
    PictureModule,
    ScannerModule,
    ErkhetIntegrationModule,
    EbarimtIntegrationModule,
    SmsIntegrationModule,
    ElevenLabsIntegrationModule,
    FinanceCoreModule,
    FinBridgeHttpModule,
    IdentityHttpModule,
    CatalogHttpModule,
    PartnersHttpModule,
    InventoryHttpModule,
    ImportsHttpModule,
    PricingHttpModule,
    AiHttpModule,
    HrHttpModule,
    PayrollHttpModule,
    SegmentsHttpModule,
    SalesHttpModule,
    FinanceHttpModule,
    PosHttpModule,
    NotificationsHttpModule,
    CustomerHttpModule,
    ReportingHttpModule,
    ProcurementHttpModule,
    EbarimtCheckHttpModule,
    ExpiryHttpModule,
    EbarimtHttpModule,
    ErkhetHttpModule,
    ErxesHttpModule,
    ChatHttpModule,
    PrintingHttpModule,
    StockProblemsHttpModule,
    PhoneAgentHttpModule,
  ],
})
export class AppModule {}
