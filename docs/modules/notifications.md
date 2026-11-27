# Module `notifications` — contract

Supplier price notifications (ADR-0246, local): `PRICE_CHANGED` is an internal bell notification for active holders of `pricing.prices.manage`, including ADMIN. The root composition binds pricing's `PRICE_CHANGE_NOTIFIER` to `ReceiptPriceNotifier`; both price evidence and inbox rows commit or roll back with receiving. `(kind, price_change_key, user_id)` deduplicates the immutable receipt/event batch, allowing a later first-checked-price batch after a missing-reference warning. `priceChange` on the existing inbox API has the receipt number/id, total change/warning/manual-replacement counts and at most twenty samples of each; the pricing receipt history contains all events. Only public old/new selling base prices and reason codes enter inbox JSON, never acquisition prices. No SMS, email or external push is sent. Existing order/phone notification shapes and ownership checks remain.

Status (notifications v1, built 2026-10-16 with the sales-rep app, ADR-0062):
- **App notices**: the admin writes a notice in the web (kind, title, text, a picture, up to 20 products, the days it runs, whether it pops up) and every sales rep's app shows it — a popup when the app opens, a count on the bell, a list. A sent notice is never edited; it is withdrawn.
- **The rep's own notifications**: when a rep's order reaches the sale, the rep is told («… борлуулалт боллоо», with the order's total and the invoice).
- **Settlement SMS** (ADR-0216, 2026-11-17, amending ADR-0079 #3): «Санхүү → Тооцооны SMS» lists a settlement group's customers with phone and receivable balance; a staff member with `finance.sms.send` ticks them, writes one text with placeholders and presses «Илгээх»; the server freezes one text per customer with that customer's own name and balance, and the worker sends them through WeSend (`notifications.sendSms`). Nothing is sent by itself; no OTP or sign-in SMS.
- **The customer app** (ADR-0079 #8, ADR-0082, 2026-10-19): a notice's audience (the sales reps or the customers); a store's own notifications — its order confirmed (with the backordered lines), cancelled (with the reason) or sold (the invoice), a payment recorded, an invoice due within 3 days or 1–7 days overdue — for every store with an app account; the morning job `notifications.invoiceReminders`.

Still to come (deliveries 5–6, architecture §4): push tokens and Expo push, templates, the driver's and the customer's notifications, notifications for other order states. Sending by zone, branch or person, and automatic promotion or price notices, wait for the owner (ADR-0062 #7).
- **Code:** `apps/api/src/modules/notifications/`; shared rules in `packages/shared/src/notifications`; the web page in `apps/web/src/features/notifications/`; the app's screens in `apps/mobile/app/(staff)/{notice-popup,notifications,notice/[id]}.tsx` and `apps/mobile/src/notifications/`.
- **Decisions:** ADR-0062 (everything here), ADR-0216 (settlement SMS), ADR-0061 (the app), ADR-0060 #1 (the sales hooks it joins), ADR-0030 (file storage).
- **Architecture:** §4 (the row and the graph note).

notifications depends on these modules, always through their `index.ts`:
- `identity`: audit, `StorageService` (the picture: `verifyUploaded` before the transaction, `confirm` inside, `publicUrls`), `UserNamesService`, `PermissionHoldersService.activeHolders` (the recipients).
- `catalog`: `CatalogService.getMany` (a notice's products must be active and sale-ready; their names and thumbnails in the admin's list).
- `partners`: `CustomersService.getMany` (the customer's name on a sold order).
- `sales`: only the hook contracts `SALE_LISTENER` and `ORDER_LISTENER` (`sales/hooks.ts`) and the foreign key to `sales_orders`. **It never reads a sales table**; the sale hands it the facts by value.
- `finance` (ADR-0082): the hook contract `PAYMENT_LISTENER`, the foreign keys to `invoices` and `payments`, and `InvoiceQueryService.openDueBetween` for the reminders; `ArLedgerService.balancesOfCustomers` for the settlement SMS (ADR-0216).
- `partners` for the SMS: `CustomersService.list` (a group's customers, paged through on the server) and `findByIds` (name, code, phone, group at the press of «Илгээх»); the foreign key `sms_messages.customer_id`.
- `integrations/sms` (WeSend), only from `SmsSettingsFlowService` and `SmsSendFlowService`, between transactions.
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
- `user_notifications` since ADR-0232 #9 (`0118_phone_agent`): the kinds `PHONE_ORDER` (with `order_id`) and `PHONE_CALLBACK` (with `callback_id` → phone-agent's `phone_callbacks`), one row for every active holder of `phone.calls.read`, written by `PhoneNotifier`, bound to phone-agent's `PHONE_AGENT_LISTENER`; payload `orderNumber`, `customerId`, `customerName`, `callId`, `phone`. The table-wide unique `(kind, order_id)` became one ORDER_SOLD per order plus `(kind, order_id, user_id)` and `(kind, callback_id, user_id)`. `GET /me/notifications` rows carry `callId`, `callbackId`, `phone`.

Settlement SMS (migration `0109_settlement_sms`, ADR-0216):

- `sms_settings` — one row (`id = 1`): `api_key_sealed` (WeSend's key sealed with `ERKHET_KEY_SECRET` under the context `sms_settings.api_key`), `enabled`, `updated_by` / `updated_at`. App may not delete or truncate it.
- `sms_batches` — one press of «Илгээх»: `purpose` SETTLEMENT, `settlement_group`, `template` as typed (1–1,000 characters), `status` QUEUED → SENDING → DONE, `total_count` and the counts written when the job ends (`sent_count`, `failed_count`, `skipped_count`, `credits_used`), `stopped_code` when an account refusal stopped it, `created_by` / `created_at`, `started_at`, `finished_at`. App may update only the status, the counts, `stopped_code` and the two times.
- `sms_messages` — one customer of a batch (unique per batch and customer): `customer_code`, `customer_name`, `phone` (E.164 or null), `text` (rendered and frozen), `balance` (the balance it was rendered with), `status` QUEUED / SENT / FAILED / SKIPPED, `idempotency_key` (uuid, unique, sent to WeSend as `bto-sms-<uuid>`), `provider_message_id`, `parts`, `credits`, `error_code` (`^[a-z_]{1,64}$`: WeSend's code or ours, `@tugeel/shared/notifications` `SMS_ERROR_CODES`), `sent_at`. CHECK: SENT ⇔ `sent_at` and the provider id; FAILED / SKIPPED ⇔ an error code. App may update only the outcome columns, never the number, the text or the balance.

By hand: app may neither update nor delete any of these tables, nor truncate them; the column grants let it set `app_notices.withdrawn_at` / `withdrawn_by` and `user_notifications.read_at` only. (`SELECT … FOR UPDATE` on a notice works through the column grant.)

## 3. Public API (`modules/notifications/index.ts`)

| Export | What |
|---|---|
| `NotificationsModule`, `NotificationsHttpModule` | the services and the `SALE_LISTENER` binding; the controllers (api only) |
| `NoticesService` | `create(ctx, input)`, `list(query)`, `get(id)`, `withdraw(ctx, id)`, `productIdsOf(noticeIds)` |
| `InboxService` | `summary(ctx)`, `list(ctx, query)`, `read(ctx, { noticeIds, notificationIds })` (SALES_REPS notices only) |
| `CustomerInboxService` | the customer app's bell (ADR-0079 #8): `summary(customer)`, `list(customer, query)`, `read(customer, ids)` — the CUSTOMERS notices and the store's own notifications, always the token's own account |
| `CustomerNotifier` | bound to sales' `ORDER_LISTENER` and finance's `PAYMENT_LISTENER`, called by `SaleNotifier` for every sale; one `INSERT … ON CONFLICT DO NOTHING` for a store with an account; `remindInvoices(today)` for the morning job |

| `SmsSettingsFlowService`, `SettlementSmsService` | exported from the Nest module only (for the HTTP module and the worker), not from `index.ts`: nobody else imports them |

`SaleNotifier` (bound with `useExisting` to `SALE_LISTENER`) is not exported.

## 4. REST surface (`/api/v1`, permissions in brackets)

| Route | What |
|---|---|
| `GET /app-notices` [notifications.send] | every notice, newest first (keyset by id): its state today, its products in order, the picture's URL, `recipients` and `reads`, who sent and withdrew it |
| `POST /app-notices` [notifications.send, Idempotency-Key] | sends a notice: `{ kind, audience?, title, body, imageFileId?, productIds, validFrom, validTo?, popup }` → 201; `audience` SALES_REPS when left out; `recipients` counts the reps or the active app accounts |
| `POST /app-notices/:id/withdraw` [notifications.send] | withdraws it (a second time changes nothing) → the notice |
| `GET /me/notifications/summary` [signed in] | `{ unread, notices }`: the running notices (at most 50, newest first) with `productIds` and `read`, for holders of `sales.orders.rep`; `unread` adds the user's unread notifications |
| `GET /me/notifications` [signed in] | the user's own notifications, newest first (keyset by id), with the customer's name |
| `GET /settlement-sms/customers?group&q&withBalance` [finance.read] | the group's customers in one read (paged through on the server, by name): code, name, phone, `balance` (as `GET /customer-balances`), `lastSentAt`, and the group's current `period` |
| `GET /settlement-sms/status` [finance.read] | `{ ready, reason }`: a key saved and opened, sending on (WeSend is not asked) |
| `GET /settlement-sms/balance` [finance.sms.send] | WeSend's balance for the dialog's estimate |
| `POST /settlement-sms/batches` [finance.sms.send, Idempotency-Key] | `{ group, customerIds, template, onlyWithBalance? }` → 201 the batch; texts frozen, job enqueued in the same transaction |
| `GET /settlement-sms/batches`, `GET /settlement-sms/batches/:id` [finance.read] | the history newest first; one batch with its counts (live while sending) and every message |
| `GET /sms/settings`, `PATCH /sms/settings`, `POST /sms/settings/test` [ai.settings.manage] | the key (write-only; `keyLast4` only), `enabled`, the balance check with a typed or the saved key |
| `POST /me/notifications/read` [signed in] | `{ noticeIds?, notificationIds? }` (≤ 200 each) → `{ unread }`; ids that are not running or not the user's are ignored |

## 5. Rules worth knowing

- **Dates.** `validFrom` is today or later (Ulaanbaatar business date, `notPast`), `validTo` after it (`afterStart`). A notice is SCHEDULED before its first day, RUNNING until the day before `valid_to`, ENDED from `valid_to`, WITHDRAWN once withdrawn (`noticeState`, shared). The service passes `businessDate()`; no SQL uses `current_date`.
- **Characters** are counted as PostgreSQL's `length()` counts them (code points, `noticeTextLength`), after trimming; the DTO's own limit is only a coarse bound. An emoji counts as one.
- **Products** must be active and sale-ready when the notice is sent (`PRODUCT_NOT_SELLABLE` 409 with `productIds.<index>`; `NOT_FOUND` for an unknown id); one INSERT in product order, `position` keeps the admin's order. The app shows the products still on sale.
- **The picture** is verified before the transaction (a storage call) and confirmed inside it; a picture already attached is refused (`FILE_NOT_UPLOADED` 409).
- **Recipients** are counted when asked: active users whose roles carry `sales.orders.rep`, except those who hold it only through ADMIN. Reads by others (an admin trying the app) are stored but not counted.
- **The sale.** `saleInTx` calls the listener after the invoice (or without one) and before its SALE audit row, with or without finance. `SaleNotifier` writes one row for a `SALES_REP` order with an author, `ON CONFLICT DO NOTHING`, and never catches an error (a failed statement aborts the transaction, 25P02). Office orders write nothing.
- **Settlement SMS** (ADR-0216). Placeholders `{Харилцагч_нэр}`, `{Эцсийн үлдэгдэл}` (whole MNT, `1,250,000`, no sign), `{Харилцагч_код}`, `{Тооцооны_өдөр}` (the customer's group's current due date, `YYYY.MM.DD`), rendered by `renderSmsTemplate` in `@tugeel/shared/notifications` on the server and in the dialog's preview; an unknown `{…}` is `SMS_TEMPLATE_INVALID` naming it. WeSend's counting (`smsSize`): Latin 155 characters per part, otherwise Unicode 65; more than 4 parts is `SMS_TOO_LONG` for the whole batch; 80₮ a part. A customer without a valid phone is SKIPPED `no_phone`; with `onlyWithBalance` one whose balance is no longer above zero is SKIPPED `no_balance`. The job sends message by message, re-reads each message as QUEUED before sending it and marks it only while it is still QUEUED, so a second run sends nothing; a crash between WeSend's answer and the mark is covered by the message's own `Idempotency-Key`. 429 is waited out (Retry-After, at most 30 s, three attempts); 401, 402 and 403 `sending_paused` / `forbidden` / `ip_not_allowed` stop the batch (`stopped_code`) and fail the rest with that code; a timeout is FAILED `timeout` and never resent. A batch whose job exhausted its retries stays SENDING with its QUEUED messages (none seen yet).
- **Reading** is idempotent: a read row per user and notice (parallel reads leave one, integrity test), `read_at` set once.

## 6. Error codes introduced

`SMS_NOT_CONFIGURED` 409 (no key, an unreadable key or sending switched off; `params.reason`), `SMS_KEY_SECRET_MISSING` 503, `SMS_TEMPLATE_INVALID` 422 (`params.placeholders`), `SMS_TOO_LONG` 422 (`params.code`, `parts`, `max`) — ADR-0216. Before that none: `VALIDATION_FAILED` (`notPast`, `afterStart`, `isNotEmpty`, `maxLength`, the DTO's rules), `PRODUCT_NOT_SELLABLE`, `NOT_FOUND`, `FILE_NOT_UPLOADED`, `FILE_KIND_MISMATCH`.

## 7. Audit

`app_notices`: CREATE (kind, title, popup, dates, picture, products), WITHDRAW. Reads and notifications are not audited. `sms_batches`: CREATE (group, template, customers, queued, skipped). `sms_settings`: CREATE / UPDATE (`hasKey`, `enabled`, `keyChanged`; never the key).

## 8. Screens

- **Web** «Апп» → «Мэдэгдэл» (`/app/notices`, moved from «Систем» → «Апп мэдэгдэл» `/system/app-notices`, which redirects; ADR-0127 #2; `apps/web/src/features/notifications/`): «Хэнд» (the sales reps, the default, or the customers of «Bto300»; ADR-0079 #8) in the form and as a badge in the list; the list (kind, title and text, popup / picture / products badges, the period with the last day, the state, «read / recipients», who sent it and when), withdrawing a running or scheduled notice through a confirmation; «Шинэ мэдэгдэл» (`?new=1`) with the phone's popup drawn beside the form, the picture resized in the browser (1,280 px) and uploaded as `notifications.notice_image`, products searched among sale-ready ones.
- **Web** «Санхүү» → «Тооцооны SMS» (`/finance/settlement-sms`, `apps/web/src/features/sms/`, ADR-0216): the group, the search and «Зөвхөн үлдэгдэлтэй» in the filter bar with the period; the list (tick, code, name, phone or «Утасгүй», balance, last SMS), the count and sum ticked; a code or a name opens `/finance/customers/:id?from&to` of the current period, whose page shows «Эхний үлдэгдэл / Дебит / Кредит / Эцсийн үлдэгдэл» for a chosen range; «SMS илгээх» opens the dialog (text, placeholder buttons, preview, characters, parts, cost, WeSend's balance, one confirmation, then the batch's progress and result); «Түүх» (`?view=history`, a batch at `&batch=`). «Систем → Тохиргоо → SMS» (`/settings?tab=sms`): the key, «Холболт шалгах», the switch.
- **App** (`docs/modules/mobile.md`): the popup route, «Мэдэгдэл», a notice's products, the bell on «Профайл» and the Profile tab's count.

## 9. Tests

- Integration `apps/api/test/integration/notifications.int-spec.ts` (7): rights; a notice with a picture and products in order, a replayed send, the picture refused twice; the refusals (past day, end before start, 81 characters, blank title, an emoji counted once, 21 products, duplicates, an unknown kind, a product waiting for prices, an unknown product, no key) with nothing written; running-only notices newest first and reading by closing; the recipients without admins or disabled users; a rep's sold order notified once, read by its owner only, an office order notifying nobody; the withdrawal.
- Customer app: `customer-app-orders.int-spec.ts` (confirmed / cancelled / sold, read by the own store only), `customer-app-account.int-spec.ts` (payment recorded, the reminders once each, audiences and their reads); integrity `customer-auth-concurrency.spec.ts` (the 0031 guards).
- Integrity `apps/api/test/integrity/notifications-guards.spec.ts` (3): app cannot edit or delete notices, products, reads or notifications; only the withdrawal and `read_at` change; parallel reads leave one row.
- Shared `packages/shared/src/notifications/notifications.test.ts` (the state on a day, the character count) and the i18n coverage of kinds and states.
- Settlement SMS: integration `apps/api/test/integration/settlement-sms.int-spec.ts` (6: the list's balances and rights, the write-only key and its check, an unknown placeholder and a long text refused, frozen texts with each balance and SENT / FAILED / SKIPPED, a second run and a crashed run sending nothing twice, a stop on `insufficient_credits`, the history and the statement totals); unit `packages/shared/src/notifications/sms.test.ts` (the renderer, the amount, the part counter) and `apps/api/src/integrations/sms/wesend.client.spec.ts`.
- Web `apps/web/src/features/notifications/notices-pages.test.tsx` (5); app `apps/mobile/src/notifications/feed.test.ts` (5).

## 10. Open items

- Settlement SMS: WeSend's `GET /v1/balance` answer shape was not seen by the builder (read as `balance`, `credits` or `data.balance`); a batch left SENDING after its retries is not swept yet.

- Push (Expo / FCM) with EAS at go-live, so a notice reaches a closed app (ADR-0061 #2).
- Housekeeping of old reads and notifications when they grow (none yet).
- The driver's notifications (delivery 5). The customer's notifications were built 2026-10-19 (ADR-0079 #8); the app's screens come with CA3.

### Receipt-price inbox storage (ADR-0246)

Price changes use `user_price_notifications`; legacy order/phone notifications and their kind constraint remain unchanged. Both allocate IDs from `user_notifications_id_seq`, preserving positive unique IDs and existing numeric cursors. Inbox pages merge the streams before cursor/limit; unread counts and idempotent reads are scoped to the current user across both tables. Only the sidecar read marker can be updated by the app; payloads and event-key/recipient pairs are durable. Receipt notifications are inserted in the same transaction as the price event, with duplicate event/recipient writes ignored.
