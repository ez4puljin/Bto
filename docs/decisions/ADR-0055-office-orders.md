# ADR-0055: Office orders confirm on submit, line by line from the product's home warehouse

| | |
|---|---|
| Status | Accepted |
| Date | 2026-10-15 |
| Deciders | Owner, Claude (Claude Code session) |
| Amends | architecture §5.6 (office orders skip a separate CONFIRM step while credit checks allow all; a line's warehouse is its product's home), §5.3 (`reserve()` as built); builds on ADR-0009 (#6), ADR-0010, ADR-0044, ADR-0048 |
| Amended by | ADR-0056 (#1: a confirmed order may be edited until picking, re-quoted and re-reserved in one lock pass; the submit is the CONFIRM stage action; picking by confirmed counts and the sale as stage actions) |

## Context

Delivery 2 adds customer orders. The architecture's state machine has DRAFT → SUBMITTED → (APPROVAL_PENDING →) CONFIRMED, with reservations at CONFIRM and prices frozen at SUBMIT. Until finance arrives in delivery 3 the credit check allows everything (SPEC §6.2 #5). The inventory module has the `stock_reservations` table and the `warehouse_stock.reserved` column, but no service writes them yet.

The owner's answers (2026-10-15):
- **Who enters orders.** The office enters orders a customer phones in. Sales reps take orders in their app later (delivery 7).
- **Confirmation.** «Илгээх» confirms the order at once and reserves its stock.
- **Pickup or delivery.** A customer either picks up or gets a truck delivery; each order says which. Each order has a delivery date and an address.
- **Warehouse.** Each line ships from its product's home warehouse. A product without a home warehouse cannot be ordered.
- **Lines.** Quantities are entered in a chosen unit (box, block, piece).
- **Cancelling.** The office cancels an order before it is packed.
- **Extras.** An order carries a note, a contact person with a phone number, and a payment method: cash, bank transfer or credit.

## Decision

1. **States.**
   - **Submit.** DRAFT → CONFIRMED in one transaction: the submit also confirms. `order_status_events` records both SUBMITTED and CONFIRMED.
   - **Approval.** APPROVAL_PENDING arrives with the real credit check in delivery 3.
   - **Cancelling.** DRAFT and CONFIRMED (later: up to PACKED) go to CANCELLED with a reason, and reservations are released.
   - **Editing.** A confirmed order is never edited; it is cancelled and entered again.
   - **No re-quote.** The 24-hour re-quote does not arise, because prices freeze at the submit that confirms.
2. **Header.**
   - **Customer:** an active customer; channel `ADMIN`.
   - **Fulfilment:** `PICKUP` or `DELIVERY`.
   - **Delivery date:** today or later; the default is tomorrow.
   - **Address:** required for DELIVERY. It is chosen from the customer's addresses, and its text and point are copied onto the order.
   - **Contact:** a name and a phone, picked from the customer's contacts or typed; the phone is checked by `@tugeel/shared/phone`.
   - **Payment method:** `CASH`, `BANK_TRANSFER` or `CREDIT`, used by finance from delivery 3.
   - **Note:** up to 500 characters.
3. **Lines.**
   - **What a line holds:** product, unit, entered quantity, `factor_snapshot` and `qty_base`. The same product may take several lines in different units («2 хайрцаг + 5 ш»). At most 200 lines.
   - **Warehouse.** The line's warehouse is its product's home: kept on the draft for display and set again at submit. A product without a home is refused (`PRODUCT_NO_HOME`), as is an inactive or incomplete product (`PRODUCT_NOT_SELLABLE`, ADR-0044). An order may therefore reserve in several warehouses.
4. **Prices at submit.**
   - **The quote.** `PriceQuoteService.quote({ list: WHOLESALE, date: today, lines }, tx)` runs at submit, and each line's parts are frozen in `sales_order_line_parts` (ADR-0048 #4): basis, quantity, unit, factor, list price, unit price, discount, total and the programs applied.
   - **Totals.** Line and header totals are stored.
   - **No price.** A line without a price refuses the submit (`PRICE_MISSING`).
5. **Reservations** (inventory `ReservationService`, architecture §5.3).
   - **`reserveInTx`** locks the `warehouse_stock` rows of the lines' (warehouse, product) pairs in key order. Each line reserves `min(wanted, sellable_on_hand − reserved)`, kept in `stock_reservations` (ACTIVE). The rest is the line's `qty_backordered`, and the order still confirms (SPEC §6.4 #4).
   - **`releaseInTx`** releases a document's reservations.
   - **`availableOf`** gives each product's available stock per warehouse, for the order screen.
6. **Lock order at submit.**
   1. The order row FOR UPDATE.
   2. The customer row (`CustomersService.lockForUpdate`), then the credit checker (`AllowAllCreditChecker`).
   3. Product checks and the quote.
   4. `warehouse_stock` rows in key order.
   5. The `SO-` number last.

   `customer_balances` comes with finance (delivery 3).
7. **Rights.**
   - **`sales.orders.read`:** OFFICE, ACCOUNTANT, WAREHOUSE, ADMIN.
   - **`sales.orders.manage`:** create, edit drafts, submit, cancel. OFFICE and ADMIN, assignable to custom roles.
   - **No warehouse scope.** A reservation is not a stock movement, so it needs no warehouse write scope.
8. **AI.** Views `ai.sales_orders` and `ai.sales_order_lines`, with `AI_DATASETS` entries.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| A separate CONFIRM by a second person | The owner wants the order confirmed when sent; the credit approval of delivery 3 adds the second look where it matters. |
| One warehouse per order | The owner chose each product's home warehouse; a customer's order may span the branches' stores. |
| Ordering a product without a home from a chosen warehouse | The owner: such products are not ordered; give them a home first. |
| Editing a confirmed order | It would re-price and re-reserve a document others act on; cancel and enter again. |

## Consequences

**Positive.**
- One step from the phone call to reserved stock.
- Shortfalls are visible at once as backorders.

**Negative.**
- **Several pickings.** An order may need picking in several warehouses; the picking session plans waves per warehouse.
- **No credit gate yet.** Until delivery 3 nothing stops an order over credit.

## Related

SPEC §5.7, §6.1, §6.2, §6.4, §6.13; architecture §5.3, §5.6; ADR-0009, ADR-0010, ADR-0044, ADR-0048; `docs/modules/sales.md`.
