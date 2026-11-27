import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { FinanceModule, PAYMENT_LISTENER } from '../finance';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { PHONE_AGENT_LISTENER } from '../phone-agent';
import { ORDER_LISTENER, SALE_LISTENER } from '../sales';
import {
  AppNoticesController,
  MyNotificationsController,
} from './controllers/notifications.controller';
import {
  SettlementSmsController,
  SmsSettingsController,
} from './controllers/settlement-sms.controller';
import { InvoiceRemindersJob } from './jobs/invoice-reminders.job';
import { SmsSendJob } from './jobs/sms-send.job';
import { CustomerInboxService } from './services/customer-inbox.service';
import { CustomerNotifier } from './services/customer-notifier';
import { InboxService } from './services/inbox.service';
import { NoticesService } from './services/notices.service';
import { PhoneNotifier } from './services/phone-notifier';
import { SaleNotifier } from './services/sale-notifier';
import { ReceiptPriceNotifier } from './services/receipt-price-notifier';
import { SettlementSmsService } from './services/settlement-sms.service';
import { SmsSendFlowService } from './services/sms-send-flow.service';
import { SmsSettingsFlowService } from './services/sms-settings-flow.service';

/**
 * Notifications (docs/modules/notifications.md, ADR-0062, ADR-0079 #8): the admin's notices for the
 * rep app and the customer app, the notifications addressed to one user and to one store. It
 * answers sales' `SALE_LISTENER` and `ORDER_LISTENER`, finance's `PAYMENT_LISTENER` and
 * phone-agent's `PHONE_AGENT_LISTENER` (ADR-0232 #9); none of those modules imports this one. Push comes with go-live. SMS reaches customers only as the settlement
 * reminders a permitted staff member sends by hand through WeSend (ADR-0216, amending ADR-0079 #3);
 * `SmsGateway` comes from the global SmsIntegrationModule of the composition roots.
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, FinanceModule],
  providers: [
    NoticesService,
    InboxService,
    CustomerInboxService,
    CustomerNotifier,
    SaleNotifier,
    PhoneNotifier,
    ReceiptPriceNotifier,
    SmsSettingsFlowService,
    SettlementSmsService,
    { provide: SALE_LISTENER, useExisting: SaleNotifier },
    // The phone AI line's new orders and callbacks (ADR-0232 #9).
    { provide: PHONE_AGENT_LISTENER, useExisting: PhoneNotifier },
    { provide: ORDER_LISTENER, useExisting: CustomerNotifier },
    { provide: PAYMENT_LISTENER, useExisting: CustomerNotifier },
  ],
  exports: [
    NoticesService,
    ReceiptPriceNotifier,
    SmsSettingsFlowService,
    SettlementSmsService,
    InboxService,
    CustomerInboxService,
    CustomerNotifier,
    SALE_LISTENER,
    ORDER_LISTENER,
    PAYMENT_LISTENER,
    PHONE_AGENT_LISTENER,
  ],
})
export class NotificationsModule {}

/** The HTTP side of notifications (api only). */
@Module({
  imports: [NotificationsModule],
  controllers: [
    AppNoticesController,
    MyNotificationsController,
    SettlementSmsController,
    SmsSettingsController,
  ],
})
export class NotificationsHttpModule {}

/** Registers the morning reminders and the SMS sender once the worker has started (worker only). */
@Injectable()
export class NotificationsJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly reminders: InvoiceRemindersJob,
    private readonly sms: SmsSendJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.reminders);
    await this.worker.register(this.sms);
  }
}

/**
 * The worker side of notifications: the customer app's invoice reminders (ADR-0079 #8) and the
 * settlement SMS batches (ADR-0216).
 */
@Module({
  imports: [NotificationsModule, JobsWorkerModule],
  providers: [InvoiceRemindersJob, SmsSendFlowService, SmsSendJob, NotificationsJobsBootstrap],
})
export class NotificationsWorkerModule {}
