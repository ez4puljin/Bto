// Public API of the notifications module (docs/modules/notifications.md). Other modules import only
// this file; named exports only (ESLint G2 rejects `export *`). Only the customer app's facade
// imports it (ADR-0082); sales and finance reach it through their own listener tokens.
export {
  NotificationsHttpModule,
  NotificationsModule,
  NotificationsWorkerModule,
} from './notifications.module';
export {
  type CustomerNotice,
  type CustomerNotification,
  CustomerInboxService,
} from './services/customer-inbox.service';
export { CustomerNotifier } from './services/customer-notifier';
export { InboxService, type MyNotice, type MyNotification } from './services/inbox.service';
export {
  type NoticeInput,
  type NoticeProduct,
  NoticesService,
  type NoticeView,
} from './services/notices.service';
