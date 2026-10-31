# Module `notifications` — contract

Status (notifications v1, built 2026-10-16 with the sales-rep app, ADR-0062):
- **App notices**: the admin writes a notice in the web (kind, title, text, a picture, up to 20 products, the days it runs, whether it pops up) and every sales rep's app shows it — a popup when the app opens, a count on the bell, a list. A sent notice is never edited; it is withdrawn.
- **The rep's own notifications**: when a rep's order reaches the sale, the rep is told («… борлуулалт боллоо», with the order's total and the invoice).
- **The customer app** (ADR-0079 #8, ADR-0082, 2026-10-19): a notice's audience (the sales reps or the customers); a store's own notifications — its order confirmed (with the backordered lines), cancelled (with the reason) or sold (the invoice), a payment recorded, an invoice due within 3 days or 1–7 days overdue — for every store with an app account; the morning job `notifications.invoiceReminders`.

Still to come (deliveries 5–6, architecture §4): push tokens and Expo push, SMS (OTP, delivery messages), templates, the driver's and the customer's notifications, notifications for other order states. Sending by zone, branch or person, and automatic promotion or price notices, wait for the owner (ADR-0062 #7).
- **Code:** `apps/api/src/modules/notifications/`; shared rules in `packages/shared/src/notifications`; the web page in `apps/web/src/features/notifications/`; the app's screens in `apps/mobile/app/(staff)/{notice-popup,notifications,notice/[id]}.tsx` and `apps/mobile/src/notifications/`.
- **Decisions:** ADR-0062 (everything here), ADR-0061 (the app), ADR-0060 #1 (the sales hooks it joins), ADR-0030 (file storage).
- **Architecture:** §4 (the row and the graph note).

notifications depends on these modules, always through their `index.ts`:
- `identity`: audit, `StorageService` (the picture: `verifyUploaded` before the transaction, `confirm` inside, `publicUrls`), `UserNamesService`, `PermissionHoldersService.activeHolders` (the recipients).
- `catalog`: `CatalogService.getMany` (a notice's products must be active and sale-ready; their names and thumbnails in the admin's list).
- `partners`: `CustomersService.getMany` (the customer's name on a sold order).
- `sales`: only the hook contracts `SALE_LISTENER` and `ORDER_LISTENER` (`sales/hooks.ts`) and the foreign key to `sales_orders`. **It never reads a sales table**; the sale hands it the facts by value.
- `finance` (ADR-0082): the hook contract `PAYMENT_LISTENER`, the foreign keys to `invoices` and `payments`, and `InvoiceQueryService.openDueBetween` for the reminders.
- `identity`'s `CustomerAccountsService` for a store's account.

Nobody imports `notifications`. Sales finds the listener through `ModuleRef` (`strict: false`) and does without it when the module is not loaded (the worker, tests that load sales alone).

## 1. Owner's answers behind the design (2026-10-16)

| Topic | Answer | Where |
|---|---|---|
| Delivery | inside the app: a popup when it opens, a count on the bell, a list; no push | ADR-0062 #3 |
| Recipients | every sales rep | ADR-0062 #2 |
| Content | the admin writes each notice by hand | ADR-0062 #1 |
| Order notifications | only when the rep's order is sold («Зөвхөн борлуулалт болсон захиалгын мэдэгдэл авна») | ADR-0062 #4 |

## 2. Owned tables (migration `0030_notifications`, numbered 0028 until the merge with main on 2026-10-19)

- `app_notices` — `kind` (PROMOTION, PRICE_DROP, NEW_PRODUCT, NEWS), `title` (1–80 characters after trimming), `body` (1–1,000), `image_file_id` → `files` (unique: a picture belongs to one notice), `popup`, `valid_from` (date), `valid_to` (exclusive, null = until withdrawn, `> valid_from`), `created_by` / `created_at`, `withdrawn_at` / `withdrawn_by` (both or neither). Index on `(valid_from, id)` where not withdrawn.
- `app_notice_products` — `(notice_id, product_id)` primary key, `position` 1–20, unique per notice: the order the app shows.
- `app_notice_reads` — `(notice_id, user_id)` primary key, `read_at`: a rep closed or opened the notice.
- `app_notices.audience` (`0031_customer_app`) — SALES_REPS (the default, every older notice) or CUSTOMERS; the rep app's summary and reads take SALES_REPS only, the customer app's CUSTOMERS only.
- `app_notice_customer_reads` (`0031`) — `(notice_id, customer_user_id)` primary key, `read_at`: a store's account read the notice.
- `customer_notifications` (`0031`) — `customer_user_id` → identity's `customer_users`, `kind` (ORDER_CONFIRMED, ORDER_CANCELLED, ORDER_SOLD, PAYMENT_RECORDED, INVOICE_DUE_SOON, INVOICE_OVERDUE), `order_id` / `invoice_id` / `payment_id` by kind (CHECK `customer_notifications_document`; an ORDER_SOLD carries its invoice too), `payload` jsonb by value, `created_at`, `read_at`; unique per kind and document; app may not update (but `read_at`), delete or truncate it, nor the customer reads.
- `user_notifications` — `user_id`, `kind` (ORDER_SOLD), `order_id` → `sales_orders` (required for ORDER_SOLD), `payload` jsonb (`orderNumber`, `customerId`, `orderTotal`, `invoiceNumber`; money as strings), `created_at`, `read_at`. Unique `(kind, order_id)`; indexes `(user_id, id)` and `(user_id)` where unread.

By hand: app may neither update nor delete any of these tables, nor truncate them; the column grants let it set `app_notices.withdrawn_at` / `withdrawn_by` and `user_notifications.read_at` only. (`SELECT … FOR UPDATE` on a notice works through the column grant.)

## 3. Public API (`modules/notifications/index.ts`)

| Export | What |
|---|---|
| `NotificationsModule`, `NotificationsHttpModule` | the services and the `SALE_LISTENER` binding; the controllers (api only) |
| `NoticesService` | `create(ctx, input)`, `list(query)`, `get(id)`, `withdraw(ctx, id)`, `productIdsOf(noticeIds)` |
| `InboxService` | `summary(ctx)`, `list(ctx, query)`, `read(ctx, { noticeIds, notificationIds })` (SALES_REPS notices only) |
| `CustomerInboxService` | the customer app's bell (ADR-0079 #8): `summary(customer)`, `list(customer, query)`, `read(customer, ids)` — the CUSTOMERS notices and the store's own notifications, always the token's own account |
| `CustomerNotifier` | bound to sales' `ORDER_LISTENER` and finance's `PAYMENT_LISTENER`, called by `SaleNotifier` for every sale; one `INSERT … ON CONFLICT DO NOTHING` for a store with an account; `remindInvoices(today)` for the morning job |

`SaleNotifier` (bound with `useExisting` to `SALE_LISTENER`) is not exported.

## 4. REST surface (`/api/v1`, permissions in brackets)

| Route | What |
|---|---|
| `GET /app-notices` [notifications.send] | every notice, newest first (keyset by id): its state today, its products in order, the picture's URL, `recipients` and `reads`, who sent and withdrew it |
| `POST /app-notices` [notifications.send, Idempotency-Key] | sends a notice: `{ kind, audience?, title, body, imageFileId?, productIds, validFrom, validTo?, popup }` → 201; `audience` SALES_REPS when left out; `recipients` counts the reps or the active app accounts |
| `POST /app-notices/:id/withdraw` [notifications.send] | withdraws it (a second time changes nothing) → the notice |
| `GET /me/notifications/summary` [signed in] | `{ unread, notices }`: the running notices (at most 50, newest first) with `productIds` and `read`, for holders of `sales.orders.rep`; `unread` adds the user's unread notifications |
| `GET /me/notifications` [signed in] | the user's own notifications, newest first (keyset by id), with the customer's name |
| `POST /me/notifications/read` [signed in] | `{ noticeIds?, notificationIds? }` (≤ 200 each) → `{ unread }`; ids that are not running or not the user's are ignored |

## 5. Rules worth knowing

- **Dates.** `validFrom` is today or later (Ulaanbaatar business date, `notPast`), `validTo` after it (`afterStart`). A notice is SCHEDULED before its first day, RUNNING until the day before `valid_to`, ENDED from `valid_to`, WITHDRAWN once withdrawn (`noticeState`, shared). The service passes `businessDate()`; no SQL uses `current_date`.
- **Characters** are counted as PostgreSQL's `length()` counts them (code points, `noticeTextLength`), after trimming; the DTO's own limit is only a coarse bound. An emoji counts as one.
- **Products** must be active and sale-ready when the notice is sent (`PRODUCT_NOT_SELLABLE` 409 with `productIds.<index>`; `NOT_FOUND` for an unknown id); one INSERT in product order, `position` keeps the admin's order. The app shows the products still on sale.
- **The picture** is verified before the transaction (a storage call) and confirmed inside it; a picture already attached is refused (`FILE_NOT_UPLOADED` 409).
- **Recipients** are counted when asked: active users whose roles carry `sales.orders.rep`, except those who hold it only through ADMIN. Reads by others (an admin trying the app) are stored but not counted.
- **The sale.** `saleInTx` calls the listener after the invoice (or without one) and before its SALE audit row, with or without finance. `SaleNotifier` writes one row for a `SALES_REP` order with an author, `ON CONFLICT DO NOTHING`, and never catches an error (a failed statement aborts the transaction, 25P02). Office orders write nothing.
- **Reading** is idempotent: a read row per user and notice (parallel reads leave one, integrity test), `read_at` set once.

## 6. Error codes introduced

None: `VALIDATION_FAILED` (`notPast`, `afterStart`, `isNotEmpty`, `maxLength`, the DTO's rules), `PRODUCT_NOT_SELLABLE`, `NOT_FOUND`, `FILE_NOT_UPLOADED`, `FILE_KIND_MISMATCH`.

## 7. Audit

`app_notices`: CREATE (kind, title, popup, dates, picture, products), WITHDRAW. Reads and notifications are not audited.

## 8. Screens

- **Web** «Апп» → «Мэдэгдэл» (`/app/notices`, moved from «Систем» → «Апп мэдэгдэл» `/system/app-notices`, which redirects; ADR-0127 #2; `apps/web/src/features/notifications/`): «Хэнд» (the sales reps, the default, or the customers of «Bto300»; ADR-0079 #8) in the form and as a badge in the list; the list (kind, title and text, popup / picture / products badges, the period with the last day, the state, «read / recipients», who sent it and when), withdrawing a running or scheduled notice through a confirmation; «Шинэ мэдэгдэл» (`?new=1`) with the phone's popup drawn beside the form, the picture resized in the browser (1,280 px) and uploaded as `notifications.notice_image`, products searched among sale-ready ones.
- **App** (`docs/modules/mobile.md`): the popup route, «Мэдэгдэл», a notice's products, the bell on «Профайл» and the Profile tab's count.

## 9. Tests

- Integration `apps/api/test/integration/notifications.int-spec.ts` (7): rights; a notice with a picture and products in order, a replayed send, the picture refused twice; the refusals (past day, end before start, 81 characters, blank title, an emoji counted once, 21 products, duplicates, an unknown kind, a product waiting for prices, an unknown product, no key) with nothing written; running-only notices newest first and reading by closing; the recipients without admins or disabled users; a rep's sold order notified once, read by its owner only, an office order notifying nobody; the withdrawal.
- Customer app: `customer-app-orders.int-spec.ts` (confirmed / cancelled / sold, read by the own store only), `customer-app-account.int-spec.ts` (payment recorded, the reminders once each, audiences and their reads); integrity `customer-auth-concurrency.spec.ts` (the 0031 guards).
- Integrity `apps/api/test/integrity/notifications-guards.spec.ts` (3): app cannot edit or delete notices, products, reads or notifications; only the withdrawal and `read_at` change; parallel reads leave one row.
- Shared `packages/shared/src/notifications/notifications.test.ts` (the state on a day, the character count) and the i18n coverage of kinds and states.
- Web `apps/web/src/features/notifications/notices-pages.test.tsx` (5); app `apps/mobile/src/notifications/feed.test.ts` (5).

## 10. Open items

- Push (Expo / FCM) with EAS at go-live, so a notice reaches a closed app (ADR-0061 #2).
- Housekeeping of old reads and notifications when they grow (none yet).
- The driver's notifications (delivery 5). The customer's notifications were built 2026-10-19 (ADR-0079 #8); the app's screens come with CA3.
