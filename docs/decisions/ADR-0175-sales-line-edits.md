# ADR-0175: A card's «Засвар» changes a reserved order's lines; a line taken off stays on the order in red

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Deciders | Owner («энэ extention засвар хийж байгаа шиг Sales, Deal дээр засвар хийдэг болго», about the erxes extension «BTO Агуулах — Deal засвар»; answers: «Улаанаар үлдэнэ», «Хуучин үнэ хэвээр», «Нөөцөлсөн ба бэлдэж буй үед», «Бэлтгэх эрхтэй нярав») |
| Amends | ADR-0126 #4 (only `sales.orders.manage` changed a reserved order's lines, and a removed line was gone) |

## Context

The keepers correct orders while they prepare them: a product is short, a customer asks for less, a line is dropped. In erxes they did this with a browser extension that opened a deal's products in a window, with a quantity stepper, «Хасах», a list of what was taken off in red on the card, and one save. Bto's board had only the whole order form, for the office.

## Decision

1. **«Засвар» on a board card** opens the order's lines in one window: quantity by buttons or arrow keys, «Хасах», «Буцааж нэмэх», «Бараа нэмэх», search and four filters, and one save (Ctrl+S). `PATCH /sales-orders/:id/lines` applies the whole set in one transaction.
2. **A line taken off stays on the order** in its own table, `sales_order_excluded_lines`, with its frozen price parts. It leaves `sales_order_lines`, so the reserve, pick, sale, invoice and print never see it. The card lists it in red («Хасагдсан бараа (n)» with the sum). A restore stamps `restored_at` / `restored_by` and writes the line back; the row is never deleted (`REVOKE DELETE, TRUNCATE`).
3. **The old price stays.** A changed or restored line is quoted again on the order's own `price_date`; a line restored with its quantity unchanged takes its frozen parts back as they were. Only a newly added product is priced today.
4. **When.** `CONFIRMED`, `PICKING` and `PACKED` (`LINE_EDIT_STATUSES`): reserved and being prepared. After the sale a correction is a return, as before.
5. **Who.** The office (`sales.orders.manage`) every line. A keeper with `sales.orders.pick` only the lines of warehouses they may write (`ScopeService.assertCanWriteWarehouse`), and a product they add must be homed in one of them; otherwise 403.
6. **Picking.** A touched warehouse's confirmed part is taken back to its shelves and reopened when the caller is the office or a lead (`sales.orders.pickLead`); a keeper gets 409 `LINE_EDIT_PART_DONE`. Other warehouses' parts are untouched. Reservations are replaced for the open parts.
7. **Guards.** `expectedUpdatedAt` is required (409 `ORDER_CHANGED`); an order cannot be left without lines (422); the credit is checked only when the total grows; the change is written to the order's history and the audit.

## Consequences

- The keepers' corrections are on the order with who and when, instead of in a browser extension's storage.
- An excluded line holds no stock: its reservation is released at the save.
- A restored line can fall short if the stock went elsewhere meanwhile; it is then backordered as on any reserve.
- The order panel's «Бараа» tab does not list the excluded lines yet; the card and the «Засвар» window do.
- Readers of an order's lines need no filter: the excluded lines are in another table.

## Related

ADR-0126 (picking by warehouse), ADR-0048 (frozen price parts), ADR-0027 (scope), `docs/modules/sales.md` §2, §4, §5.
