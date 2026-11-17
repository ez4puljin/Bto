# ADR-0217: The staff app shows an N+M order line as its main and bonus parts

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-17 |
| Deciders | Owner (2026-11-17: «In the staff app one looks through a filter of goods with a bonus. A 17+1 product entered as 34: in the cart the main order is 33 and on the line "Бонус" the same product 1. The amount shows the main order's amount. When the order is prepared the total to pick shows, with in brackets "үндсэн 33 + бонус: 1"»; the number typed stays the total pieces), the brain (the brief), Claude (the bto-core worker) |
| Migration | `0110_sales_free_qty` |
| Builds on | ADR-0159 #3 (N+M: the quantity is unchanged, the free units' value is cut from the line), ADR-0092 #3 (the «17+1» badge); the till's paid-quantity entry (commit 517dea0e, the till only) |

## Context

An N+M program (ADR-0159 #3) is priced by the engine on the quantity that leaves the warehouse: of
every N+M pieces of the product, M are free (`floor(total / (N+M)) × M`). The order line keeps the
total, and its discount holds the free pieces' value. The staff app showed only the total and the
line's money. The rep could not see how much of the line was free, and the keeper picking the order
could not tell that part of the quantity was a bonus. Since 517dea0e the till lets the cashier type
the paid quantity instead, and `lineBonuses` (`@tugeel/shared/pricing`) tells, per quoted line, N,
M and the free and paid quantities.

## Decision

1. **The staff app keeps total entry.** The rep types the total pieces, as the warehouse gives them.
   The engine, prices, discounts, VAT, reservations and the stock that leaves are unchanged.
   17+1: 20 → 19 + 1, 34 → 33 + 1, 36 → 34 + 2, 17 → 17 + 0.
2. **The quote names the split.** `POST /pricing/quote` gives each line `bonus`: N, M, `freeQty`
   and `paidQty` in the line's unit, `freeQtyBase` in base units (exact, before rounding into the
   line's unit) and `freeAmount`, from `lineBonuses`. No client computes a split from the badge.
3. **The cart shows it.** «Сагс» keeps the total on the quantity pill (what was typed), says
   «үндсэн 33 ширхэг» on the line, and lists the free goods apart under «Бонус» at 0₮. The total is
   the quote's total (the main quantity's money). The cart's «Хямдрал» leaves out the N+M's value,
   the same way the till's receipt leaves it out of «Хөнгөлөлт».
4. **The order line stores the split it was sold with.** `sales_order_lines.free_qty_base`
   (nullable, `0 < free_qty_base <= qty_base`) holds the free base units, written wherever the
   prices are frozen: at submit for every channel (office, staff app, Bto300) and on a line edit's
   requote. A changed quantity clears it until its requote writes it again. An excluded line keeps
   it in `sales_order_excluded_lines.free_qty_base` and a restore without a requote puts it back. A
   line renewed after a reopen copies it. It is null when no N+M gave anything, and on lines frozen
   before this decision, which show no split. It was not derived from `sales_order_line_parts`:
   a line edit requotes only some lines, so the parts cannot show what the whole product counted.
5. **Picking shows the total with the split.** The staff app's «Бэлтгэх» line and keypad, the
   office's order products (the reserved column) and the printed pick list say «34 ш (үндсэн 33 +
   бонус: 1)». The keeper still picks and confirms the total. Lines without free goods look as
   before.
6. **«Бонустай бараа».** The staff shop's filter sheet has the toggle «Бонустай бараа», and the
   chip row has the same chip. When it is on, `GET /sales-rep/products?bonus=true` keeps only the
   products a BONUS program marks in today's deal book for the staff app's pipeline. This is the
   same book the «17+1» badges come from. It works together with the search and the other filters.
7. Bto300's cart and the office's order form keep their look. They may read the new fields later.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Paid-quantity entry in the staff app, as at the till | The owner wants the staff app to keep the total typed (2026-11-17). |
| Derive the split from the frozen parts' applied programs | A line edit requotes only some lines, so the parts cannot rebuild the product's whole count. Storing one number is exact and survives the program's end. |
| Compute the split in the app from the badge | The badge does not know priority programs or a product on two lines. The quote already knows (`lineBonuses`). |

## Consequences

- Old orders show no split. New ones show it even after their program ends.
- The order's money, VAT, e-Barimt, stock and the integrity suite are untouched. The new column is
  for display only.
- `apps/api/test/integration/staff-bonus-lines.int-spec.ts` covers the quote, the order and the
  picking view at 20, 34, 36 and 17 pieces, and the filter.
