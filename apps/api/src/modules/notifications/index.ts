// Public API of the notifications module (docs/modules/notifications.md). Other modules import only
// this file; named exports only (ESLint G2 rejects `export *`). Nobody imports it today: sales
// reaches it through its own SALE_LISTENER token (ADR-0062 #6).
export { NotificationsHttpModule, NotificationsModule } from './notifications.module';
export { InboxService, type MyNotice, type MyNotification } from './services/inbox.service';
export {
  type NoticeInput,
  type NoticeProduct,
  NoticesService,
  type NoticeView,
} from './services/notices.service';
