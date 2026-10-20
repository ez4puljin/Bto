# Module `customer` — contract

Status: **CA2 built 2026-10-19** (the server of the customer app «Bto300», ADR-0079, ADR-0082). The app's screens (CA3, the `customer` variant of `apps/mobile`, ADR-0085) were built the same day: `docs/modules/mobile.md` §1a. **CA4 built 2026-10-20** (the home as a shop window, ADR-0092, ADR-0093): banners, the home, a section's list, a category's page, deals on every card; the app's new screens are CA5. Code: `apps/api/src/modules/customer/`; the office's «Апп» card lives in partners, the accounts and sign-in in identity (`docs/modules/identity.md` §2a), the hooks in sales, finance and notifications.

`customer` is a leaf: it depends on identity, catalog, partners, pricing, inventory, sales, finance and notifications through their `index.ts` and nobody imports it (ESLint `MODULE_DEPS.customer`, ADR-0082 #4). It reads segments only through catalog's `PRODUCT_SEGMENT_DIRECTORY` and `PRODUCT_SET_RESOLVER` hooks (ADR-0093 #3). It owns the routes a customer token reaches, the admins' banners and three small tables.

## 1. Owner's answers behind the design

ADR-0079 (the interview of 2026-10-18, the boards approved, «Холбоо барих» added 2026-10-19) and the defaults the owner approved with the CA2 plan on 2026-10-19 (ADR-0082 #6): a phone change needs a new code; order notifications for every order of a store with an account; reminders due within 3 days and 1–7 days overdue, once each; the sign-in phone as an app order's contact; the admin's warning only while accounts are active; «үлдсэн боломж» = limit − (balance + confirmed orders not yet invoiced), never below 0; empty office drafts hidden.

## 2. Owned tables (migration `0031_customer_app`)

| Table | Holds | Guards |
|---|---|---|
| `customer_favourites` | a store's ★: `customer_user_id` → `customer_users` (cascade), `product_id` → `products`, `created_at` | PK (account, product); app may not UPDATE or TRUNCATE |
| `company_contacts` | «Холбоо барих» (ADR-0079 #14; on «Профайл» since ADR-0092 #8): `role` (1–60), `name` (1–80), `phone` (E.164), `position` (unique, from 1), `shown`, created / updated by and at | CHECKs on the lengths and the phone; app may not TRUNCATE; a save deletes and rewrites the list in one transaction with one audit row |
| `app_banners` (`0036_customer_app_home`, ADR-0092 #5, ADR-0093 #1) | the home's banners: `image_file_id` (a `customer.banner_image` file, unique), `title` (1–80, the alt text), `link_kind` NONE / SEGMENT / CATEGORY / PRODUCT and `link_id` (no foreign key: re-checked on every read), `valid_from` / `valid_to` (exclusive), `position`, `archived_at`, created / updated by and at | CHECKs on the title, the kind, a link id exactly with a link, the period, the position; `app_banners_position` UNIQUE DEFERRABLE INITIALLY IMMEDIATE (a swap is one UPDATE; written by hand); app may not DELETE or TRUNCATE: a banner is archived |

## 3. Public API

None (nobody imports the module). `CustomerHttpModule` is loaded by the api's `AppModule` only.

## 4. REST surface (`/api/v1`)

Every `/customer-app/*` route is `@CustomerRoute()`: only a customer token reaches it (a staff token: 403 `STAFF_TOKEN`), and the store is always the token's own — no route takes a customer id from the client. Another store's order or invoice answers 404, as one that does not exist. Money: prices and orders in whole MNT strings, finance in two decimals.

| Route | What |
|---|---|
| `GET /customer-app/me` | the store: id, code, name, the sign-in phone, the centre (the branch of the active wholesale warehouses and their names), the default address, the payment term, `ordersOpen` (a stage takes app orders), `today` |
| `GET /customer-app/checkout` | `today`, `lastDay` (today + 60), the live addresses (the default first), the pickup centre, `ordersOpen` |
| `GET /customer-app/credit-check?amount=` | the cart's warning for its quoted total: `warnings` HOLD / OVERDUE / LIMIT, the overdue amount and oldest due date, the limit, what remains, the `excess`; never the hold's reason; the store may still send |
| `GET /customer-app/contacts` | the shown company contacts in order |
| `GET /customer-app/categories` | the category tree (id, parent, name) |
| `GET /customer-app/home` (ADR-0092, ADR-0093) | «Нүүр»: `today`; the running `banners` in their order (`link` SEGMENT / CATEGORY / PRODUCT, null without one or when the target is gone); `categories` — the top categories with listed products, by name, with `imageUrl` (their own picture, else a product's) and `productCount`; `sections` in the fixed order `recent`, `promotions`, `segment-<id>` (each shown segment, `title` = name, `subtitle` = description), `discounts`, `new`, `favourites`, each with `kind`, `lastDay` (promotions: the earliest last day), `total` and at most 10 `products`, «Дууссан» last; an empty section is left out |
| `GET /customer-app/sections/:key/products?sort&categoryIds&inStock&cursor&limit` | a section's full list (keys as above plus `deals` = promotions and discounts): `sort` DEFAULT (the row's order) / DEAL / NEW / PRICE_ASC / PRICE_DESC, «Дууссан» last; the cursor is pinned to the first page's day (another key or sort: 422); `total` on the first page; an unknown key, or a segment neither shown nor linked by a running banner: 404 |
| `GET /customer-app/categories/:id/page` | a category's page: the category, `productCount` (listed products of the subtree), its running banners, its `subcategories` with listed products (a product's thumbnail), the sections `new` and `deals` of the subtree; 404 unknown |
| `GET /customer-app/products?q&categoryIds&favourites&deals&new&inStock&sort&cursor&limit` | the shop (sales' rep shop read model with a home warehouse required): each product's units with the wholesale unit price, the base price, pictures, «Шинэ», the stock as `IN` / `LOW` / `OUT` (`stockWord`, never the number), `favourite`, the badge `deal` and `dealPrice` (ADR-0093 #4); the chips `deals` and `new` and «Зөвхөн байгаа бараа» (`inStock`, ADR-0092 #7); the first page's `total` and `favouriteCount` (the stars the shop still lists) |
| `GET /customer-app/products/batch?productIds=` | the cart, the ★ tiles, a notice's products — only products the shop lists |
| `GET /customer-app/thumbs` | every shop thumbnail for the phone to keep |
| `GET /customer-app/barcodes/:code` | the product and the unit a barcode names (a box barcode opens the box); 404 when no listed product carries it |
| `GET /customer-app/favourites`, `PUT` / `DELETE /customer-app/favourites/:productId` (204) | the stars, newest first; a product the shop does not list: 404 |
| `POST /customer-app/quote` (200) | `{ lines }` → `{ quote, stock, orderDeals }`: the WHOLESALE quote today (pricing's `Quote` shape), per line the stock word and `mayBackorder` (more than is free now), and each ORDER program's step reached and the next one with the amount still `missing` («500,000₮ хүрвэл 3%», ADR-0092 #3) |
| `POST /customer-app/orders` (`Idempotency-Key`) | «Захиалга илгээх»: fulfilment, delivery day (today … today + 60), address (DELIVERY: one of the store's live ones), payment, note, lines → 201 the order. Lands on the CUSTOMER_APP channel's stage (`SalesPipelinesService.customerAppPlacement`: locked FOR SHARE, live, action NONE, not own-orders-only — else 409 `CUSTOMER_APP_CLOSED`), numbered, unpriced, nothing reserved; the office confirms |
| `GET /customer-app/orders?from&to&cursor&limit` | every order of the store with lines, from every channel, archived included, newest first; each with the status in the customer's words (`state`), the rep's name for a SALES_REP order, the frozen total or a pending order's estimate, backordered lines, the cancel reason; the first page's summary (count, confirmed total, pending) |
| `GET /customer-app/orders/:id` | one order: lines with backordered base quantities, the progress stamps, the invoice once sold |
| `GET /customer-app/orders/:id/reorder` | «Дахин захиалах»: the lines for the cart, and the products left out (UNAVAILABLE, OUT_OF_STOCK, UNIT_CHANGED) |
| `GET /customer-app/account` | «Тооцоо»: balance (negative = an advance), the overdue amount and oldest due date, the limit and what remains (only with a limit), «Зээл хаалттай», the payment term, the tab counts |
| `GET /customer-app/invoices`, `GET /customer-app/invoices/:id` | the open invoices oldest due first with the days overdue or left; one invoice with its lines, discount, VAT, paid and credited amounts |
| `GET /customer-app/payments?cursor&limit` | the store's posted payments and refunds with their method (CASH / BANK) and the invoices each settled; `total` on the first page |
| `GET /customer-app/statement?from&to` | «Тооцооны хуулга» (ADR-0086, 2026-10-20): the balance before `from`, every ledger entry of `from` … `to` oldest first with its debit, credit, kind, number, invoice and the balance after it, a purchase's order and who took it (`orderId`, `orderNumber`, `orderChannel`, `orderTakerName`, ADR-0087), the totals and the closing balance; `to` today at the latest, at most 366 days (422 otherwise) |
| `GET /customer-app/orders/reps` | the reps who took the store's orders, by name: the order filter's «ХТ» (ADR-0087) |
| `GET /customer-app/bank-accounts` | the ACTIVE bank accounts finance marks «Харилцагчид харуулах» |
| `GET /customer-app/notifications/summary`, `GET /customer-app/notifications`, `POST /customer-app/notifications/read` | the bell: running notices for customers (with their product ids) and the store's notifications (kind, document ids, payload by value), read idempotently |
| `GET /customer/contacts` [`identity.settings.read`], `PUT /customer/contacts` [`identity.settings.manage`] | the admins' list: the whole ordered list each save (phones typed locally are stored in E.164) |
| `GET /customer/attention` [`sales.boards.manage`] | `{ activeAccounts, ordersOpen }`: the admin home's warning |
| `GET /customer/banners?archived` [`customer.home.manage`] | the live banners in position order (or the archived ones): picture URL, title, `linkKind` / `linkId` / `linkName`, `linkBroken`, period, `state` SCHEDULED / RUNNING / ENDED / ARCHIVED |
| `POST /customer/banners` [`customer.home.manage`, Idempotency-Key] | `{ imageFileId, title, linkKind, linkId?, validFrom, validTo? }` → 201: an uploaded `customer.banner_image`; `validFrom` today or later; the target a live product segment, a category or a product on sale (422 at `linkId`); placed last |
| `POST /customer/banners/:id/move` [`customer.home.manage`] | `{ direction: UP / DOWN }` → 200: swaps with the live neighbour; at the edge nothing changes |
| `POST /customer/banners/:id/archive` [`customer.home.manage`] | 204: off the app at once; never deleted |

Sign-in is identity's (`/auth/customer/*`, `docs/modules/identity.md` §3) and the office's card is partners' (`/customers/:id/app-account`, `docs/modules/partners.md` §4).

## 5. Rules worth knowing

- **Stock words** (`@tugeel/shared/sales` `stockWord`): OUT when nothing is free in the home warehouse; LOW below the home minimum when set, else below one whole pack (the unit the warehouse price is set in), else below 10 base units; IN otherwise. A product without a home warehouse is not in the shop.
- **States** (`customerOrderStateOf`): PENDING (draft, submitted), CONFIRMED, PREPARING (picking), READY (packed, dispatched, failed delivery), DELIVERED (delivered, invoiced, closed), CANCELLED.
- **The send** is the office's draft path: `SalesOrdersService.createInTx` with a `CustomerActor` (`created_by` NULL, `customer_user_id` set, events labelled `customer-app`), the sign-in phone as the contact. Credit checks, prices and reservations happen when the office moves the order to a CONFIRM stage.
- **The credit view** is computed without a lock from the cache, the live overdue amount and sales' open exposure; never through `CreditControlService.check`.
- **Accepted limit** (ADR-0082 #7): `mayBackorder` could let a store narrow the free stock down by trying quantities.
- **The home** (`CustomerHomeService`, ADR-0093 #5): one read per request of the shop's index (sales' `index()`: listed products in the NEW order with their category and sale-ready moment), of what is free at home (inventory) and of pricing's `DealBook` (the WHOLESALE programs in force today and the products they mark). Recent = the store's orders of the last 90 days (every channel, not cancelled; the most orders first); promotions and discounts by the size of the discount; segments and new products by the NEW order; favourites by the latest ♡. A stale segment (`SEGMENT_INVALID`) is skipped.
- **Deals** (ADR-0093 #4): a promotion has an end date; a product in a promotion and a discount is a promotion; one badge per card (a promotion first, a product's own program before a category's, then the bigger discount); the struck `dealPrice` only after unconditional programs, on one whole pack per base unit.
- **Banners** (ADR-0093 #1, #8): never edited; the picture is cut to 2:1 (1200×600) in the browser; a target gone after creation leaves the banner without its link; a CATEGORY banner also heads that category's page.

## 6. Error codes

`CUSTOMER_APP_CLOSED` (409). The home's routes use `NOT_FOUND` (an unknown section or category, a segment the app does not open) and `VALIDATION_FAILED` (a cursor of another key or sort; a banner's title, link, `notPast` start, `afterStart` end). Also used: `VALIDATION_FAILED` (`deliveryDate` `customerDay`, the DTOs), `NOT_FOUND`, `FORBIDDEN` (`STAFF_TOKEN`), `UNAUTHORIZED`, `PRODUCT_NOT_SELLABLE`, `PRODUCT_NO_HOME`, `CUSTOMER_INACTIVE`, `UNIT_SUPERSEDED`.

## 7. Audit

`company_contacts` UPDATE (`entityId` `list`, the list before and after). `app_banners` CREATE (the banner), MOVE (its position before and after), ARCHIVE (the banner before). The orders' rows are sales' (`sales_orders` CREATE by a CUSTOMER actor); sign-ins identity's. Favourites are not audited.

## 8. Screens (`apps/web`)

«Систем» → «Харилцагчийн апп» → «Баннер» (`/system/customer-app/banners`, `customer.home.manage`, `banners-page.tsx`, ADR-0093 #9): the live (or archived) banners in their order — picture, title, link («Ангилал: Ус, ундаа», «Холбоосгүй», «Холбоос ажиллахгүй»), period, state — with ↑ ↓ and «Архивлах» (asked first); «Баннер нэмэх» (`?new=1`) takes the picture (cut to 2:1 by `cropToJpeg`), the title, the link kind and its target (a product segment, a category path, a product on sale) and the first and last day. The «Харилцагчийн апп» page (`/system/customer-app`, `identity.settings.read` or `customer.home.manage`, `apps/web/src/features/customer-app/`) shows a «Баннер» card (how many run now) to the home's keepers, and to readers of the settings «Холбоо барих» in order (role, name, phone, Харагдана / Нуусан), with `identity.settings.manage` add, edit (role, name, phone checked with `normalizeMnPhone`, «Аппад харуулах»), up / down and remove, each saving the whole list; for `sales.boards.manage` a card «Аппын захиалга» telling whether app orders are taken and how many stores use the app, linking to «Самбар ба дамжлага». The home page warns holders of `sales.boards.manage` while stores use the app and no stage takes its orders («Тохируулах»). The channel dialog of «Сувгийн тохиргоо» offers CUSTOMER_APP only stages without an action in pipelines that are not own-orders-only. The «Апп» card and the list column are partners' screens (`docs/modules/partners.md` §8).

## 9. Tests

Home (ADR-0093): integration `customer-app-home.int-spec.ts` (sections hidden when empty and the fixed order, «Дууссан» last, the category grid, badge texts and the struck price, a promotion over a discount, ORDER programs only as the quote's hint, the shop's `deals` chip, another store's ♡ and orders never read, a banner's period, order, move and archive, refused banners and rights, a shown segment and its move, a customer segment refused, archived and hidden segments, section sorts, filters and cursors, the category page, a top category's picture and its loss on a move, a staff token refused); shared Vitest `pricing/deals.test.ts`, `sales.test.ts` (section keys); web Vitest `features/customer-app/banners-page.test.tsx`, `features/segments/segment-app-card.test.tsx`, `features/catalog/category-picture.test.tsx`, `lib/image-resize.test.ts`. Web (Vitest): `features/customer-app/customer-app-pages.test.tsx` (the menu, read-only and managed lists, add / reorder / edit / remove bodies, the orders card), the «Апп» card and the list filter in `partners-pages.test.tsx`, the bank-account switch in `finance-books.test.tsx`, the audience in `notices-pages.test.tsx`, the home warning in `home-page.test.tsx`, the channel dialog in `sales/settings-page.test.tsx`. Integration: `customer-app-shop` (words never numbers, a product without a home left out, ★ and the filter, the box barcode, the quote's `mayBackorder`, staff tokens refused), `customer-app-orders` (closed app, the NONE rule in the channel settings and in pipeline saves, a numbered order reserving nothing, the replay, refusals, confirmation / cancellation / sale notifications, every channel's orders, another store's 404, «Дахин захиалах»), `customer-app-account` (balance, limit and hold without its reason, overdue, the reminders once each, payments with their invoices, bank accounts, notice audiences, the contact list). Integrity: `customer-isolation` (every staff operation of the OpenAPI document refuses a customer token before anything runs, every customer operation a staff token, no undocumented route, another store's documents 404), `customer-auth-concurrency` (one code redeemed once by ten phones, ten parallel refreshes, the migration's guards).

## 10. Open items

- The owner's walk of «Bto300» on a phone (CA3 built 2026-10-19, `docs/STATUS.md`).
- CA5: the app's screens of ADR-0092 on the approved boards (`docs/modules/mobile.md` §6a).
- Banner editing and a cache of the shop index per business date only if asked (ADR-0093 follow-ups).
- Push (Expo with Firebase) with go-live; a customer's centre when Kharkhorin joins (a new ADR).
