# Module `sales` — contract

Status: **office orders built** in delivery 2, session of 2026-10-15 (ADR-0055): drafts, the submit that confirms, prices frozen in parts, reservations per line in the product's home warehouse with backorders, cancelling. **Boards and stages** the same day (ADR-0056): configurable boards per branch whose stage actions run the submit, the picking (counts confirmed by the warehouse) and the sale (stock issued out of STAGING), rights by role, printable pick list and delivery note. Sales reps come in delivery 7, the POS in delivery 9. Code: `apps/api/src/modules/sales/`, shared rules in `packages/shared/src/sales`, screens in `apps/web/src/features/sales/`. Decisions: ADR-0055, ADR-0056 (boards, stages, picking, the sale), ADR-0048 #4 (quotes in parts), ADR-0044 (only complete products are sold), ADR-0009, ADR-0010, architecture §5.3 (reservations) and §5.6 (the state machine).

sales depends on `identity` (audit, numbering, access), `catalog` (products, units), `partners` (customers, addresses), `pricing` (the quote) and `inventory` (home warehouses, `ReservationService`), always through their `index.ts`. Nothing imports `sales` yet (delivery and finance will).

## 1. Owner's answers behind the design (2026-10-15)

- The office enters the orders customers phone in; sales reps take orders in their app later (delivery 7).
- «Илгээх» confirms at once and reserves the stock (no second person while credit checks allow all).
- Each order has a delivery date (Claude's default: tomorrow; today allowed) and an address chosen from the customer's.
- A customer picks up or gets a truck delivery, chosen per order.
- Each line ships from its product's home warehouse; a product without one is not ordered.
- Quantities are entered in a chosen unit (box, block, piece).
- The office cancels an order before it is packed.
- An order carries a note, a contact person with a phone, and a payment method: cash, bank transfer or credit.

## 2. Owned tables (migrations `0023_sales_orders`, `0024_sales_boards`)

| Table | Holds | Guards |
|---|---|---|
| `sales_orders` | one per order: `number` (`SO-YYYY-NNNNNN`, NULL while a draft), `channel` (ADMIN today), `status`, `customer_id`, `fulfilment` PICKUP/DELIVERY, `delivery_date`, `address_id` + the copied `address_text` / `address_lat` / `address_lng`, `contact_name`, `contact_phone` (E.164), `payment_method` CASH/BANK_TRANSFER/CREDIT, `note`, `price_date`, `subtotal` / `discount_total` / `total`, submitted / confirmed / cancelled stamps and `cancel_reason` | number, price date and total exactly when submitted; DRAFT exactly when neither submitted nor cancelled; CANCELLED exactly with `cancelled_at`; a submitted DELIVERY has an address; lengths; `total = subtotal − discount_total`; unique number; `REVOKE DELETE, TRUNCATE` from app |
| `sales_order_lines` | `line_no`, product, unit, `qty` (in the unit), `factor_snapshot`, `qty_base`, `warehouse_id` (the home), `qty_approved` (reserved) and `qty_backordered`, `qty_picked` + `pick_bin_id` (the confirmed pick, ADR-0056), `qty_delivered` (the sale), line totals | quantities positive; approved + backordered ≤ qty base; `total = subtotal − discount`; a draft's lines are replaced when it is edited (DELETE allowed, TRUNCATE revoked) |
| `sales_order_line_parts` | the quote's parts frozen at submit (ADR-0048 #4): unit, `uom_name`, `basis`, qty, factor, qty base, list price, unit price, subtotal, discount, total, `applied` (jsonb: the programs) | basis list; money signs; `REVOKE DELETE, TRUNCATE` |
| `order_status_events` | every state change: from, to, reason, actor, time | `REVOKE UPDATE, DELETE, TRUNCATE` |
| `sales_boards` | a board: name, optional branch, position, archived | name 1–80; `REVOKE DELETE, TRUNCATE` |
| `sales_stages` | a board's stage: name, position, `action` NONE/CONFIRM/PICK/SALE/CANCEL, `print_pick_list`, `print_delivery_note`, archived | action list; `REVOKE DELETE, TRUNCATE` |
| `sales_board_roles`, `sales_stage_roles` | roles per right: boards VIEW/MANAGE, stages VIEW/EDIT/MOVE | PK (id, role, right); dropped with the role (`ON DELETE CASCADE`) |
| `sales_channel_defaults` | per channel: the board and stage its new orders land in | channel PK |
| `sales_stage_moves` | every card move: order, from, to, actor, time | `REVOKE UPDATE, DELETE, TRUNCATE` |

`sales_orders` also carries `board_id`, `stage_id`, `stage_entered_at` (all three or none), `picked_at` / `picked_by` and `delivered_at` / `delivered_by` (a sale needs a pick). An edited order rewrites its price parts, so app may delete `sales_order_line_parts` again (0024).

AI views (ADR-0045): `ai.sales_orders` (with the board, stage, `picked_at`, `delivered_at`), `ai.sales_order_lines` (with `qty_picked`, `qty_delivered`); `ai.stock_movements` names `SO` documents (`AI_DATASETS`, mn.json `ai.datasets`).

## 3. Public API (`modules/sales/index.ts`)

| Export | Use |
|---|---|
| `SalesModule` / `SalesHttpModule` | the service; + the controller (api). `CreditChecker` is bound to `AllowAllCreditChecker` (finance replaces it in delivery 3) |
| `SalesOrdersService.create / update / submit / move / pickInfo / pick / cancel / get / list / productInfo` | below; `create` and `update` take the `AuthContext` (placement and stage rights) |
| `SalesBoardsService.list / get / create / update / archive / setBoardRoles / addStage / updateStage / reorderStages / archiveStage / defaults / setDefault / placementFor / stageRights / cards / printsOf` | boards, stages, rights and cards (ADR-0056); `isManager(ctx)` = holds `sales.boards.manage`; a board's `canManage` = a MANAGE role of the caller; a right with no roles is open to every holder of the sales permission it needs |
| `CreditChecker`, `AllowAllCreditChecker`, `CreditDecision` | `check(tx, lockedCustomer, amount)` → OK / NEEDS_APPROVAL / BLOCKED |

## 4. REST surface (`/api/v1/sales-orders`)

`sales.orders.read` (OFFICE, ACCOUNTANT, WAREHOUSE, ADMIN) reads; `sales.orders.manage` (OFFICE, ADMIN; assignable) writes.

| Method and path | Notes |
|---|---|
| `GET /sales-orders?status&customerId&q` | keyset, newest first; `q` = part of the number; customer name and code, line count, total |
| `GET /sales-orders/product-info?productIds=1,2` | per product: home warehouse, `sellable` (active and complete) and the base units available there |
| `GET /sales-orders/:id` | header, lines with parts, events |
| `POST /sales-orders` (`Idempotency-Key`) | a DRAFT: header + lines (≤ 200); every line's product must be sellable with a home (`PRODUCT_NOT_SELLABLE`, `PRODUCT_NO_HOME`, `errors[].path = lines.N`); header checks of `@tugeel/shared/sales` (`deliveryDate` notPast, `addressId` required for a delivery and one of the customer's live addresses, `contactPhone` a mobile number); the customer must be active |
| `PUT /sales-orders/:id` | replaces a draft's header and lines (the customer does not change); 409 `ORDER_STATE_INVALID` after the submit |
| `POST /sales-orders/:id/submit` (200, `Idempotency-Key`) | DRAFT → CONFIRMED (below) |
| `POST /sales-orders/:id/cancel` (200, `Idempotency-Key`) | `{ reason }` required; DRAFT or CONFIRMED → CANCELLED; reservations released |
| `POST /sales-orders/:id/move` (200, `Idempotency-Key`, `sales.orders.read` + the stage's MOVE right) | `{ stageId, reason? }`: a live stage of the order's board; runs the stage action (below); answers `{ order, print: [PICK_LIST \| DELIVERY_NOTE] }` |
| `GET /sales-orders/:id/pick-info`, `POST /sales-orders/:id/pick` (200, `Idempotency-Key`; `sales.orders.pick` + the write scope of every line's warehouse) | per line the proposed shelf (the fixed one, else the fullest) and the shelves holding the product; the pick: every line once with `qty` (0 … `qty_base`) and `binId` of its warehouse; CONFIRMED/PICKING → PACKED |
| `GET /sales-boards`, `GET /sales-boards/:id`, `GET /sales-boards/:id/cards` (`sales.orders.read`) | the boards the caller sees (`?archived=true` for managers), one board, its visible stages' cards (newest 200 per stage, count and total) |
| `GET /sales-boards/defaults`, `PUT /sales-boards/defaults` (`sales.boards.manage` in the service) | where each channel's orders land |
| `POST /sales-boards`, `PUT /sales-boards/:id`, `DELETE /sales-boards/:id` (archive), `PUT /sales-boards/:id/roles`, `POST /sales-boards/:id/stages`, `PUT /sales-boards/:id/stage-order`, `PUT /sales-stages/:id`, `DELETE /sales-stages/:id` (archive) | configuring: `sales.boards.manage`, or a MANAGE role of the board (creating boards and defaults: the permission only); a stage holding cards or receiving a channel is not archived (`STAGE_IN_USE`) |

## 5. Rules worth knowing

- **Stage actions (ADR-0056 #3)**, run inside the move's transaction after the order row and the stage rights are checked: CONFIRM submits a draft (below) and leaves a confirmed order alone; PICK sets CONFIRMED → PICKING; SALE needs PACKED and posts `DELIVERY_ISSUE` out of STAGING by `qty_picked` (document `SO`, external), DELIVERED with `delivered_at`; CANCEL cancels with the reason (`reason` required); NONE moves only. Moving back undoes nothing. Every move is a `sales_stage_moves` row and an audit `MOVE`.
- **Picking (ADR-0056 #5).** One pick per order: each line's `qty_picked` from its `pick_bin_id` into the warehouse's STAGING bin through `StockPostingService.post` with the order as an external document and `reservationConsume` on every line (CONSUMED where stock moved, RELEASED where picked at zero); more than reserved may be picked when the shelf holds it. PACKED, `picked_at`; audit `PICK`. A second pick is refused (PACKED), and even a hand-posted repeat hits the ledger's idempotency key (`ALREADY_POSTED`).
- **Editing a reserved order (ADR-0056 #4).** DRAFT or CONFIRMED (not from PICKING on); on a board the stage's EDIT right, off it `sales.orders.manage`. A CONFIRMED order is re-quoted today, its parts rewritten and its reservations replaced in one lock pass (`ReservationService.replaceInTx`); number, board and stage stay.
- **Placement (ADR-0056 #2).** A new order lands on the chosen board (its channel default, else the first live stage) or on the channel's default; without one it has no board and cannot be moved.

- **Submit** (one transaction): the order row FOR UPDATE → header checks again → the customer row (`lockForUpdate`, inactive → `CUSTOMER_INACTIVE`) → products sellable with a home (the line's warehouse is set again to the home) → `PriceQuoteService.quote({ WHOLESALE, today, lines }, tx)` (a line without a price → `PRICE_MISSING` naming the SKUs) → `CreditChecker` → parts and totals written → `ReservationService.reserveInTx` (the `warehouse_stock` rows in (warehouse, product) order; each line takes what is available, the rest is `qty_backordered`) → `SO-` number last → events SUBMITTED and CONFIRMED, audit `CONFIRM`.
- **Prices** are today's (Ulaanbaatar) at the submit; the delivery date does not change them.
- **Cancel** releases the order's ACTIVE reservations (`releaseInTx`) and records the reason; a cancelled draft keeps no number.
- **Backorders** stay on the line; what happens to them (a later order, picking) comes with picking.
- **Reconciliation**: the nightly check compares `warehouse_stock.reserved` with the ACTIVE reservations (level RESERVED).

## 6. Error codes introduced

`PRODUCT_NO_HOME`, `PRODUCT_NOT_SELLABLE`, `STAGE_IN_USE` (409). Also used: `ORDER_STATE_INVALID` (409), `CUSTOMER_INACTIVE`, `PRICE_MISSING`, `CREDIT_BLOCKED` / `CREDIT_NEEDS_APPROVAL` (delivery 3), `UNIT_SUPERSEDED`, `UNIT_FACTOR_INEXACT`, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`.

## 7. Audit

`sales_orders` CREATE (with the stage), UPDATE (a draft or a reserved order: the new total and backorders), CONFIRM (number, total, backordered lines), MOVE (stage before and after, the action), PICK (the lines picked, how many short), SALE, CANCEL (status before, reason, reservations released); `sales_boards` CREATE, UPDATE (name, branch, roles, stage order), ARCHIVE; `sales_stages` CREATE, UPDATE, ARCHIVE; `sales_channel_defaults` UPDATE.

## 8. Screens (`apps/web`)

- Menu «Борлуулалт» → «Захиалга» (`sales.orders.read`): `/sales/orders` — search by number, a status filter, rows that open the order (number or «Ноорог №N», customer, pickup or delivery, date, lines, total, status).
- `/sales/orders/new` and a draft's page (`sales.orders.manage`): «Захиалгын мэдээлэл» (customer picker, pickup or delivery, date, the customer's addresses with the default chosen, the contact with the customer's contacts offered, payment, note) and «Бараа» (product search, unit select with pack counts, quantity, the home warehouse and the stock available there, a refusal note for a product that cannot be ordered); «Үнэ тооцоолох» shows today's parts (the calculator's table, `features/pricing/quote-table.tsx`); `StickyActions` «Ноорог хадгалах» and «Илгээх» (asked first; a toast «SO-… захиалга батлагдлаа»).
- A confirmed or cancelled order: the header read-only (with its board and stage), a note when lines are backordered, the lines with reserved and backordered quantities, the frozen price parts, the history, «Цуцлах» with a reason.
- **«Борлуулалт» → «Самбар»** (`/sales/boards`, ADR-0056, `sales.orders.read`): the board chosen among the visible ones (grouped by branch), a column per visible stage (name, count, total), cards (number or «Ноорог №N», customer, total, delivery date, status, channel, who entered it) dragged between columns (HTML5 drag and drop onto a stage the user may move into) or moved through the card's «Зөөх» menu (phones, keyboards, tests); a CANCEL stage asks the reason first; after a move the stage's documents are offered as buttons («Баримт хэвлэх»); a card opens a side `Sheet` with the order (`OrderView`), «Захиалгыг нээх», the print buttons, and for `sales.orders.pick` on a CONFIRMED/PICKING order the pick form (per line the picked base quantity and the shelf, the fixed shelf proposed with the stock on each). «Шинэ захиалга» takes the board along (`?board=`).
- **Printing** (`/sales/orders/:id/print/PICK_LIST` and `/print/DELIVERY_NOTE`, ADR-0056 #7): a page without the shell that prints itself in the browser's dialog; the pick list per warehouse with the shelf and a box for the picked count, the delivery note with the parts' prices, totals and signature lines.
- **«Самбарын тохиргоо»** (`/sales/boards/settings`, `sales.boards.manage`): the boards (archived ones on request) with their stages in order (up/down), «Шинэ самбар» / «Самбар засах» (name, branch), «Дүр» (VIEW / MANAGE roles), «Шат нэмэх» / a stage's dialog (name, action with its hint, the documents to print, VIEW / EDIT / MOVE roles), archiving a stage or a board after a question, and «Шинэ захиалга хаана орох» per channel (board, then stage).

## 9. Tests

Shared (Vitest): `sales.test.ts` (dates, address, phone, cancellable states). Integration: `sales-orders.int-spec.ts` (refusals, product info, submit with frozen parts, two warehouses and a backorder, idempotent replay, no edit after confirm, cancel and release, rights, list, audit; reconciled). Integrity: `sales-races.spec.ts` (three orders for the last 30 pieces never reserve more; opposite line orders never deadlock; cancels give everything back; reconciled). Integration `sales-boards.int-spec.ts` (ADR-0056: configuring a board, its stages, rights as the office and the picker see them, a hidden board, the channel default; a card moved through CONFIRM (reserved, the pick list offered), back, edited while reserved (re-reserved, number kept), refused where the stage forbids, SALE refused before picking, PICK by the picker, the pick form's info, a short pick moving stock to STAGING and consuming the reservations, no second pick or edit, the sale out of STAGING under the order's number in the history, the events; a CANCEL stage with its reason, archiving refusals, orders without a board). Integrity `sales-picking.spec.ts` (a pick short on every line frees the reservations and posts nothing; a pick racing a submit never promises stock twice; an edit racing a submit with the products in opposite order; `post()` numbering nothing and refusing a second pick; reconciled). Web: `features/sales/sales-pages.test.tsx` (menu, a new delivery submitted once with its keys, a confirmed order's backorder and cancel, a reader without the cancel button), `boards-pages.test.tsx` (the board with its totals and cards, a move through the menu with its key and the print dialog, a CANCEL stage asking the reason, the side panel, the stage dialog of the settings).

## 10. Open items

- Done 2026-10-15 (ADR-0056): boards, stages, the pick and the sale. Later: a pick per warehouse for an order spanning branches; cancelling a PACKED order (picked goods back to shelves); what backordered quantities become; a receipt printer through the print agent (ADR-0022) if the owner wants paper without the dialog.
- Delivery 3: the credit check (APPROVAL_PENDING), `customer_balances.open_orders`, invoices from delivered quantities.
- The 24-hour re-quote applies once a submit no longer confirms at once (customer app, sales reps).
