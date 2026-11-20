# ADR-0234: Supplier report: discount view

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-20 |
| Deciders | Owner (2026-11-20: «Хэрэв падааны хөнгөлөлт оруулсан бол тухайн нийлүүлэгчийн тайланг Орлого бүрийн нийт дүн, нөгөө талд урамшуулалын дүн хаагдсан байдалтайгаар авах сонголттой байна.»), Claude (the brain's session and its worker) |
| Amends | ADR-0108 #10 (the supplier report's purchases: a second way to show them) |

## Context

A goods receipt's bill credits the supplier's payable with the delivery note's total less the receipt's discounts (ADR-0099 #4, ADR-0103): the books owe the net. «Тайлан → Нийлүүлэгчийн тайлан» shows the purchases as the books hold them, so a supplier who gives a discount on every note shows smaller purchases than its notes say, and the discount is nowhere to be seen. The owner wants a choice that shows each receipt at its full delivery-note amount and the discount on the other side, closing part of it, with the balance unchanged.

## Decision

1. **A view, not a booking.** The books stay as they are (the payable is the net). The report takes `splitDiscounts` (default false: today's report). With it a receipt's purchase is shown before its discount and the discount apart; nothing else moves, the balance is the books' in both views.
2. **The discount comes from the receipt's costing.** Each costing version's lines carry their share of the note's discounts (`stock_valuation_adjustments.discount_amount`, VAT included, none on free goods); a receipt's discount at a version is the sum of its lines at the latest version up to it. It is matched to the payable entries through their source (`GOODS_RECEIPT/<receipt>`, `RECEIPT_RECOST/<receipt>:<version>`), never through the goods-received lines, so how the bill is booked may change (one entry, another date) as long as these keys and the payable amounts stay.
3. **Each entry carries its part.** The bill carries the discount of the version it was booked at (version 1 when re-costings followed it, else the latest: a bill booked again at the latest version); a re-costing's difference carries the change of the discount since the version booked before it; a reversal the opposite of its original's. So a receipt's entries together carry its latest booked discount, and each entry's amount before the discount is its payable movement plus its discount. A re-costing that booked no payable (stock only) leaves its change to the next one booked.
4. **What the report shows.** Per supplier: «Худалдан авалт (хөнгөлөлтийн өмнө)» = the period's purchases plus the period's discounts, and a new column «Хөнгөлөлт» (the discounts of the entries dated in the period) beside the payments; «Худалдан авалт (НӨАТ-гүй)» stays the books' amount after the discounts (the stock's cost). A supplier's entries list each receipt at its amount before the discount, with its discount in a column of its own shown taken off (a re-costing that lowered the discount shows it added back). The Excel and the A4 print follow the chosen view.
5. **The choice on screen.** «Хөнгөлөлтийг задалж харуулах» in the filter bar, kept in the address (`discounts=1`), so a saved view (ADR-0194) keeps it.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Book the payable gross with a separate discount entry | Changes the books and every reconcile for a way of reading a report; the owner asked for a view. |
| The receipt's latest discount on its bill alone | A re-costing in a later period would rewrite an earlier period's purchases; the change belongs to the re-costing's own date. |
| Show the ex-VAT purchases before the discounts too | The discount is held with VAT; its VAT-free part is not stored per line and the ex-VAT column is the stock's cost the books hold. |

## Consequences

**Positive.** A supplier's promotions are visible per period and per receipt, and the report still agrees with the books' balance.

**Negative.** With the view on, «Худалдан авалт (НӨАТ-тэй)» less «НӨАТ-гүй» is no longer the input VAT (the discount sits between them); the report reads the costing table on top of the payables' journal.

## Related

ADR-0099, ADR-0103, ADR-0108, ADR-0194, `docs/modules/reporting.md`.
