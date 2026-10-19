import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { PartnersModule } from '../partners';
import { SALE_LISTENER } from '../sales';
import {
  AppNoticesController,
  MyNotificationsController,
} from './controllers/notifications.controller';
import { InboxService } from './services/inbox.service';
import { NoticesService } from './services/notices.service';
import { SaleNotifier } from './services/sale-notifier';

/**
 * Notifications v1 (docs/modules/notifications.md, ADR-0062): the admin's notices for the rep app
 * and the notifications addressed to one user. It answers sales' `SALE_LISTENER`; sales finds it
 * through `ModuleRef` and never imports this module. Push and SMS come later (deliveries 5–6).
 */
@Module({
  imports: [IdentityModule, CatalogModule, PartnersModule],
  providers: [
    NoticesService,
    InboxService,
    SaleNotifier,
    { provide: SALE_LISTENER, useExisting: SaleNotifier },
  ],
  exports: [NoticesService, InboxService, SALE_LISTENER],
})
export class NotificationsModule {}

/** The HTTP side of notifications (api only). */
@Module({
  imports: [NotificationsModule],
  controllers: [AppNoticesController, MyNotificationsController],
})
export class NotificationsHttpModule {}
