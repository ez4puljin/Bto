# ADR-0178: Every order line keeps its first ordered quantity

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-10 |
| Deciders | Owner («өмнө тоо биш анхны захиалгын тоо Үргэлж харагддаг байх хэрэгтэй. 1ш -->10ш болгосон ч анхны захиалга 1ш гэж харагддаг байна. Цонх хаагаад нээсэн ч гэсэн.») |
| Amends | ADR-0175 (the «Засвар» window showed only «өмнө N», the value before the unsaved edit) |

## Context

After ADR-0175 a keeper or the office changes a reserved order's quantities in place. The window showed «өмнө 1» under a typed quantity, but once saved and reopened the hint was gone and nobody could see what the customer had first ordered. The order's change versions (ADR-0147) record each save's differences, but only by product and unit names and warehouse, not by line, so reading the first quantity back from them on every view would be fragile (a renamed product, two lines of one unit).

## Decision

1. **`original_qty` on the line.** `sales_order_lines.original_qty` (`NUMERIC(14,3)`, in the line's unit, nullable, `> 0`) is the quantity first ordered. A new order writes it equal to `qty`; a draft's whole-order save rewrites it with the draft's quantities (a draft is still being written). After the draft it never changes:
   - «Засвар» (`PATCH /sales-orders/:id/lines`) changes `qty` in place and leaves `original_qty`;
   - a line taken off carries it to `sales_order_excluded_lines.original_qty`, and a restore writes it back;
   - a line added later («Бараа нэмэх», or a unit the office adds in the whole-order form) has `NULL`;
   - the office's whole-order save after the draft (`PUT /sales-orders/:id`) rewrites the lines and carries the first quantity per unit and warehouse (the replaced lines' sum, onto the first new line of that unit and warehouse); a picked line renewed after a reopen copies it.
2. **What the screens show.** The «Засвар» window and the order panel's «Бараа» tab show «анхны захиалга N <unit>» under a line whose quantity differs from its first, and always under a line taken off; a line added later is tagged «Нэмэгдсэн». The window's «өмнө N» stays for an unsaved change when the saved quantity is not the first. A draft shows nothing.
3. **Backfill (migration `0095_sales_original_qty`).** Existing lines and taken-off lines take the quantity before the earliest change version saved after the draft that names their product, unit and warehouse; a line such a version added gets `NULL`; a line no version names, or one of two lines with the same unit and warehouse, keeps its `qty`.

## Consequences

- The first order is read from the line itself; no history walk on every view.
- `original_qty` is not used for stock, prices or credit: it is a display of what was asked.
- The API's `SalesOrderLine` and `SalesOrderExcludedLine` carry `originalQty` (string or null).
- Versions recorded before ADR-0147 do not exist, so an order changed before 2026-11-05 shows its quantity at that time as the first.

## Related

ADR-0175 (a card's «Засвар»), ADR-0147 (the order's change versions), ADR-0126 #4 (the office changes an order in any stage), `docs/modules/sales.md` §2, §4, §5.
