# Module `sales` — contract

Status: **office orders built** in delivery 2, session of 2026-10-15 (ADR-0055): drafts, the submit that confirms, prices frozen in parts, reservations per line in the product's home warehouse with backorders, cancelling. Picking, packing, pickup and the interim confirm-delivery screen come next (delivery 2), sales reps in delivery 7, the POS in delivery 9. Code: `apps/api/src/modules/sales/`, shared rules in `packages/shared/src/sales`, screens in `apps/web/src/features/sales/`. Decisions: ADR-0055, ADR-0048 #4 (quotes in parts), ADR-0044 (only complete products are sold), ADR-0009, ADR-0010, architecture §5.3 (reservations) and §5.6 (the state machine).

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

## 2. Owned tables (migration `0023_sales_orders`)

| Table | Holds | Guards |
|---|---|---|
| `sales_orders` | one per order: `number` (`SO-YYYY-NNNNNN`, NULL while a draft), `channel` (ADMIN today), `status`, `customer_id`, `fulfilment` PICKUP/DELIVERY, `delivery_date`, `address_id` + the copied `address_text` / `address_lat` / `address_lng`, `contact_name`, `contact_phone` (E.164), `payment_method` CASH/BANK_TRANSFER/CREDIT, `note`, `price_date`, `subtotal` / `discount_total` / `total`, submitted / confirmed / cancelled stamps and `cancel_reason` | number, price date and total exactly when submitted; DRAFT exactly when neither submitted nor cancelled; CANCELLED exactly with `cancelled_at`; a submitted DELIVERY has an address; lengths; `total = subtotal − discount_total`; unique number; `REVOKE DELETE, TRUNCATE` from app |
| `sales_order_lines` | `line_no`, product, unit, `qty` (in the unit), `factor_snapshot`, `qty_base`, `warehouse_id` (the home), `qty_approved` (reserved) and `qty_backordered`, line totals | quantities positive; approved + backordered ≤ qty base; `total = subtotal − discount`; a draft's lines are replaced when it is edited (DELETE allowed, TRUNCATE revoked) |
| `sales_order_line_parts` | the quote's parts frozen at submit (ADR-0048 #4): unit, `uom_name`, `basis`, qty, factor, qty base, list price, unit price, subtotal, discount, total, `applied` (jsonb: the programs) | basis list; money signs; `REVOKE DELETE, TRUNCATE` |
| `order_status_events` | every state change: from, to, reason, actor, time | `REVOKE UPDATE, DELETE, TRUNCATE` |

AI views (ADR-0045): `ai.sales_orders`, `ai.sales_order_lines` (`AI_DATASETS`, mn.json `ai.datasets`).

## 3. Public API (`modules/sales/index.ts`)

| Export | Use |
|---|---|
| `SalesModule` / `SalesHttpModule` | the service; + the controller (api). `CreditChecker` is bound to `AllowAllCreditChecker` (finance replaces it in delivery 3) |
| `SalesOrdersService.create / update / submit / cancel / get / list / productInfo` | below |
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

## 5. Rules worth knowing

- **Submit** (one transaction): the order row FOR UPDATE → header checks again → the customer row (`lockForUpdate`, inactive → `CUSTOMER_INACTIVE`) → products sellable with a home (the line's warehouse is set again to the home) → `PriceQuoteService.quote({ WHOLESALE, today, lines }, tx)` (a line without a price → `PRICE_MISSING` naming the SKUs) → `CreditChecker` → parts and totals written → `ReservationService.reserveInTx` (the `warehouse_stock` rows in (warehouse, product) order; each line takes what is available, the rest is `qty_backordered`) → `SO-` number last → events SUBMITTED and CONFIRMED, audit `CONFIRM`.
- **Prices** are today's (Ulaanbaatar) at the submit; the delivery date does not change them.
- **Cancel** releases the order's ACTIVE reservations (`releaseInTx`) and records the reason; a cancelled draft keeps no number.
- **Backorders** stay on the line; what happens to them (a later order, picking) comes with picking.
- **Reconciliation**: the nightly check compares `warehouse_stock.reserved` with the ACTIVE reservations (level RESERVED).

## 6. Error codes introduced

`PRODUCT_NO_HOME`, `PRODUCT_NOT_SELLABLE` (409). Also used: `ORDER_STATE_INVALID` (409), `CUSTOMER_INACTIVE`, `PRICE_MISSING`, `CREDIT_BLOCKED` / `CREDIT_NEEDS_APPROVAL` (delivery 3), `UNIT_SUPERSEDED`, `UNIT_FACTOR_INEXACT`, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`.

## 7. Audit

`sales_orders` CREATE, UPDATE (a draft), CONFIRM (number, total, backordered lines), CANCEL (status before, reason, reservations released).

## 8. Screens (`apps/web`)

- Menu «Борлуулалт» → «Захиалга» (`sales.orders.read`): `/sales/orders` — search by number, a status filter, rows that open the order (number or «Ноорог №N», customer, pickup or delivery, date, lines, total, status).
- `/sales/orders/new` and a draft's page (`sales.orders.manage`): «Захиалгын мэдээлэл» (customer picker, pickup or delivery, date, the customer's addresses with the default chosen, the contact with the customer's contacts offered, payment, note) and «Бараа» (product search, unit select with pack counts, quantity, the home warehouse and the stock available there, a refusal note for a product that cannot be ordered); «Үнэ тооцоолох» shows today's parts (the calculator's table, `features/pricing/quote-table.tsx`); `StickyActions` «Ноорог хадгалах» and «Илгээх» (asked first; a toast «SO-… захиалга батлагдлаа»).
- A confirmed or cancelled order: the header read-only, a note when lines are backordered, the lines with reserved and backordered quantities, the frozen price parts, the history, «Цуцлах» with a reason.

## 9. Tests

Shared (Vitest): `sales.test.ts` (dates, address, phone, cancellable states). Integration: `sales-orders.int-spec.ts` (refusals, product info, submit with frozen parts, two warehouses and a backorder, idempotent replay, no edit after confirm, cancel and release, rights, list, audit; reconciled). Integrity: `sales-races.spec.ts` (three orders for the last 30 pieces never reserve more; opposite line orders never deadlock; cancels give everything back; reconciled). Web: `features/sales/sales-pages.test.tsx` (menu, a new delivery submitted once with its keys, a confirmed order's backorder and cancel, a reader without the cancel button).

## 10. Open items

- Next: picking waves per warehouse, packing, pickup handover and the interim confirm-delivery screen (SPEC §5.7, §9.3 row 2); what backordered quantities become.
- Delivery 3: the credit check (APPROVAL_PENDING), `customer_balances.open_orders`, invoices from delivered quantities.
- The 24-hour re-quote applies once a submit no longer confirms at once (customer app, sales reps).
