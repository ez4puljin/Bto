# ADR-0236: Purchase discounts are income on 520202

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-20 |
| Deciders | Owner (2026-11-20, the option «Хөнгөлөлт орлого»: «…урамшуулал, хөнгөлөлт гэдэг дансанд бичигдэж, 310101 өглөгийн дансанд хаалт болж явах ёстой. Ингэснээр бид дараа Дансны тайлангаар нийт урамшуулал, хөнгөлөлт харах боломжтой болно.»), Claude (a brain task, `task/purchase-discount-income`) |
| Amends | ADR-0099 #4 and ADR-0103 (a receipt's discounts no longer lower the lines' cost, for receipts costed from now on); ADR-0233 #1 («The discount stays inside the costed values»); ADR-0234 #1 and the alternative it rejected (the books now carry the note's amount and the discount; the view stays); ADR-0072 #1 (an `AP_BILL` / `AR_INVOICE` may carry lines of the other side that settle) |

## Context

A delivery note's discounts (падааны хөнгөлөлт: on chosen lines or on the whole note, ADR-0103) lowered each line's cost and the supplier's payable: the bill credited the payable with the note's amount less the discount, and the stock went in at the price after it. A supplier's promotions were therefore nowhere in the books; ADR-0234 gave the supplier report a view that shows them from the receipts' data. The owner wants them in the books themselves: an account whose report («Дансны тайлан») shows every purchase discount, with the discount closing part of the supplier's payable on 310101. He chose this knowing that the products' costs and margins are then at the price before the discount and the discount is separate income.

## Decision

1. **The discount is income.** A receipt's pricing books, in its one entry (ADR-0233), for a note of G with VAT, discounts D, N = G − D owed and VAT rate r (0 for a supplier or a company that pays no VAT):

   | | |
   |---|---|
   | Dr INVENTORY | G without its VAT, less the variance below |
   | Dr COGS | the costing's variance (goods sold before the prices came, ADR-0233) |
   | Dr VAT_INPUT | the VAT inside N, per line as before |
   | Cr AP | G |
   | Dr AP | D, settling the bill's own item, so N stays open in the group `receipt:<id>` |
   | Cr PURCHASE_DISCOUNT | the rest: D without the VAT that is not taken back on it |

   A receipt without discounts is booked exactly as before. The VAT stays exact per line and the stock is the stock module's value, so any rounding cent of a discount lands on the income line. Document types and source keys are unchanged (`BTO/GOODS_RECEIPT/<id>`, `BTO.SUPPLIER_BILL`…).
2. **The key and the account.** A chart role and posting key `PURCHASE_DISCOUNT`, with a rule on 520202 «Худалдан авалтын хөнгөлөлт» (INCOME, credit-normal); the accountant can move the role to another account on «Данс» like any other. The boot step creates the key, an empty chart gets the account and the rule from the template, and migration `0120_purchase_discount` (data only) gives the rule to a chart that already has accounts: it adds the account only where no account and no group holds the code, maps only a plain, active income account, and stops with a message when a company's 520202 cannot take the key.
3. **The product's cost is the price before the discount.** The price check values each line at its delivery-note amount without the VAT (`receiptLineCost(doc_amount, rate)`); the line's share of the discounts is still stored per line and version (`stock_valuation_adjustments.discount_amount`: the reports and the payable read it). So INVENTORY keeps following the stock's value. Free goods stay at zero cost. This departs from ADR-0099 #4 / ADR-0103, where the discount lowered the cost.
4. **A re-costing books the differences of all these lines**: the payable's two movements (the note's amount and the discount) each by its own difference, PURCHASE_DISCOUNT by its difference. Two movements on the same side are one line. The document is a bill when the payable takes a credit (its own debit settles that credit first, then what is open of the receipt's bills), a credit when it takes only a debit, a journal when it takes none; so a receipt's open amount is its payable as before, and «Нийлүүлэгчийн тооцоо» and the payments are unaffected.
5. **How a costing's method is known.** Nothing is stored for it: `receiptDiscountOutsideCost` (`@tugeel/shared/inventory`) reads a costing row. A line with a discount whose `amount` is its `doc_amount` without the VAT (at the receipt's frozen rate, or at 0 for a product without VAT) keeps its discount out of its cost; any other line has it inside (or has none). `StockPostingService.costingDiscount(receipt, version)` sums the discounts kept out at a version, and the bill's income line is always the balancing figure: the stock plus the VAT less the payable, zero for a costing with its discounts inside.
6. **The core lets a bill carry what it takes off itself.** Class rule (amending ADR-0072 #1): besides its one owed line, an `AP_BILL` (and its mirror `AR_INVOICE`) may carry lines of the other side on the same control account, each of which must settle; no other line settles. A settle target that names the document's own source key pairs with the document's own items, made once they are written; a reversal undoes those pairs like any the document made.
7. **Receipts costed before this ADR** keep their entries: nothing is rewritten or reversed. When one is costed again, the new version is valued the new way and the difference entry carries the whole change, so the receipt's entries together read as if it had been booked this way: the stock (and the cost of goods sold for what left) rises by the discount, PURCHASE_DISCOUNT is credited with it, and the payable is credited and debited with the discount on top of the price difference.
8. **The one-off command** `pnpm finance:purchase-discounts -- --receipt <GR-number> [--apply]` does that without a price change for a receipt whose discount is inside its cost: a new costing version at the same amounts and discounts (`ReceiptsService.discountsOutOfCostInTx`, not bound by the re-costing deadline), booked as `BTO/RECEIPT_RECOST/<id>:<version>` on the receipt's date by ADR-0233's rule (today when that month is closed). Without `--apply` it is a dry run: it does everything in a transaction that is rolled back and prints the product cost changes and the entry.
9. **The supplier report (ADR-0234) is unchanged in what it shows.** A receipt's entry is still one row with the payable's net movement, so by default purchases are after the discounts and the discount's debit is not a payment; «Хөнгөлөлтийг задалж харуулах» shows the note's amount and «Хөнгөлөлт» from the receipts' data, for receipts booked either way. «Худалдан авалт (НӨАТ-гүй)» stays the payable without its VAT (no longer the stock's cost). «Нийлүүлэгчийн тооцоо» lists the bill's two payable lines under the receipt (kind BILL, a re-costing's RECOST); the discount line carries the description «Падааны хөнгөлөлт».

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Keep the discount inside the cost and only show it (ADR-0234) | The owner wants the account's report to show all discounts and the payable closed by them. |
| Income on 520202 with the stock still at the price after the discount | INVENTORY would no longer equal the stock's value, or the income would need a second debit with no account to carry it. |
| A separate document for the discount | The owner's flow is one entry per pricing (ADR-0233); two documents would need two dates and numbers. |
| A column that marks a costing's method | A migration on the ledger's history table for what the row already says; the only receipt costed the old way on the real system is brought over by the command. |

## Consequences

**Positive.** «Дансны тайлан» of 520202 lists every purchase discount; 310101 shows each note at its full amount with the discount closing part of it; the supplier's balance, open items and payments are as before.

**Negative.**
- Product costs, the stock's value and margins are at the price before the discount; the discount shows as separate income and not in the gross margin of the goods.
- A receipt's bill has two lines on the payable; lists of the payable's lines show both.
- The method of a costing is inferred from its row. A line whose discount equals exactly the VAT inside its amount, on a product without VAT, costed before this ADR, would be read as costed the new way; the one receipt costed the old way on the real system is from a supplier that pays no VAT.
- TODO-VERIFY (accountant): that purchase discounts are income on 520202 and not a reduction of the goods' cost, and the VAT treatment of the discount (the input VAT is taken on the amount owed). Not yet confirmed.

**The real system.** One receipt, GR-2026-000001, was costed before this ADR with a note discount of 9,446,666₮ inside its cost. `pnpm finance:purchase-discounts -- --receipt GR-2026-000001` shows what bringing it over would book; `--apply` writes it. Nobody has run it.

## Related

ADR-0033, ADR-0072, ADR-0091, ADR-0097, ADR-0099, ADR-0103, ADR-0154, ADR-0233, ADR-0234, `docs/modules/finance.md`, `docs/modules/inventory.md`, `docs/modules/reporting.md`.
