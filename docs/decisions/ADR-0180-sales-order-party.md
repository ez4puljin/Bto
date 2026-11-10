# ADR-0180: The accountant changes an order's customer and payment method until it leaves

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Deciders | Owner («Захиалгын мэдээлэл буюу нягтлан харилцагч, төлбөрийн хэлбэр сонгодог байна.»; the proposal «хүргэлтэд гарахаас өмнө аль ч шатанд нягтлан хоёуланг нь сольж болно, солиход зээл, үнэ дахин шалгагдана» answered «Тийм, ингэж хий») |
| Amends | ADR-0059 («Мэдээлэл»: the customer stayed), ADR-0056 #4 (the header changed only while editable) |

## Context

Orders reach the boards from the office, the apps and imports (one shows «Оруулсан: Импорт (түр)»). In the company's work the accountant settles who the order is for and how it is paid. Bto fixed the customer at creation (`PUT /sales-orders/:id` refused another `customerId`) and let the payment method change only while the order was a draft or reserved before picking, by the stage's EDIT holders. The accountant holds neither the stage rights nor `sales.orders.manage`.

## Decision

1. **A right of its own.** `sales.orders.party` («Захиалгын харилцагч, төлбөрийн хэлбэрийг ачихаас өмнө солих»), held by ACCOUNTANT in the code (ADMIN holds every right; an admin may tick it for another role on `/roles`, ADR-0165).
2. **`PATCH /sales-orders/:id/party`** (`customerId`, `paymentMethod`, `addressId`, `expectedUpdatedAt`) in every state before the goods leave: `PARTY_EDIT_STATUSES` = DRAFT, CONFIRMED, PICKING, PACKED, whatever the stage and its roles. A stale read answers `ORDER_CHANGED`; another state `ORDER_STATE_INVALID` (`expected: PARTY_EDIT`).
3. **A new customer:** active; for a delivery one of the new customer's addresses replaces the old one; the contact name and phone (the old store's) are cleared. A confirmed order's total passes the credit check (ADR-0060 #2) for the new customer under its lock (the order row, then the customer); a refusal answers `CREDIT_BLOCKED` and nothing changes. The old customer's exposure drops by itself (open orders are summed per customer).
4. **Prices, lines, reservations and picks stay.** The wholesale price list does not depend on the customer, so «үнэ дахин шалгагдана» needs no requote; the payment method is read at the sale and the invoice.
5. **History.** The save is a version of the order (ADR-0147) with a new header field `customer` («Харилцагч: A → B») beside `paymentMethod`; the audit row keeps both before and after.
6. **Screen.** The order panel's «Мэдээлэл» opens with a card «Харилцагч ба төлбөр» (the customer picker, the payment method, the new customer's address for a delivery), editable for the right's holders in those states; the header card keeps the rest, and its own payment field stays for the stage's EDIT holders while the order is editable.

## Consequences

- An order taken from an import or an app can be put on the right customer without cancelling it.
- A store's app shows an order moved to another store under the new store from then on.
- Nothing changes after the goods leave: a wrong customer then goes through a return and a new order.

## Related

ADR-0059, ADR-0056 #4, ADR-0060 #2, ADR-0147, ADR-0165, `docs/modules/sales.md` §4, §5.
