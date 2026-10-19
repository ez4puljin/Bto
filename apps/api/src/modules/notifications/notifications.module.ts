import { Injectable, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { JobWorkerService } from '../../common/jobs/worker/job-worker.service';
import { JobsWorkerModule } from '../../common/jobs/worker/jobs-worker.module';
import { CatalogModule } from '../catalog';
import { FinanceModule, PAYMENT_LISTENER } from '../finance';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { ORDER_LISTENER, SALE_LISTENER } from '../sales';
import {
  AppNoticesController,
  MyNotificationsController,
} from './controllers/notifications.controller';
import { InvoiceRemindersJob } from './jobs/invoice-reminders.job';
import { CustomerInboxService } from './services/customer-inbox.service';
import { CustomerNotifier } from './services/customer-notifier';
import { InboxService } from './services/inbox.service';
import { NoticesService } from './services/notices.service';
import { SaleNotifier } from './services/sale-notifier';

/**
 * Notifications (docs/modules/notifications.md, ADR-0062, ADR-0079 #8): the admin's notices for the
 * rep app and the customer app, the notifications addressed to one user and to one store. It
 * answers sales' `SALE_LISTENER` and `ORDER_LISTENER` and finance's `PAYMENT_LISTENER`; neither
 * module imports this one. Push comes with go-live; there is no SMS (ADR-0079 #3).
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule, FinanceModule],
  providers: [
    NoticesService,
    InboxService,
    CustomerInboxService,
    CustomerNotifier,
    SaleNotifier,
    { provide: SALE_LISTENER, useExisting: SaleNotifier },
    { provide: ORDER_LISTENER, useExisting: CustomerNotifier },
    { provide: PAYMENT_LISTENER, useExisting: CustomerNotifier },
  ],
  exports: [
    NoticesService,
    InboxService,
    CustomerInboxService,
    CustomerNotifier,
    SALE_LISTENER,
    ORDER_LISTENER,
    PAYMENT_LISTENER,
  ],
})
export class NotificationsModule {}

/** The HTTP side of notifications (api only). */
@Module({
  imports: [NotificationsModule],
  controllers: [AppNoticesController, MyNotificationsController],
})
export class NotificationsHttpModule {}

/** Registers the morning invoice reminders once the worker has started (worker only). */
@Injectable()
export class NotificationsJobsBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly worker: JobWorkerService,
    private readonly reminders: InvoiceRemindersJob,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.worker.register(this.reminders);
  }
}

/** The worker side of notifications: the customer app's invoice reminders (ADR-0079 #8). */
@Module({
  imports: [NotificationsModule, JobsWorkerModule],
  providers: [InvoiceRemindersJob, NotificationsJobsBootstrap],
})
export class NotificationsWorkerModule {}
