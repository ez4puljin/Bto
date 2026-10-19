# Module `sales` — contract

Status (all built in delivery 2 on 2026-10-15):
- **Office orders** (ADR-0055): drafts, the submit that confirms, prices frozen in parts, reservations per line in the product's home warehouse with backorders, cancelling.
- **Boards and stages** (ADR-0056): stage actions run the submit, the picking (counts confirmed by the warehouse) and the sale (stock issued out of STAGING); rights by role; a printable pick list and delivery note.
- **Pipelines** (ADR-0057):
  - boards group pipelines, which hold the stages;
  - the warehouse sales page shows a pipeline as a board or as a list;
  - pipelines can be PRIVATE or own-orders-only, and one rights predicate covers every read;
  - finished orders can be archived and each stage has a shared card sort;
  - orders are numbered when created, in the company format.
- **Labels and paper** (ADR-0058): each order's label is its payment method, the card names who entered it, and both documents print on A4 or an 80 mm roll.
- **The order panel** (ADR-0059): an erxes-like deal view where an order is read, edited (header and products), moved along its stages and filled; new orders start from their customer in a dialog.
- **The sales-rep app's API** (ADR-0061, built 2026-10-15 for `apps/mobile`): `/sales-rep/*` gives a rep the stages they may place orders on, the shop (sale-ready products with wholesale unit prices and free stock), active customers, a new order created on the chosen stage (confirmed in the same transaction on a CONFIRM stage) and their own orders by days and search; since ADR-0068 the shop filters (category, home warehouse, main supplier, stock free at home), sorts (NEW, by base price) and lists the suppliers to filter by.

The rest of the sales reps' work (zones, visits, collections) comes in delivery 7 and the POS in delivery 9.
- **Code:** `apps/api/src/modules/sales/` (the rep facade: `controllers/sales-rep.controller.ts`, `services/sales-rep-orders.service.ts`, `services/sales-rep-shop.service.ts`, `services/rep-access.ts`); shared rules in `packages/shared/src/sales`; screens in `apps/web/src/features/sales/`; the app in `apps/mobile` (`docs/modules/mobile.md`).
- **Decisions:** ADR-0055, ADR-0056 (boards, stages, picking, the sale), ADR-0057 (pipelines, rights, numbers, the page), ADR-0058 (the payment label, A4 or 80 mm paper), ADR-0059 (the order panel), ADR-0061 (the sales-rep app), ADR-0068 (its design: filters, sorts, suppliers, orders by days), ADR-0048 #4 (quotes in parts), ADR-0044 (only complete products are sold), ADR-0009, ADR-0010.
- **Architecture:** §5.3 (reservations) and §5.6 (the state machine).

sales depends on these modules, always through their `index.ts`:
- `identity`: audit, numbering, access.
- `catalog`: products, units; `ProductQueryService` for the rep's shop.
- `partners`: customers, addresses, and the customer search `CustomersService.idsWhere`; `list` / `get` for the rep's customer picker.
- `pricing`: the quote; `ProductPricesService.tablesOf` for the shop's unit prices.
- `inventory`: home warehouses, `ReservationService`, `StockPostingService`.

Finance answers two hooks of `sales/hooks.ts` (`CREDIT_CHECKER`, `SALE_SINK`; ADR-0060 #1) and notifications the third (`SALE_LISTENER`, ADR-0062 #4); both import only those contracts from `sales/index.ts`; delivery will import sales too.

## 1. Owner's answers behind the design (2026-10-15)

**Office orders**
- The office enters the orders customers phone in; sales reps take orders in their app later (delivery 7).
- «Илгээх» confirms at once and reserves the stock (no second person while credit checks allow all).
- Each order has a delivery date (Claude's default: tomorrow; today allowed) and an address chosen from the customer's.
- A customer picks up or gets a truck delivery, chosen per order.
- Each line ships from its product's home warehouse; a product without one is not ordered.
- Quantities are entered in a chosen unit (box, block, piece).
- The office cancels an order before it is packed.
- An order carries a note, a contact person with a phone, and a payment method: cash, bank transfer or credit.

**Pipelines (ADR-0057)**
- Boards → pipelines → stages, as in erxes.
- The menu «Борлуулалт» → «Агуулахын борлуулалт» (the POS page joins in delivery 9).
- A stage's «⋯» menu: sort, print the documents of its cards, archive the finished cards, archive the stage. No favourites.
- A pipeline has a name, a board, a visibility, manage roles and stages, plus «own orders only».
- Order numbers look like `20261005_0001`: one numbering whatever the board, given when the order is created.
- «+» appears only on stages without an action.

## 2. Owned tables (migrations `0023_sales_orders`, `0024_sales_boards`, `0025_sales_pipelines`)

| Table | Holds | Guards |
|---|---|---|
| `sales_orders` | one row per order: <br>• `number` in the company format, drawn at creation (`20261015_0001`; older orders keep `SO-YYYY-NNNNNN`; NULL only on drafts made before ADR-0057) <br>• `channel` (ADMIN today), `status`, `customer_id` <br>• `fulfilment` PICKUP/DELIVERY, `delivery_date` <br>• `address_id` + the copied `address_text` / `address_lat` / `address_lng` <br>• `contact_name`, `contact_phone` (E.164) <br>• `payment_method` CASH/BANK_TRANSFER/CREDIT, `note` <br>• `price_date`, `subtotal` / `discount_total` / `total` <br>• submitted / confirmed / cancelled stamps and `cancel_reason` | • a submitted order has a number, a price date and a total <br>• DRAFT exactly when neither submitted nor cancelled <br>• CANCELLED exactly with `cancelled_at` <br>• a submitted DELIVERY has an address <br>• lengths; `total = subtotal − discount_total` <br>• unique number <br>• `REVOKE DELETE, TRUNCATE` from app |
| `sales_order_lines` | `line_no`, product, unit, `qty` (in the unit), `factor_snapshot`, `qty_base`, `warehouse_id` (the home), `qty_approved` (reserved) and `qty_backordered`, `qty_picked` + `pick_bin_id` (the confirmed pick), `qty_delivered` (the sale), line totals | quantities positive; approved + backordered ≤ qty base; `total = subtotal − discount`; lines are replaced when an order is edited (DELETE allowed, TRUNCATE revoked) |
| `sales_order_line_parts` | the quote's parts frozen at submit (ADR-0048 #4) | basis list; money signs; app may delete them when an order is edited (0024) |
| `order_status_events` | every state change: from, to, reason, actor, time | `REVOKE UPDATE, DELETE, TRUNCATE` |
| `sales_boards` | a group of pipelines: name, optional branch, position, archived | name 1–80; `REVOKE DELETE, TRUNCATE` |
| `sales_pipelines` | a pipeline: board, name, position, `visibility` PUBLIC/PRIVATE, `own_orders_only`, archived, creator | name 1–80; `REVOKE DELETE, TRUNCATE` |
| `sales_stages` | a pipeline's stage: name, position, `action` NONE/CONFIRM/PICK/SALE/CANCEL, `print_pick_list`, `print_delivery_note`, `card_sort` NEWEST/OLDEST/DELIVERY/TOTAL/WAITING, archived | action and sort lists; unique `(pipeline_id, id)`; `REVOKE DELETE, TRUNCATE` |
| `sales_pipeline_roles`, `sales_stage_roles` | roles per right: pipelines VIEW / MANAGE / ALL_ORDERS, stages VIEW / EDIT / MOVE | PK (id, role, right); dropped with the role (`ON DELETE CASCADE`) |
| `sales_channel_defaults` | per channel: the pipeline and stage its new orders land in | channel PK; `(pipeline_id, stage_id)` → the stage of that pipeline |
| `sales_stage_moves` | every card move: order, from, to, actor, time | `REVOKE UPDATE, DELETE, TRUNCATE` |
| `sales_settings` | one row (`id = 1`): `number_pattern`, `number_digits`, who changed it and when; no row = the shared defaults | pattern ends with a non-digit; digits 1–8; `REVOKE DELETE, TRUNCATE` |

`sales_orders` also carries:
- `pipeline_id`, `stage_id`, `stage_entered_at` (all three or none; `(pipeline_id, stage_id)` → the stage of that pipeline);
- `archived_at` / `archived_by` (only on DELIVERED, INVOICED, CLOSED or CANCELLED orders);
- `picked_at` / `picked_by` and `delivered_at` / `delivered_by` (a sale needs a pick).

Indexes: `(stage_id, id) WHERE archived_at IS NULL` for the board, `(pipeline_id, id)` for the list.

AI views (ADR-0045):
- `ai.sales_orders` names the board, pipeline and stage and carries `picked_at`, `delivered_at` and `archived_at`.
- `ai.sales_order_lines` carries `qty_picked` and `qty_delivered`.
- `ai.stock_movements` names `SO` documents.
- Datasets: `AI_DATASETS`, mn.json `ai.datasets`.

## 3. Public API (`modules/sales/index.ts`)

| Export | Use |
|---|---|
| `SalesModule` / `SalesHttpModule` | the services; + the controllers (api). The credit checker and the sale sink are resolved from finance through `ModuleRef` (`strict: false`); without finance every order passes and a sale ends DELIVERED |
| `SalesOrdersService.create / update / submit / move / pickInfo / pick / cancel / archive / unarchive / get / list / productInfo` | the order paths; each takes the caller's `AuthContext`. A SYSTEM actor skips the rights check |
| `SalesOrdersService.createInTx(tx, ctx, input, { channel, placement, numberLater? })`, `submitDraftInTx(tx, actor, id)` | a draft on a channel and its submit inside the caller's transaction (the rep facade, ADR-0061 #6): `placement` runs after the header checks; `numberLater` leaves the number to the submit, drawn after the stock's locks |
| `SalesAccessService.load(ctx)` | the caller's rights on pipelines and stages, and the SQL predicate every order read and action uses (ADR-0057 #2) |
| `SalesBoardsService` | the board groups: `tree`, create, rename, archive |
| `SalesPipelinesService` | pipelines and stages: `get`, `save` (whole, with the ordered stages), `copy`, `archive` / `unarchive`, `archiveStage`, `setSort`, `placementFor`, `lockStage(tx, stageId)` (the pipeline, then the stage, FOR SHARE), `stageRights`, `namesOf`, `printsOf` |
| `SalesOrderQueryService` | reads for the screens: `cards`, `list`, `details(ids)` |
| `SalesSettingsService` | the number format, the channel defaults, `allocateNumber(tx)` |
| `CREDIT_CHECKER`, `CreditChecker`, `CreditCheckInput`, `CreditDecision` | the hook finance binds (ADR-0060 #1, #2): `check(tx, { customer, orderId, amount, openOrders })` → ok, or refused with `reason` HOLD / OVERDUE / LIMIT and the amounts of the 409 `CREDIT_BLOCKED` |
| `SALE_SINK`, `SaleSink`, `SaleSnapshot`, `SoldLine`, `SoldPart` | the hook finance binds (ADR-0060 #3): `onSold(tx, actor, snapshot)` invoices the delivered quantities and returns the invoice, or null when nothing was delivered |
| `SALE_LISTENER`, `SaleListener`, `SaleNotice` | the hook notifications binds (ADR-0062 #4): `onSale(tx, notice)` with the order id and number, channel, author, customer, frozen total and invoice number, inside the sale's transaction; one statement, never caught |

`SalesRepOrdersService` (`context`, `create`, `list`, `map`, `storeOrders`, `get`) and `SalesRepShopService` (`productPage`, `productsOf`, `suppliers`, `customerPage`, `customer`) serve only `/sales-rep/*` and are not exported. The shop reads catalog's `ProductQueryService` (the list with a condition tree and `onlyIds`, `imagesOf`, `unitFlagsOf`) and `ProductFiltersService`, pricing's `shopPricesOf` and `orderedByBasePrice`, partners' `mainSupplierCounts` and inventory's `productIdsAvailableAtHome` (ADR-0068); the map reads partners' `CustomersService.located`; a store's order history (ADR-0068 #23) checks partners' `CustomersService.isVisible` and names the takers through identity's `UserNamesService.namesOf`; a draft's estimate (ADR-0068 #20) runs pricing's `PriceQuoteService.quote` outside any transaction.

## 4. REST surface

Permissions:
- `sales.orders.read` (OFFICE, ACCOUNTANT, WAREHOUSE, ADMIN) reads.
- `sales.orders.manage` (OFFICE, ADMIN; assignable) creates, submits and cancels.
- `sales.orders.pick` (WAREHOUSE, ADMIN) picks.
- `sales.boards.manage` (ADMIN; assignable) configures.
- `sales.orders.rep` (SALES_REP, ADMIN; assignable) opens `/sales-rep/*` only (ADR-0061 #5): a rep holds neither `sales.orders.read` nor `manage`, nor `partners.customers.read`. `/sales-rep/*` answers with the caller's own orders, with one exception: a store's order history (`GET /sales-rep/customers/:id/orders`, ADR-0068 #23) lists every order of the store, everyone's, as rows only; only the caller's own open.

Every board, pipeline and stage route carries `sales.orders.read`; the service checks the rest.

| Method and path | Notes |
|---|---|
| `GET /sales-orders?pipelineId \| pipeline=none&stageId&status&archived=exclude\|include\|only&q&customerId&mine&channel&fulfilment&paymentMethod&deliveryFrom&deliveryTo` | Keyset, newest first. Only what the caller may see. `q` matches the number, or customers through `idsWhere`. Rows carry the pipeline and stage names, `archivedAt`, `createdByName` and `paymentMethod` (the label, ADR-0058). `total` on the first page |
| `GET /sales-orders/batch?ids=…` | Up to 100 orders, full, for printing; unseen ids are left out |
| `GET /sales-orders/product-info?productIds=1,2` | Per product: home warehouse, `sellable` (active and complete), base units available there |
| `GET /sales-orders/:id` | Header (board, pipeline, stage, the caller's `rights`), lines with parts, events and moves with `actorName` (moves also `fromStageName` / `toStageName`, ADR-0059). 404 when not visible |
| `POST /sales-orders` (`Idempotency-Key`) | A draft, **numbered**: header + lines (≤ 200), `pipelineId?`, `stageId?` (#4). Refusals: `PRODUCT_NOT_SELLABLE`, `PRODUCT_NO_HOME`, `errors[].path = lines.N`, the shared header checks; the customer must be active |
| `PUT /sales-orders/:id` | DRAFT or CONFIRMED until picking. Replaces header and lines (the customer does not change). Needs the stage's EDIT right, or `sales.orders.manage` without a pipeline |
| `POST /sales-orders/:id/submit`, `/cancel` (200, `Idempotency-Key`) | DRAFT → CONFIRMED; `{ reason }` → CANCELLED |
| `POST /sales-orders/:id/move` (200, `Idempotency-Key`; the stage's MOVE right) | `{ stageId, reason? }`: a live stage of the order's pipeline. Runs the stage action. Answers `{ order, print }` unfiltered |
| `GET /sales-orders/:id/pick-info`, `POST /sales-orders/:id/pick` (`sales.orders.pick` + the write scope of every line's warehouse) | As ADR-0056 #5 |
| `POST /sales-orders/:id/archive`, `/unarchive` (200; the stage's EDIT right) | Only finished orders (`ORDER_STATE_INVALID`, `expected: FINISHED`) |
| `GET /sales-boards` | The tree: boards with the pipelines the caller sees; managers also see empty and archived ones (`?archived=true`) |
| `POST /sales-boards`, `PUT /sales-boards/:id`, `DELETE /sales-boards/:id` | `sales.boards.manage`. Name and branch. Archiving is refused while a live pipeline remains (`BOARD_NOT_EMPTY`) |
| `GET /sales-pipelines/:id` | Settings, roles, stages with the caller's `canView` / `canEdit` / `canMove`, `canManage`, `seesAll` |
| `POST /sales-pipelines`, `PUT /sales-pipelines/:id` | A whole save: name, board, visibility, `ownOrdersOnly`, roles, and the ordered stages (a stage without `id` is new; a live stage left out is archived, `STAGE_IN_USE`). Creating needs the permission; saving needs it or a MANAGE role |
| `POST /sales-pipelines/:id/copy` | `{ name, boardId }`: stages and roles, never orders or defaults |
| `POST /sales-pipelines/:id/archive`, `/unarchive` | Archive: `PIPELINE_IN_USE` while an unfinished order sits in it; its channel defaults go. Unarchive: refused while its board is archived |
| `GET /sales-pipelines/:id/cards?q&customerId&mine&channel&fulfilment&paymentMethod&deliveryFrom&deliveryTo` | Per visible stage `{ stageId, count, total, cards }`: the first 200 in the stage's sort, archived orders left out. A card carries `paymentMethod` and `createdByName` (ADR-0058) |
| `DELETE /sales-stages/:id` | Archive from the board's menu (manager or MANAGE) |
| `PUT /sales-stages/:id/sort` | `{ sort }`; stage EDIT |
| `POST /sales-stages/:id/archive-cards` | Every finished, unarchived order of the stage → `{ archived }`; stage EDIT |
| `GET /sales-settings/numbering`, `PUT /sales-settings/numbering` | `{ pattern, digits, updatedAt }` (the shared defaults until first saved). PUT: `sales.boards.manage`; the shared rules' issues at `pattern` / `digits`. The dialog's example is computed in the browser (`renderOrderNumber`, counter 1) |
| `GET /sales-settings/channels`, `PUT /sales-settings/channels` | Where each channel's new orders land (pipeline, stage); PUT: `sales.boards.manage` |

**The rep app** (`/sales-rep/*`, every route `sales.orders.rep`, ADR-0061 #5):

| Method and path | Notes |
|---|---|
| `GET /sales-rep/context` | `{ today, boards, defaultStageId, warehouses, branchNames }`: the server's business date (the phone never computes one); the boards (each with its `branchName`) → pipelines → stages the caller may place on (#5 below); the SALES_REP channel default when it is one of them; the ACTIVE WHOLESALE warehouses with their branches (the shop's location filter); the branches of the caller's write scope, TRANSIT left out (empty when unscoped) |
| `POST /sales-rep/orders` (`Idempotency-Key`) | The office order's header and lines with `stageId` instead of `pipelineId`; 201 with the order. A stage the caller may not place on: `VALIDATION_FAILED` at `stageId` (`repStage`). Otherwise the office's refusals (`PRODUCT_NOT_SELLABLE`, `PRODUCT_NO_HOME`, `CUSTOMER_INACTIVE`, `PRICE_MISSING`, `errors[].path = lines.N`) |
| `GET /sales-rep/orders?from&to&q&customerId&productId&paymentMethod&fulfilment&state&cursor&limit` | The caller's own SALES_REP orders created on the Ulaanbaatar days `from`…`to` (both included, real days, at most 366: else `VALIDATION_FAILED` at `from`/`to`), newest first; `q` finds an order number or a customer as the office list does (`filterSql`); `customerId`, `paymentMethod` (CASH/BANK_TRANSFER/CREDIT) and `fulfilment` (PICKUP/DELIVERY) through `filterSql` too, `productId` keeps the orders with a line of that product, `state` (`REP_ORDER_STATES`: DRAFT; ACTIVE = SUBMITTED, APPROVAL_PENDING, CONFIRMED, PICKING, PACKED, DISPATCHED, DELIVERY_FAILED; SOLD = DELIVERED, INVOICED, CLOSED; CANCELLED, by `repOrderStatusesOf`); the first page carries `summary { count, total, drafts, draftsEstimate }` over the range, search and filters (total of the orders not cancelled; `draftsEstimate` the sum of the kept drafts' estimates, a draft without one adding nothing, so the first page quotes every kept draft). Each row has `total` (null for a draft: prices are frozen at SUBMIT, unchanged) and `estimatedTotal` (ADR-0068 #20): a DRAFT's lines quoted as one cart by `PriceQuoteService.quote` — the resolver of `POST /pricing/quote` and the submit — on the WHOLESALE list at today's business date, whole MNT, never stored; null for every other status, or when a line has no price today or the quote refuses the lines (a superseded unit, an inexact quantity). Drafts are quoted one by one (a cart's ORDER/CATEGORY programs and quantity steps count over that cart alone), their lines loaded in one query. The month form is gone (ADR-0068 #8) |
| `GET /sales-rep/map` | `{ today, freshDays, data }` for the app's map: every ACTIVE customer the caller may see with a GPS point (`CustomersService.located`: the default address's point, else the oldest active address's), by name, each `{ customerId, code, name, phone, addressId, address, lat, lng (6 decimals), lastOrderId, lastOrderAt, lastOrderDate, stale, creditHold, creditHoldReason }` (`addressId`: the customer address whose point is shown, ADR-0068 #21; `creditHold` and its reason: the customer's manual hold, drawn black, ADR-0068 #28). The last order is the caller's own newest SALES_REP order for the customer that is not cancelled (drafts count; another rep's never), its day in Ulaanbaatar; `stale` = none, or none within `freshDays` = `REP_MAP_FRESH_DAYS` (7) days, today included (`storeIsStale`) |
| `GET /sales-rep/orders/:id` | Header, lines with parts, reserved and backordered quantities, events. A DRAFT also carries `estimatedTotal` on the order and on each line (the same quote as the list's row; a line without a price today has none, and then the order has none; `POST /sales-rep/orders` answers a draft with it too); null for every other status, whose `total` is the frozen one. 404 for any order the caller did not create through the app |
| `GET /sales-rep/products?q&categoryIds&warehouseId&supplierIds&inStock&sort&cursor&limit`, `GET /sales-rep/products/batch?productIds=1,2&priceBefore` | ACTIVE, sale-ready products (`ProductQueryService`), each with its units' WHOLESALE price today and its `basis`, `uomCode` and `isDefaultSales`, the home warehouse and the base units available there, `sellable`, `isNew` (sale-ready within 14 days), `basePrice` (one base unit in whole packs, the warehouse price; null without terms), `images` (the primary first). Filters (ADR-0068 #5): `categoryIds` (repeated, each with its subtree), `warehouseId` (the home) and `supplierIds` (repeated, main suppliers) as one condition tree, `inStock` (free at home) as `onlyIds`; `sort` NEW (default) or PRICE_ASC/PRICE_DESC (unpriced last; above 100,000 products `SELECTION_TOO_LARGE`; a cursor names its sort and day); the first page's `total`. The batch keeps only products the list would show; `priceBefore` adds each `basePriceBefore` on that day (a price-drop notice) |
| `GET /sales-rep/suppliers` | The main suppliers of the shop's products (ACTIVE and sale-ready), with how many each has, the most first: the filter's supplier list |
| `GET /sales-rep/thumbs` | `{ urls }`: the primary picture's thumbnail of every product the shop lists (relative URLs that never change), for the phone to keep once (ADR-0068 #15); catalog's `primaryThumbsOf` over the same shop ids as the suppliers' list |
| `GET /sales-rep/customers?q&cursor&limit`, `GET /sales-rep/customers/:id` | ACTIVE customers (`CustomersService.list`, so `visibleTo` applies): id, code, name, phone, address. One customer: its live addresses (the default first) and contacts; 404 when not ACTIVE. No credit data |
| `GET /sales-rep/customers/:id/orders?cursor&limit` | A store's order history (ADR-0068 #23): every order of a customer the caller may see (`CustomersService.isVisible`, else 404 `NOT_FOUND`), any channel, author and status, newest first, keyset by id (`limit` 20 by default, 1–50; `REP_STORE_ORDER_PAGE_LIMIT`). Each `{ id, number, status, channel, createdAt, createdDate, createdTime, takerName, mine, total, estimatedTotal, lineCount }`: `createdDate` / `createdTime` (HH:mm) in Ulaanbaatar; `takerName` the author's full name (null when unknown); `mine` = the caller's own SALES_REP order, exactly what `GET /sales-rep/orders/:id` opens (a rep's own order on another channel is not `mine`); `total` frozen, `estimatedTotal` a DRAFT's quote as in the list (#20). No lines and no other detail of another person's order |

## 5. Rules worth knowing

- **Rights (ADR-0057 #2).**
  - A PUBLIC pipeline is open to every holder of `sales.orders.read`; a PRIVATE one to its VIEW roles. MANAGE and ALL_ORDERS imply VIEW; `sales.boards.manage` holders see and configure everything.
  - A stage right with no roles is open to every holder of the permission it needs: VIEW to `sales.orders.read`, EDIT and MOVE to `sales.orders.manage`.
  - **Own orders only:** without MANAGE or ALL_ORDERS, a user sees only the orders they created. Switching it off clears ALL_ORDERS. Pickers need ALL_ORDERS on such pipelines.
  - One predicate covers cards, counts, totals, the list, search, the order page, printing, pick information and every action (an order the caller cannot see answers 404).
  - Orders without a pipeline stay open to `sales.orders.read`.
  - The AI assistant sees every order.
- **Numbers (ADR-0057 #3).**
  - At creation, last in the transaction: the pattern rendered with today's Ulaanbaatar date gives the prefix; `NumberingService.next(tx, 'SO_NO', prefix)` gives the counter. One counter for every pipeline, gap-free per prefix.
  - The pattern ends with a non-digit and never starts with `SO-`; a collision answers 409 `ORDER_NUMBER_TAKEN`.
  - A draft created before ADR-0057 takes its number at the submit.
- **Placement and locks (ADR-0057 #4).**
  - A new order lands in the chosen pipeline or the channel default.
  - With `stageId` (from «+»), it lands in that live, action-less stage open to the caller's MOVE; else in the pipeline's channel stage, else its first live stage.
  - Nothing configured: no pipeline.
  - Creating and moving lock the order, then the pipeline and the stage FOR SHARE. Saving and archiving lock the pipeline FOR UPDATE.
- **Archive and sort (ADR-0057 #5, #6).**
  - Archiving needs a finished order (DELIVERED, INVOICED, CLOSED, CANCELLED); it leaves the board, its counts and totals.
  - A stage is sorted for everyone: NEWEST / OLDEST by id, DELIVERY by date (no date last), TOTAL largest first, WAITING by `stage_entered_at`.
  - A stage holding only finished orders may be archived.
- **Stage actions (ADR-0056 #3)** run inside the move's transaction after the order row and the stage rights are checked:
  - CONFIRM submits a draft (below) and leaves a confirmed order alone.
  - PICK sets CONFIRMED → PICKING.
  - SALE needs PACKED and posts `DELIVERY_ISSUE` out of STAGING by `qty_picked` (document `SO`, external), then sets DELIVERED with `delivered_at`; with finance bound it hands the sale sink a snapshot (header, lines with delivered base quantities and frozen parts, the branch of the pipeline's board or of the first line's warehouse) and, when an invoice comes back, sets INVOICED with an event whose reason is the invoice number (ADR-0060 #3). Then, with or without finance, it tells the sale listener (ADR-0062 #4: a SALES_REP order's author gets «… борлуулалт боллоо»), and records the SALE audit row last.
  - CANCEL cancels with the reason (`reason` required). NONE moves only.
  - Moving back undoes nothing. Every move writes a `sales_stage_moves` row and an audit `MOVE`. Moves between pipelines are refused.
- **Picking (ADR-0056 #5).**
  - One pick per order: each line's `qty_picked` goes from its `pick_bin_id` into STAGING through `StockPostingService.post`, with `reservationConsume` on every line.
  - A second pick is refused (PACKED); a hand-posted repeat hits the ledger's idempotency key (`ALREADY_POSTED`).
- **Editing a reserved order (ADR-0056 #4):** re-quoted today; parts rewritten; reservations replaced in one lock pass (`ReservationService.replaceInTx`). The number, pipeline and stage stay.
- **Submit** (one transaction), in this order:
  1. the order row FOR UPDATE;
  2. header checks again;
  3. the customer row (`lockForUpdate`; inactive → `CUSTOMER_INACTIVE`);
  4. products sellable with a home;
  5. `PriceQuoteService.quote` (`PRICE_MISSING`);
  6. the credit check (ADR-0060 #2): the customer's other CONFIRMED … DELIVERED orders summed under the lock, then `CreditChecker.check`; a refusal is 409 `CREDIT_BLOCKED` with the amounts;
  7. parts and totals written;
  8. `ReservationService.reserveInTx` (rows in (warehouse, product) order; the rest backordered);
  9. a number for a draft that has none (an older draft, or the rep app's on a CONFIRM stage), before the CONFIRMED row;
  10. events SUBMITTED and CONFIRMED, audit `CONFIRM`.
- **The rep app (ADR-0061 #5, #6).**
  - A rep may place an order on a stage when its pipeline is live and PUBLIC or visible to one of the rep's roles, the stage is live with action NONE or CONFIRM, and its MOVE right has no roles or one of the rep's (`repMayPlace`, `services/rep-access.ts`). A holder of `sales.boards.manage` may place on any live NONE or CONFIRM stage. Admins limit reps per stage with MOVE roles.
  - One transaction: `lockStage` (the pipeline, then the stage, FOR SHARE), the rule checked on what was locked, `createInTx` on the `SALES_REP` channel; a NONE stage keeps a numbered draft, a CONFIRM stage runs `submitDraftInTx` (the submit above) and the number is drawn last. Any refusal rolls everything back.
  - Reads go by `created_by = caller AND channel = 'SALES_REP'`, never through `Access.visibleSql()`; the office sees the rep's orders through the pipeline rules as usual.
- **Prices** are today's (Ulaanbaatar) at the submit; the delivery date does not change them.
- **Cancel** releases the order's ACTIVE reservations (`releaseInTx`) and records the reason.
- **Backorders** stay on the line.
- **Reconciliation:** the nightly check compares `warehouse_stock.reserved` with the ACTIVE reservations (level RESERVED).

## 6. Error codes introduced

`PRODUCT_NO_HOME`, `PRODUCT_NOT_SELLABLE`, `STAGE_IN_USE` (409, with the stage's id and name), `BOARD_NOT_EMPTY`, `PIPELINE_IN_USE`, `ORDER_NUMBER_TAKEN` (409).

Also used: `ORDER_STATE_INVALID` (409; `expected: FINISHED` for archiving), `CUSTOMER_INACTIVE`, `PRICE_MISSING`, `CREDIT_BLOCKED` / `CREDIT_NEEDS_APPROVAL` (delivery 3), `UNIT_SUPERSEDED`, `UNIT_FACTOR_INEXACT`, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`.

## 7. Audit

- **`sales_orders`:**
  - CREATE (number, pipeline, stage; the rep app's order on a CONFIRM stage has its number in the CONFIRM row);
  - UPDATE (a draft or a reserved order: the new total and backorders);
  - CONFIRM (total, backordered lines);
  - MOVE (stage before and after, the action);
  - PICK (the lines picked, how many short);
  - SALE;
  - CANCEL (status before, reason, reservations released);
  - ARCHIVE / UNARCHIVE (one row per order, also from a stage's «⋯»).
- **`sales_boards`:** CREATE, UPDATE, ARCHIVE.
- **`sales_pipelines`:** CREATE, UPDATE (settings, roles, stage order), COPY, ARCHIVE, UNARCHIVE.
- **`sales_stages`:** CREATE, UPDATE, ARCHIVE, SORT.
- **`sales_channel_defaults`:** UPDATE.
- **`sales_settings`:** UPDATE (pattern and digits before and after).

## 8. Screens (`apps/web`)

- **«Борлуулалт» → «Агуулахын борлуулалт»** (`/sales/boards`, `sales.orders.read`, ADR-0057). The page:
  - **Left panel:** the boards, each folding out into the pipelines the user sees; it folds away, and on phones it is a select.
  - **Header:** the breadcrumb, the pipeline's name with its board, «Самбарын тохиргоо» and «Шинэ захиалга».
    - «Самбарын тохиргоо» opens the settings page for managers, or the pipeline's sheet in place for a MANAGE role.
    - «Шинэ захиалга» opens the create dialog with the pipeline (ADR-0059).
  - **Bar:**
    - «Захиалга хайх»;
    - «Шүүлтүүр» with chips: customer (for holders of `partners.customers.read`), delivery date, «Миний оруулсан», channel, fulfilment, payment;
    - «N захиалга»;
    - «Харуулах»: Самбараар / Жагсаалтаар.
  - The URL keeps `?pipeline=` and `?view=`; the last pipeline, the view and the panel are kept per user in the browser (`tugeel.salesWork.v1:<userId>`).
  - `/sales/orders` opens the list view.
- **Board view.**
  - One column per visible stage: name, count, total.
  - «+» on stages without an action where the user may move: the order editor opens with the pipeline and the stage.
  - The stage's «⋯» menu:
    - «Эрэмбэлэх»: the five sorts as a radio group in the menu itself (no submenu), ticked; EDIT.
    - «Баримт хэвлэх»: the kind, then a checklist of the stage's cards, all ticked, up to 100, drafts disabled for the delivery note; opens one printable page.
    - «Дууссан картуудыг архивлах»: EDIT, after a question.
    - «Шат архивлах»: managers.
  - A card shows its label beside the number (the payment method: «Зээл» orange, «Бэлнээр» green, «Дансаар» blue) and «Оруулсан: name · channel» (ADR-0058).
  - Cards are dragged between columns or moved through their «Зөөх» menu; a CANCEL stage asks the reason first. After a move, the stage's documents are offered as buttons after the paper switch.
  - A card opens the order panel (below); «+» opens the create dialog on that stage.
- **List view.**
  - Scope «Энэ дамжлага / Бүгд / Дамжлагагүй», filters «Шат», «Төлөв», «Архивласан».
  - Columns: number, customer, stage, status, delivery date, total, payment (the label), entered by, channel, created. A `ColumnChooser` is kept per user.
  - «Цааш үзэх» loads more; a row opens the order panel.
- **The order panel** (ADR-0059; `order-panel.tsx` and its sections), opened from a card or a list row; the URL keeps `?order=&tab=`:
  - **Header:** number, customer · board / pipeline, status, payment label, «Архивласан»; the paper switch, «Бэлтгэх хуудас», «Падаан» (with prices); «⋯»: «Илгээх» (a draft outside every pipeline, `sales.orders.manage`), «Архивлах» / «Сэргээх» (finished, EDIT), «Цуцлах» (cancellable, `sales.orders.manage`, a reason).
  - **«Ерөнхий»:** the stage steps and select (moves by the board's rules; waits while edits are unsaved), the facts as chips (customer, delivery date, fulfilment, payment, branch, board / pipeline, entered by and when, total), the note, the five latest activity entries.
  - **«Мэдээлэл»:** the header in a `DetailCard`, edited while the order may change (DRAFT or CONFIRMED, `canEdit`); saved with the stored lines (a confirmed order is priced and reserved again).
  - **«Бараа»:** search by name or code (`matchesQuery`), warehouse and «Бэлтгэсэн эсэх» filters, the lines with unit, quantity, unit price by part, amount, reserved, backordered, picked; editing adds products (`ProductSearch`), changes units and quantities, removes lines, and «Хадгалах» sends them with the stored header; frozen prices, or a quote of the edited lines as an estimate (`useLinesQuote`, 300 ms after a change); unsellable products block saving.
  - **«Бэлтгэх»:** the pick form, for pickers while CONFIRMED or PICKING.
  - **«Түүх»:** created (and where it landed), stage moves, state changes with reasons, archiving; newest first.
  - Unsaved edits survive a change of section; closing asks first.
- **New order:** «Шинэ захиалга» or a stage's «+» opens a dialog (`?new=1&stage=`): customer, payment (default «Бэлнээр»), pipeline (the stage shown when fixed). It creates the numbered draft without lines (a pickup for tomorrow) and opens its panel on «Бараа». `/sales/orders/new` and `/sales/orders/:id` redirect to the dialog and the panel.
- **Printing** (ADR-0056 #7), pages without the shell that print themselves in the browser's dialog:
  - `/sales/orders/:id/print/:kind`: one document;
  - `/sales/print/:kind?ids=…`: up to 100, one per sheet;
  - **paper** (ADR-0058): `?format=a4|80mm`, else this computer's last choice (`tugeel.printFormat.v1`, every user of the browser), else A4. The switch «A4 | 80 мм» stands before every print button and on the page.
  - **A4:** `@page { size: A4; margin: 12mm }`, tables.
  - **80 mm:** `@page { margin: 0 }` without a size (the receipt printer's driver gives the roll); a 72 mm column, black only, rows instead of columns.
  - Both documents name the payment and who entered the order; the pick list keeps a section per warehouse with its line count.
- **Settings «Самбар ба дамжлага»** (`/sales/boards/settings`, `sales.boards.manage`):
  - **Left:** the boards, with «+» (name, branch), rename and archive.
  - **Right:** the pipelines table of the chosen board (name, created, by whom, status). The row «⋯» menu: Засах, Хуулбарлах, Архивлах / Сэргээх, Дамжлага руу очих.
  - **Header buttons:**
    - «Дугаарлалт»: the pattern with token buttons, the digits, a preview of the next number.
    - «Сувгийн тохиргоо»: per channel the pipeline and stage.
    - «+ Дамжлага нэмэх»: a side sheet saved at once, with two tabs:
      - «Ерөнхий»: name, board, Нийтийн / Хувийн with VIEW roles, MANAGE roles, «Зөвхөн өөрийнхийг харуулах» with the ALL_ORDERS roles;
      - «Шатууд»: rows with up / down, the stage dialog (name, action, documents, VIEW / EDIT / MOVE roles), remove, «+ Шат нэмэх».

## 9. Tests

**Shared** (Vitest): `sales.test.ts`: dates, address, phone, cancellable and finished states, the number pattern and its rendering.

**Integration**
- `sales-orders.int-spec.ts`:
  - refusals, product info;
  - submit with frozen parts;
  - two warehouses and a backorder;
  - idempotent replay;
  - cancel and release;
  - rights;
  - list filters, `total`, search, the row's `paymentMethod`;
  - numbering: format, counter shared by pipelines, PUT refusals;
  - audit.
- `sales-pipelines.int-spec.ts`:
  - boards and the tree;
  - the whole save of a pipeline with its stages;
  - visibility, MANAGE and ALL_ORDERS;
  - copy;
  - archive refusals;
  - channels.
- `sales-boards.int-spec.ts`:
  - moves through CONFIRM / PICK / SALE / CANCEL;
  - «+»;
  - cards, sorts, filters;
  - archive;
  - own orders only on every path;
  - hidden stages;
  - the card's `paymentMethod` and `createdByName` (ADR-0058);
  - the names in an order's moves and events (ADR-0059).
- `sales-rep.int-spec.ts` (ADR-0061):
  - reps kept to the app (no office order route, no customer list) and the office kept out of it;
  - the NONE and CONFIRM stages a rep may place on, and the channel default;
  - a numbered draft on a NONE stage, on the rep channel, reserving nothing;
  - a CONFIRM stage confirming in the same transaction: prices frozen, stock reserved, the rest short;
  - refusals leave nothing behind (a stage of another kind, an unseen stage, bad data);
  - a repeated send replayed, the same key with another body refused;
  - only the rep's own rep orders, by Ulaanbaatar days (the day boundary at 16:00 UTC) and by a customer or number search; impossible days, a reversed range and more than 366 days refused;
  - the rep's order on the office board, where the office moves it on.
- `sales-rep-map.int-spec.ts`: the order history's customer, product, payment, fulfilment and state filters narrow the page and the summary (alone, together and with a search; the cursor keeps them; bad values refused); a draft's `estimatedTotal` (row, order and lines) equals `POST /pricing/quote` of its lines while `total` stays null; a submitted or cancelled order has none and its real total; a draft whose product lost its price keeps the priced line's estimate and has no order estimate; `draftsEstimate` sums the kept drafts' (by customer, ACTIVE gives 0) and later pages keep the rows' estimates; the map lists only located active customers, with the default point or else the oldest active one's (and its `addressId`), by name; the caller's own last order (a cancelled one or another rep's does not count, a draft does); stale with no order or one 7 days old, fresh at 6; 403 without the rep permission. The map carries a customer's manual credit hold with its reason for every rep, and drops both when the hold is lifted (ADR-0068 #28).
- `sales-rep-shop.int-spec.ts`: active, sale-ready products with the prices pricing gives and free stock; products by id, leaving out those the shop would not list; active customers with their addresses, the default first; the routes need the rep permission.
- `sales-rep-shop-filters.int-spec.ts` (ADR-0068): NEW with products made sale-ready together, page by page; a cursor of another sort refused; the price sorts both ways with the unpriced last; category subtrees, the home warehouse, main suppliers and stock free at home (reserved stock is not); the bad filters refused; pictures, unit flags, the home, the base price and the price on a day before; `/products` without the rep's fields; the suppliers' counts; the context's warehouses (inactive ones left out), the rep's branches and a board's branch.

**Unit:** `rep-access.spec.ts`: the placement rule (open stages, the permission and live rows, MOVE roles and private pipelines, managers).

**Integrity**
- `sales-races.spec.ts`: the last 30 pieces, opposite line orders, cancels.
- `sales-rep-races.spec.ts` (ADR-0061): five reps on a CONFIRM stage and the office's confirm over the last 30 pieces: 30 reserved, the rest backordered, six distinct numbers.
- `sales-picking.spec.ts`: short picks, pick vs submit, edit vs submit, no second pick.
- `sales-pipelines.spec.ts`: archiving a stage while moving into it; concurrent creates numbered without gaps.

**Web**
- `features/sales/sales-pages.test.tsx`: the menu; a new order from its customer to submitted; a confirmed order's reservations and cancelling; the header edited in «Мэдээлэл»; a reader without edits
- `order-panel.test.tsx`: stage steps and a CANCEL stage's question, the activity with names, the products' search and filters, unsaved edits across sections and on closing, the pick section
- `work-page.test.tsx`
- `settings-page.test.tsx`
- `print-page.test.tsx`: the pick list by warehouse on the roll, the paper from the address or the computer, the switch
- `order-filters.test.ts`

## 10. Open items

- **Later:**
  - moving an order between pipelines;
  - archiving old finished cards automatically;
  - a pick per warehouse for an order spanning branches;
  - cancelling a PACKED order (picked goods back to shelves);
  - what backordered quantities become;
  - a receipt printer through the print agent (ADR-0022);
  - the suggested shelf on the pick list before picking (ADR-0058 follow-up);
  - free labels per pipeline beside the payment label.
- **Delivery 3 (done 2026-10-16, ADR-0060):** the credit check without tolerance, invoices from delivered quantities (`docs/modules/finance.md`). No `open_orders` cache: sales sums its own open orders under the customer lock. Still open: CLOSED when the invoice is paid; payments shown in the order panel.
- **Customer app, sales reps:** the 24-hour re-quote applies once a submit no longer confirms at once.
- **Delivery 7 (rep zones):** `GET /sales-rep/customers/:id` and the customer check of a rep's order read the customer by id; they must go through `CustomersService.visibleTo` once it scopes reps to zones.
- **Delivery 9:** the POS page («ПОС борлуулалт»).
